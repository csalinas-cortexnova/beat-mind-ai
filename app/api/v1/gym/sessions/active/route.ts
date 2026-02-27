import { requireGymAccessApi, isAuthError } from "@/lib/auth/guards";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { sessions, sessionAthletes, athletes, hrReadings, users } from "@/lib/db/schema";
import { eq, and, avg, max, min, count } from "drizzle-orm";

const ACTIVE_THRESHOLD_MS = 30_000; // 30 seconds

export async function GET(_request: Request) {
  // 1. Auth — any gym member
  const authResult = await requireGymAccessApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // 2. Find active session
  const sessionRows = await db
    .select({
      id: sessions.id,
      gymId: sessions.gymId,
      classType: sessions.classType,
      status: sessions.status,
      startedAt: sessions.startedAt,
      athleteCount: sessions.athleteCount,
      trainerName: users.name,
    })
    .from(sessions)
    .leftJoin(users, eq(sessions.trainerId, users.id))
    .where(
      and(
        eq(sessions.gymId, authResult.gymId),
        eq(sessions.status, "active")
      )
    )
    .limit(1);

  if (sessionRows.length === 0) {
    return ok({ session: null });
  }

  const session = sessionRows[0];
  const now = Date.now();
  const startedAt = new Date(session.startedAt as string | Date).getTime();
  const durationSeconds = Math.floor((now - startedAt) / 1000);

  // 3. Get per-athlete live data with latest HR and session aggregates
  const athleteRows = await db
    .select({
      athleteId: sessionAthletes.athleteId,
      athleteName: athletes.name,
      athleteMaxHr: athletes.maxHr,
      sensorId: sessionAthletes.sensorId,
      latestHr: max(hrReadings.heartRateBpm),
      latestZone: max(hrReadings.hrZone),
      latestZoneName: max(hrReadings.hrZoneName),
      latestZoneColor: max(hrReadings.hrZoneColor),
      latestRecordedAt: max(hrReadings.recordedAt),
      avgHr: avg(hrReadings.heartRateBpm),
      maxHr: max(hrReadings.heartRateBpm),
      minHr: min(hrReadings.heartRateBpm),
      readingCount: count(hrReadings.id),
    })
    .from(sessionAthletes)
    .innerJoin(athletes, eq(sessionAthletes.athleteId, athletes.id))
    .leftJoin(
      hrReadings,
      and(
        eq(hrReadings.sessionId, session.id),
        eq(hrReadings.athleteId, sessionAthletes.athleteId)
      )
    )
    .where(eq(sessionAthletes.sessionId, session.id))
    .groupBy(sessionAthletes.athleteId, athletes.name, athletes.maxHr, sessionAthletes.sensorId);

  // 4. Shape athlete data with isActive flag
  const athleteData = athleteRows.map((row) => {
    const lastReading = row.latestRecordedAt
      ? new Date(row.latestRecordedAt as string | Date).getTime()
      : 0;
    const isActive = lastReading > 0 && (now - lastReading) < ACTIVE_THRESHOLD_MS;

    return {
      athleteId: row.athleteId,
      name: row.athleteName,
      maxHr: row.athleteMaxHr,
      sensorId: row.sensorId,
      latestHr: row.latestHr ? Number(row.latestHr) : null,
      latestZone: row.latestZone ? Number(row.latestZone) : null,
      latestZoneName: row.latestZoneName,
      latestZoneColor: row.latestZoneColor,
      avgHr: row.avgHr ? Math.round(Number(row.avgHr)) : null,
      maxHrReading: row.maxHr ? Number(row.maxHr) : null,
      minHr: row.minHr ? Number(row.minHr) : null,
      readingCount: Number(row.readingCount),
      isActive,
    };
  });

  return ok({
    session: {
      id: session.id,
      classType: session.classType,
      status: session.status,
      startedAt: session.startedAt,
      durationSeconds,
      athleteCount: session.athleteCount,
      trainerName: session.trainerName,
      athletes: athleteData,
    },
  });
}
