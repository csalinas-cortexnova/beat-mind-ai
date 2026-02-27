import { verifyAgentAuth, isAuthError } from "@/lib/auth/agent-auth";
import { validateBody } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { AgentHeartbeatSchema } from "@/lib/validations/agent";
import { db } from "@/lib/db";
import { athleteBands, athletes, sessions, hrReadings } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getZone } from "@/lib/hr/zones";

export async function POST(request: Request) {
  // 1. Auth
  const authResult = await verifyAgentAuth(request);
  if (isAuthError(authResult)) {
    return error(authResult.error, ApiErrorCode.UNAUTHORIZED, authResult.status);
  }

  // 2. Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(
      "Invalid JSON body",
      ApiErrorCode.VALIDATION_ERROR,
      422
    );
  }

  // 3. Validate
  const validation = validateBody(AgentHeartbeatSchema, body);
  if (!validation.success) {
    return validation.response;
  }

  const data = validation.data;

  // 4. Check gymId matches agent's gym
  if (data.gymId !== authResult.gymId) {
    return error(
      "Gym ID does not match agent's assigned gym",
      ApiErrorCode.GYM_MISMATCH,
      422
    );
  }

  // 5. Resolve sensorIds → athleteIds via athlete_bands
  const sensorIds = Object.keys(data.devices).map(Number);
  const bands = await db
    .select({
      sensorId: athleteBands.sensorId,
      athleteId: athleteBands.athleteId,
    })
    .from(athleteBands)
    .where(
      and(
        eq(athleteBands.gymId, data.gymId),
        eq(athleteBands.isActive, true)
      )
    );

  // Filter to only sensors present in this heartbeat
  const sensorToAthlete = new Map<number, string>();
  for (const band of bands) {
    if (sensorIds.includes(band.sensorId)) {
      sensorToAthlete.set(band.sensorId, band.athleteId);
    }
  }

  // If no mapped sensors, return ok but skip insert
  if (sensorToAthlete.size === 0) {
    return ok({ ok: true, sessionId: null });
  }

  // 6. Pre-load mapped athletes' maxHr
  const athleteIds = [...new Set(sensorToAthlete.values())];
  const athleteRows = await db
    .select({
      id: athletes.id,
      maxHr: athletes.maxHr,
    })
    .from(athletes)
    .where(eq(athletes.gymId, data.gymId));

  const athleteMaxHr = new Map<string, number>();
  for (const a of athleteRows) {
    if (athleteIds.includes(a.id)) {
      athleteMaxHr.set(a.id, a.maxHr);
    }
  }

  // 7. Find or create active session
  const activeSessions = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.gymId, data.gymId),
        eq(sessions.status, "active")
      )
    );

  let sessionId: string;
  if (activeSessions.length > 0) {
    sessionId = activeSessions[0].id;
  } else {
    // Auto-create session
    const [newSession] = await db
      .insert(sessions)
      .values({
        gymId: data.gymId,
        classType: "general",
        status: "active",
      })
      .returning({ id: sessions.id });
    sessionId = newSession.id;
  }

  // 8. Build and bulk insert hr_readings
  const timestamp = new Date(data.timestamp);
  const readings: Array<Record<string, unknown>> = [];

  for (const [sensorIdStr, device] of Object.entries(data.devices)) {
    const sensorId = Number(sensorIdStr);
    const athleteId = sensorToAthlete.get(sensorId);
    if (!athleteId) continue;

    const maxHr = athleteMaxHr.get(athleteId) ?? 190;
    const zone = getZone(device.bpm, maxHr);

    readings.push({
      sessionId,
      gymId: data.gymId,
      athleteId,
      sensorId,
      heartRateBpm: device.bpm,
      hrZone: zone.zone,
      hrZoneName: zone.zoneName,
      hrZoneColor: zone.zoneColor,
      hrMaxPercent: String(zone.hrMaxPercent),
      beatTime: timestamp,
      beatCount: device.beatCount,
      deviceActive: device.deviceActive,
      recordedAt: timestamp,
    });
  }

  if (readings.length > 0) {
    await db.insert(hrReadings).values(readings);
  }

  // 9. Return success
  return ok({ ok: true, sessionId });
}
