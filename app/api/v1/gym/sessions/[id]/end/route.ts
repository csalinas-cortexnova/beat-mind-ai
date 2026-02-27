import { requireGymAccessApi, isAuthError } from "@/lib/auth/guards";
import { validateBody } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { EndSessionSchema } from "@/lib/validations/session";
import { db } from "@/lib/db";
import { sessions, sessionAthletes, hrReadings } from "@/lib/db/schema";
import { eq, avg, max, min } from "drizzle-orm";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Auth — any gym member
  const authResult = await requireGymAccessApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  const { id: sessionId } = await params;

  // 2. Parse optional body (classType)
  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) {
      body = JSON.parse(text);
    }
  } catch {
    return error("Invalid JSON body", ApiErrorCode.VALIDATION_ERROR, 422);
  }

  const validation = validateBody(EndSessionSchema, body);
  if (!validation.success) return validation.response;

  const { classType } = validation.data;

  // 3. Validate session exists and belongs to this gym
  const sessionRows = await db
    .select({
      id: sessions.id,
      gymId: sessions.gymId,
      status: sessions.status,
      startedAt: sessions.startedAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (sessionRows.length === 0) {
    return error("Session not found", ApiErrorCode.SESSION_NOT_FOUND, 404);
  }

  const session = sessionRows[0];

  if (session.gymId !== authResult.gymId) {
    return error("Session belongs to a different gym", ApiErrorCode.GYM_MISMATCH, 403);
  }

  if (session.status !== "active") {
    return error("Session is not active", ApiErrorCode.SESSION_NOT_ACTIVE, 409);
  }

  // 4. Compute duration
  const now = new Date();
  const startedAt = new Date(session.startedAt as string | Date);
  const durationSeconds = Math.floor((now.getTime() - startedAt.getTime()) / 1000);

  // 5. Aggregate per-athlete stats from hr_readings
  const athleteStats = await db
    .select({
      athleteId: hrReadings.athleteId,
      avgHr: avg(hrReadings.heartRateBpm),
      maxHr: max(hrReadings.heartRateBpm),
      minHr: min(hrReadings.heartRateBpm),
    })
    .from(hrReadings)
    .where(eq(hrReadings.sessionId, sessionId))
    .groupBy(hrReadings.athleteId);

  // 6. Upsert session_athletes with stats
  for (const stat of athleteStats) {
    await db
      .insert(sessionAthletes)
      .values({
        sessionId,
        athleteId: stat.athleteId,
        avgHr: stat.avgHr ? Math.round(Number(stat.avgHr)) : null,
        maxHr: stat.maxHr ? Number(stat.maxHr) : null,
        minHr: stat.minHr ? Number(stat.minHr) : null,
        // TODO (Spec 12): Calculate calories from HR data
        calories: null,
        // TODO (Spec 10): Calculate zone times from HR readings
        timeZone1S: 0,
        timeZone2S: 0,
        timeZone3S: 0,
        timeZone4S: 0,
        timeZone5S: 0,
      })
      .onConflictDoUpdate({
        target: [sessionAthletes.sessionId, sessionAthletes.athleteId],
        set: {
          avgHr: stat.avgHr ? Math.round(Number(stat.avgHr)) : null,
          maxHr: stat.maxHr ? Number(stat.maxHr) : null,
          minHr: stat.minHr ? Number(stat.minHr) : null,
        },
      });
  }

  // 7. Update session status
  const updateSet: Record<string, unknown> = {
    status: "completed",
    endedAt: now,
    durationSeconds,
    athleteCount: athleteStats.length,
  };
  if (classType) {
    updateSet.classType = classType;
  }

  const [updated] = await db
    .update(sessions)
    .set(updateSet)
    .where(eq(sessions.id, sessionId))
    .returning();

  // TODO (Spec 10): Trigger async AI summary generation
  // TODO (Spec 12): Trigger async WhatsApp report delivery (2-min delay)

  return ok(updated);
}
