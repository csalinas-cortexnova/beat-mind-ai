import { requireAthleteApi, isAuthError } from "@/lib/auth/guards";
import { validateQuery } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { AthleteProgressQuerySchema } from "@/lib/validations/athlete";
import { db } from "@/lib/db";
import { sessions, sessionAthletes } from "@/lib/db/schema";
import { eq, and, sql, asc, count, avg, sum } from "drizzle-orm";
import { calculateTrend } from "@/lib/utils/trend";

export async function GET(request: Request) {
  const authResult = await requireAthleteApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  const { searchParams } = new URL(request.url);
  const validation = validateQuery(AthleteProgressQuerySchema, searchParams);
  if (!validation.success) return validation.response;

  const { period } = validation.data;
  const truncFn = period === "weekly" ? "week" : "month";

  // Aggregate session data by period
  const rows = await db
    .select({
      period: sql<string>`date_trunc(${truncFn}, ${sessions.startedAt})::date`,
      sessionCount: count(sessionAthletes.id),
      avgHr: avg(sessionAthletes.avgHr),
      totalCalories: sum(sessionAthletes.calories),
    })
    .from(sessionAthletes)
    .innerJoin(sessions, and(
      eq(sessions.id, sessionAthletes.sessionId),
      eq(sessions.status, "completed"),
    ))
    .where(eq(sessionAthletes.athleteId, authResult.athleteId))
    .groupBy(sql`date_trunc(${truncFn}, ${sessions.startedAt})`)
    .orderBy(asc(sql`date_trunc(${truncFn}, ${sessions.startedAt})`));

  // Compute summary
  const totalSessions = rows.reduce((sum, r) => sum + Number(r.sessionCount), 0);
  const avgHrValues = rows
    .map((r) => Number(r.avgHr))
    .filter((v) => !isNaN(v));
  const overallAvgHr = avgHrValues.length > 0
    ? Math.round(avgHrValues.reduce((s, v) => s + v, 0) / avgHrValues.length)
    : 0;
  const totalCalories = rows.reduce((sum, r) => sum + Number(r.totalCalories || 0), 0);

  // Compute trend from session counts
  const sessionCounts = rows.map((r) => Number(r.sessionCount));
  const trend = calculateTrend(sessionCounts);

  return ok({
    period,
    data: rows.map((r) => ({
      period: r.period,
      sessionCount: Number(r.sessionCount),
      avgHr: r.avgHr ? Math.round(Number(r.avgHr)) : null,
      totalCalories: Number(r.totalCalories || 0),
    })),
    summary: {
      totalSessions,
      avgHr: overallAvgHr,
      totalCalories,
    },
    trend,
  });
}
