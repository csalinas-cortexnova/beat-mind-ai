import { requireAthleteApi, isAuthError } from "@/lib/auth/guards";
import { validateQuery } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { PaginationSchema, paginationMeta, paginationOffsetLimit } from "@/lib/api/pagination";
import { db } from "@/lib/db";
import { sessions, sessionAthletes, gyms } from "@/lib/db/schema";
import { eq, desc, count } from "drizzle-orm";

function shapeSession(row: Record<string, unknown>) {
  const {
    timeZone1S, timeZone2S, timeZone3S, timeZone4S, timeZone5S,
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

export async function GET(request: Request) {
  const authResult = await requireAthleteApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  const { searchParams } = new URL(request.url);
  const validation = validateQuery(PaginationSchema, searchParams);
  if (!validation.success) return validation.response;

  const { page, limit } = validation.data;
  const { offset } = paginationOffsetLimit({ page, limit });

  // Fetch sessions this athlete participated in
  const rows = await db
    .select({
      sessionId: sessions.id,
      classType: sessions.classType,
      status: sessions.status,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      durationSeconds: sessions.durationSeconds,
      gymName: gyms.name,
      avgHr: sessionAthletes.avgHr,
      maxHr: sessionAthletes.maxHr,
      minHr: sessionAthletes.minHr,
      calories: sessionAthletes.calories,
      timeZone1S: sessionAthletes.timeZone1S,
      timeZone2S: sessionAthletes.timeZone2S,
      timeZone3S: sessionAthletes.timeZone3S,
      timeZone4S: sessionAthletes.timeZone4S,
      timeZone5S: sessionAthletes.timeZone5S,
    })
    .from(sessionAthletes)
    .innerJoin(sessions, eq(sessions.id, sessionAthletes.sessionId))
    .leftJoin(gyms, eq(gyms.id, sessions.gymId))
    .where(eq(sessionAthletes.athleteId, authResult.athleteId))
    .orderBy(desc(sessions.startedAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: count() })
    .from(sessionAthletes)
    .where(eq(sessionAthletes.athleteId, authResult.athleteId));

  return ok({
    data: rows.map((r) => shapeSession(r as unknown as Record<string, unknown>)),
    pagination: paginationMeta(Number(total), { page, limit }),
  });
}
