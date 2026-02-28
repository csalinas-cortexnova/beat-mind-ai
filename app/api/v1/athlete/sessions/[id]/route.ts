import { requireAthleteApi, isAuthError } from "@/lib/auth/guards";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { sessions, sessionAthletes, hrReadings, aiCoachingMessages } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { downsampleHrData } from "@/lib/utils/downsample";

function shapeParticipation(row: Record<string, unknown>) {
  const {
    timeZone1S, timeZone2S, timeZone3S, timeZone4S, timeZone5S,
    sessionId: _sessionId,
    ...rest
  } = row;

  return {
    ...rest,
    hrZones: {
      zone1: timeZone1S,
      zone2: timeZone2S,
      zone3: timeZone3S,
      zone4: timeZone4S,
      zone5: timeZone5S,
    },
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAthleteApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  const { id: sessionId } = await params;

  // 1. Verify athlete participated in this session
  const participationRows = await db
    .select({
      sessionId: sessionAthletes.sessionId,
      avgHr: sessionAthletes.avgHr,
      maxHr: sessionAthletes.maxHr,
      minHr: sessionAthletes.minHr,
      calories: sessionAthletes.calories,
      timeZone1S: sessionAthletes.timeZone1S,
      timeZone2S: sessionAthletes.timeZone2S,
      timeZone3S: sessionAthletes.timeZone3S,
      timeZone4S: sessionAthletes.timeZone4S,
      timeZone5S: sessionAthletes.timeZone5S,
      joinedAt: sessionAthletes.joinedAt,
      leftAt: sessionAthletes.leftAt,
    })
    .from(sessionAthletes)
    .where(and(
      eq(sessionAthletes.sessionId, sessionId),
      eq(sessionAthletes.athleteId, authResult.athleteId),
    ));

  if (participationRows.length === 0) {
    return error("Session not found", ApiErrorCode.SESSION_NOT_FOUND, 404);
  }

  // 2. Fetch session detail
  const sessionRows = await db
    .select({
      id: sessions.id,
      classType: sessions.classType,
      status: sessions.status,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      durationSeconds: sessions.durationSeconds,
      athleteCount: sessions.athleteCount,
      aiSummary: sessions.aiSummary,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  // 3. Fetch HR readings (downsample if >720)
  const hrRows = await db
    .select({
      recordedAt: hrReadings.recordedAt,
      heartRateBpm: hrReadings.heartRateBpm,
      hrZone: hrReadings.hrZone,
    })
    .from(hrReadings)
    .where(and(
      eq(hrReadings.sessionId, sessionId),
      eq(hrReadings.athleteId, authResult.athleteId),
    ))
    .orderBy(asc(hrReadings.recordedAt));

  // 4. Fetch AI coaching messages
  const aiMessages = await db
    .select({
      id: aiCoachingMessages.id,
      message: aiCoachingMessages.message,
      createdAt: aiCoachingMessages.createdAt,
    })
    .from(aiCoachingMessages)
    .where(eq(aiCoachingMessages.sessionId, sessionId))
    .orderBy(asc(aiCoachingMessages.createdAt));

  // Downsample HR data
  const downsampledHr = downsampleHrData(
    hrRows.map((r) => ({
      recordedAt: String(r.recordedAt),
      heartRateBpm: Number(r.heartRateBpm),
    }))
  );

  return ok({
    session: sessionRows[0] ?? null,
    participation: shapeParticipation(participationRows[0] as unknown as Record<string, unknown>),
    hrReadings: downsampledHr,
    aiMessages,
  });
}
