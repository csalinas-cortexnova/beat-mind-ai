import { requireAthleteApi, isAuthError } from "@/lib/auth/guards";
import { validateBody } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { UpdateAthleteProfileSchema } from "@/lib/validations/athlete";
import { db } from "@/lib/db";
import { athletes, athleteBands, gyms, sessions, sessionAthletes } from "@/lib/db/schema";
import { eq, and, sql, count, max, desc } from "drizzle-orm";
import { calculateWeeklyStreak } from "@/lib/utils/weekly-streak";

function shapeProfile(row: Record<string, unknown>, weekStarts: string[]) {
  const {
    bandSensorId, bandLabel, gymName,
    totalSessions, lastSessionAt,
    ...athlete
  } = row;

  return {
    ...athlete,
    gymName,
    band: bandSensorId ? { sensorId: bandSensorId, label: bandLabel } : null,
    stats: {
      totalSessions: totalSessions ?? 0,
      lastSessionAt: lastSessionAt ?? null,
      weeklyStreak: calculateWeeklyStreak(weekStarts),
    },
  };
}

export async function GET(_request: Request) {
  const authResult = await requireAthleteApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // Fetch athlete profile with band, gym, and session stats
  const rows = await db
    .select({
      id: athletes.id,
      name: athletes.name,
      email: athletes.email,
      phone: athletes.phone,
      age: athletes.age,
      weightKg: athletes.weightKg,
      maxHr: athletes.maxHr,
      whatsappOptIn: athletes.whatsappOptIn,
      isActive: athletes.isActive,
      createdAt: athletes.createdAt,
      updatedAt: athletes.updatedAt,
      bandSensorId: athleteBands.sensorId,
      bandLabel: athleteBands.bandLabel,
      gymName: gyms.name,
      totalSessions: count(sessionAthletes.id),
      lastSessionAt: max(sessions.startedAt),
    })
    .from(athletes)
    .leftJoin(athleteBands, and(
      eq(athleteBands.athleteId, athletes.id),
      eq(athleteBands.isActive, true),
    ))
    .leftJoin(gyms, eq(gyms.id, athletes.gymId))
    .leftJoin(sessionAthletes, eq(sessionAthletes.athleteId, athletes.id))
    .leftJoin(sessions, eq(sessions.id, sessionAthletes.sessionId))
    .where(eq(athletes.id, authResult.athleteId))
    .groupBy(
      athletes.id,
      athleteBands.sensorId,
      athleteBands.bandLabel,
      gyms.name,
    );

  if (rows.length === 0) {
    return error("Athlete not found", ApiErrorCode.ATHLETE_NOT_FOUND, 404);
  }

  // Fetch week starts for streak calculation
  const weekRows = await db
    .select({
      weekStart: sql<string>`date_trunc('week', ${sessions.startedAt})::date`,
    })
    .from(sessionAthletes)
    .innerJoin(sessions, eq(sessions.id, sessionAthletes.sessionId))
    .where(eq(sessionAthletes.athleteId, authResult.athleteId))
    .groupBy(sql`date_trunc('week', ${sessions.startedAt})`)
    .orderBy(desc(sql`date_trunc('week', ${sessions.startedAt})`));

  const weekStarts = weekRows.map((r) => String(r.weekStart));

  return ok(shapeProfile(rows[0] as unknown as Record<string, unknown>, weekStarts));
}

export async function PATCH(request: Request) {
  const authResult = await requireAthleteApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body", ApiErrorCode.VALIDATION_ERROR, 422);
  }

  const validation = validateBody(UpdateAthleteProfileSchema, body);
  if (!validation.success) return validation.response;

  const updateSet: Record<string, unknown> = { ...validation.data };
  updateSet.updatedAt = sql`now()`;

  const [updated] = await db
    .update(athletes)
    .set(updateSet)
    .where(eq(athletes.id, authResult.athleteId))
    .returning();

  return ok(updated);
}
