import { requireGymAccessApi, isAuthError } from "@/lib/auth/guards";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { paginationMeta, paginationOffsetLimit } from "@/lib/api/pagination";
import { ListAthletesQuerySchema } from "@/lib/validations/gym-queries";
import { CreateAthleteSchema } from "@/lib/validations/athlete";
import { db } from "@/lib/db";
import { athletes, athleteBands, gyms } from "@/lib/db/schema";
import { eq, and, or, ilike, count, desc } from "drizzle-orm";

export async function GET(request: Request) {
  // 1. Auth
  const authResult = await requireGymAccessApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // 2. Validate query params
  const { searchParams } = new URL(request.url);
  const validation = validateQuery(ListAthletesQuerySchema, searchParams);
  if (!validation.success) return validation.response;

  const { page, limit, search, active } = validation.data;
  const { offset } = paginationOffsetLimit({ page, limit });

  // 3. Build filters
  const conditions = [eq(athletes.gymId, authResult.gymId)];
  if (active !== undefined) {
    conditions.push(eq(athletes.isActive, active));
  }
  if (search) {
    conditions.push(
      or(
        ilike(athletes.name, `%${search}%`),
        ilike(athletes.email, `%${search}%`)
      )!
    );
  }

  const whereClause = and(...conditions);

  // 4. Fetch athletes with active band (left join via subquery)
  const rows = await db
    .select({
      id: athletes.id,
      gymId: athletes.gymId,
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
    })
    .from(athletes)
    .where(whereClause)
    .orderBy(desc(athletes.createdAt))
    .limit(limit)
    .offset(offset);

  // 5. Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(athletes)
    .where(whereClause);

  // 6. Shape response
  const data = rows.map((row) => ({
    id: row.id,
    gymId: row.gymId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    age: row.age,
    weightKg: row.weightKg,
    maxHr: row.maxHr,
    whatsappOptIn: row.whatsappOptIn,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    band: row.bandSensorId
      ? { sensorId: row.bandSensorId, label: row.bandLabel }
      : null,
  }));

  return ok({
    data,
    pagination: paginationMeta(Number(total), { page, limit }),
  });
}

export async function POST(request: Request) {
  // 1. Auth
  const authResult = await requireGymAccessApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // 2. Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body", ApiErrorCode.VALIDATION_ERROR, 422);
  }

  // 3. Validate
  const validation = validateBody(CreateAthleteSchema, body);
  if (!validation.success) return validation.response;

  const data = validation.data;

  // 4. Check max athletes limit
  const [gym] = await db
    .select({ maxAthletes: gyms.maxAthletes })
    .from(gyms)
    .where(eq(gyms.id, authResult.gymId));

  const [{ count: activeCount }] = await db
    .select({ count: count() })
    .from(athletes)
    .where(and(eq(athletes.gymId, authResult.gymId), eq(athletes.isActive, true)));

  if (Number(activeCount) >= gym.maxAthletes) {
    return error(
      "Maximum number of athletes reached for this gym",
      ApiErrorCode.MAX_ATHLETES_REACHED,
      409
    );
  }

  // 5. Check email uniqueness within gym (if email provided)
  if (data.email) {
    const existing = await db
      .select({ id: athletes.id })
      .from(athletes)
      .where(
        and(
          eq(athletes.gymId, authResult.gymId),
          eq(athletes.email, data.email)
        )
      );

    if (existing.length > 0) {
      return error(
        "An athlete with this email already exists in this gym",
        ApiErrorCode.EMAIL_ALREADY_EXISTS,
        409
      );
    }
  }

  // 6. Insert athlete
  const [created] = await db
    .insert(athletes)
    .values({
      gymId: authResult.gymId,
      name: data.name,
      email: data.email ?? null,
      phone: data.phone ?? null,
      age: data.age ?? null,
      weightKg: data.weightKg ? String(data.weightKg) : null,
      maxHr: data.maxHr,
      whatsappOptIn: data.whatsappOptIn,
    })
    .returning();

  return ok(created, 201);
}
