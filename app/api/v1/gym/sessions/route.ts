import { requireGymAccessApi, isAuthError } from "@/lib/auth/guards";
import { validateQuery } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { paginationMeta, paginationOffsetLimit } from "@/lib/api/pagination";
import { ListSessionsQuerySchema } from "@/lib/validations/gym-queries";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { eq, and, gte, lte, desc, count } from "drizzle-orm";

export async function GET(request: Request) {
  // 1. Auth — any gym member
  const authResult = await requireGymAccessApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // 2. Validate query params
  const { searchParams } = new URL(request.url);
  const validation = validateQuery(ListSessionsQuerySchema, searchParams);
  if (!validation.success) return validation.response;

  const { page, limit, status, from, to } = validation.data;
  const { offset } = paginationOffsetLimit({ page, limit });

  // 3. Build filters
  const conditions = [eq(sessions.gymId, authResult.gymId)];
  if (status) {
    conditions.push(eq(sessions.status, status));
  }
  if (from) {
    conditions.push(gte(sessions.startedAt, new Date(from)));
  }
  if (to) {
    conditions.push(lte(sessions.startedAt, new Date(to)));
  }

  const whereClause = and(...conditions);

  // 4. Fetch sessions with trainer name
  const rows = await db
    .select({
      id: sessions.id,
      gymId: sessions.gymId,
      classType: sessions.classType,
      status: sessions.status,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      durationSeconds: sessions.durationSeconds,
      athleteCount: sessions.athleteCount,
      trainerName: users.name,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .leftJoin(users, eq(sessions.trainerId, users.id))
    .where(whereClause)
    .orderBy(desc(sessions.startedAt))
    .limit(limit)
    .offset(offset);

  // 5. Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(sessions)
    .where(whereClause);

  return ok({
    data: rows,
    pagination: paginationMeta(Number(total), { page, limit }),
  });
}
