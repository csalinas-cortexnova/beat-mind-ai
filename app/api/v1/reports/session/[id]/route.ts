import { NextRequest } from "next/server";
import { ok, error } from "@/lib/api/response";
import { db } from "@/lib/db";
import {
  sessions,
  sessionAthletes,
  athletes,
  gyms,
  hrReadings,
  users,
} from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { validateReportToken } from "@/lib/reports/token";
import { downsampleHrData } from "@/lib/utils/downsample";
import { requireGymAccessApi, isAuthError } from "@/lib/auth/guards";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const athleteIdFilter = searchParams.get("athleteId");
  const token = searchParams.get("token");

  // Dual auth: try Clerk first, then token
  let gymId: string | null = null;
  let isTokenAuth = false;
  let tokenAthleteId: string | null = null;

  const authResult = await requireGymAccessApi();
  if (isAuthError(authResult)) {
    // Clerk auth failed, try token
    if (token) {
      const tokenData = validateReportToken(token);
      if (tokenData && tokenData.sessionId === sessionId) {
        gymId = tokenData.gymId;
        isTokenAuth = true;
        tokenAthleteId = tokenData.athleteId;
      }
    }
    if (!gymId) {
      return error("Unauthorized", "UNAUTHORIZED", 401);
    }
  } else {
    gymId = authResult.gymId;
  }

  // Fetch session (scoped to gym)
  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.gymId, gymId)),
  });

  if (!session) {
    return error("Session not found", "NOT_FOUND", 404);
  }

  // Fetch gym branding
  const gym = await db.query.gyms.findFirst({
    where: eq(gyms.id, gymId),
    columns: {
      id: true,
      name: true,
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
    },
  });

  // Fetch trainer name if present
  let trainerName: string | null = null;
  if (session.trainerId) {
    const trainer = await db.query.users.findFirst({
      where: eq(users.id, session.trainerId),
      columns: { name: true },
    });
    trainerName = trainer?.name ?? null;
  }

  // Determine which athletes to include
  const effectiveAthleteId = isTokenAuth ? tokenAthleteId : athleteIdFilter;

  // Fetch session_athletes joined with athletes
  const saConditions = [eq(sessionAthletes.sessionId, sessionId)];
  if (effectiveAthleteId) {
    saConditions.push(eq(sessionAthletes.athleteId, effectiveAthleteId));
  }

  const saRows = await db
    .select()
    .from(sessionAthletes)
    .innerJoin(athletes, eq(sessionAthletes.athleteId, athletes.id))
    .where(and(...saConditions));

  // For each athlete, fetch downsampled HR readings
  const athleteResults = await Promise.all(
    saRows.map(async (row) => {
      const rawReadings = await db
        .select({
          heartRateBpm: hrReadings.heartRateBpm,
          recordedAt: hrReadings.recordedAt,
        })
        .from(hrReadings)
        .where(
          and(
            eq(hrReadings.sessionId, sessionId),
            eq(hrReadings.athleteId, row.session_athletes.athleteId)
          )
        )
        .orderBy(asc(hrReadings.recordedAt));

      const downsampled = downsampleHrData(
        rawReadings.map((r) => ({
          recordedAt:
            r.recordedAt instanceof Date
              ? r.recordedAt.toISOString()
              : String(r.recordedAt),
          heartRateBpm: r.heartRateBpm,
        })),
        500
      );

      return {
        id: row.athletes.id,
        name: row.athletes.name,
        avgHr: row.session_athletes.avgHr,
        maxHr: row.session_athletes.maxHr,
        minHr: row.session_athletes.minHr,
        calories: row.session_athletes.calories,
        timeZone1s: row.session_athletes.timeZone1S,
        timeZone2s: row.session_athletes.timeZone2S,
        timeZone3s: row.session_athletes.timeZone3S,
        timeZone4s: row.session_athletes.timeZone4S,
        timeZone5s: row.session_athletes.timeZone5S,
        hrReadings: downsampled.map((r) => ({
          bpm: r.heartRateBpm,
          timestamp: r.recordedAt,
        })),
      };
    })
  );

  return ok({
    session: {
      id: session.id,
      gymId: session.gymId,
      classType: session.classType,
      status: session.status,
      startedAt:
        session.startedAt instanceof Date
          ? session.startedAt.toISOString()
          : String(session.startedAt),
      endedAt: session.endedAt
        ? session.endedAt instanceof Date
          ? session.endedAt.toISOString()
          : String(session.endedAt)
        : null,
      durationSeconds: session.durationSeconds,
      athleteCount: session.athleteCount,
      aiSummary: session.aiSummary,
      trainer: session.trainerId
        ? { id: session.trainerId, name: trainerName }
        : null,
    },
    gym: gym
      ? {
          id: gym.id,
          name: gym.name,
          logoUrl: gym.logoUrl,
          primaryColor: gym.primaryColor,
          secondaryColor: gym.secondaryColor,
        }
      : null,
    athletes: athleteResults,
  });
}
