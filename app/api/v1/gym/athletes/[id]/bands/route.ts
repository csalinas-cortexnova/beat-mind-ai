import { requireGymAccessApi, isAuthError } from "@/lib/auth/guards";
import { validateBody } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { UuidParamSchema } from "@/lib/validations/common";
import { AssignBandSchema } from "@/lib/validations/band";
import { db } from "@/lib/db";
import { athletes, athleteBands } from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Auth
  const authResult = await requireGymAccessApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // 2. Validate UUID param
  const { id } = await params;
  const paramValidation = UuidParamSchema.safeParse({ id });
  if (!paramValidation.success) {
    return error("Invalid athlete ID", ApiErrorCode.VALIDATION_ERROR, 422);
  }

  // 3. Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body", ApiErrorCode.VALIDATION_ERROR, 422);
  }

  // 4. Validate body
  const validation = validateBody(AssignBandSchema, body);
  if (!validation.success) return validation.response;

  const { sensorId, bandLabel } = validation.data;

  // 5. Check athlete exists in this gym
  const existing = await db
    .select({ id: athletes.id, gymId: athletes.gymId, isActive: athletes.isActive })
    .from(athletes)
    .where(and(eq(athletes.id, id), eq(athletes.gymId, authResult.gymId)));

  if (existing.length === 0) {
    return error("Athlete not found", ApiErrorCode.ATHLETE_NOT_FOUND, 404);
  }

  // 6. Check athlete is active
  if (!existing[0].isActive) {
    return error(
      "Cannot assign band to inactive athlete",
      ApiErrorCode.ATHLETE_INACTIVE,
      400
    );
  }

  // 7. Check sensor uniqueness — is this sensor active on a DIFFERENT athlete?
  const sensorConflict = await db
    .select({ id: athleteBands.id, athleteId: athleteBands.athleteId })
    .from(athleteBands)
    .where(
      and(
        eq(athleteBands.gymId, authResult.gymId),
        eq(athleteBands.sensorId, sensorId),
        eq(athleteBands.isActive, true),
        ne(athleteBands.athleteId, id)
      )
    );

  if (sensorConflict.length > 0) {
    return error(
      "This sensor is already assigned to another athlete",
      ApiErrorCode.SENSOR_ALREADY_ASSIGNED,
      409
    );
  }

  // 8. Delete any existing (gymId, sensorId) row — handles the unique constraint
  //    for stale deactivated rows
  await db
    .delete(athleteBands)
    .where(
      and(
        eq(athleteBands.gymId, authResult.gymId),
        eq(athleteBands.sensorId, sensorId)
      )
    );

  // 9. Deactivate current active band for this athlete (soft delete)
  await db
    .update(athleteBands)
    .set({ isActive: false })
    .where(
      and(
        eq(athleteBands.athleteId, id),
        eq(athleteBands.gymId, authResult.gymId),
        eq(athleteBands.isActive, true)
      )
    );

  // 10. Insert new band
  const [created] = await db
    .insert(athleteBands)
    .values({
      athleteId: id,
      gymId: authResult.gymId,
      sensorId,
      bandLabel: bandLabel ?? null,
    })
    .returning();

  return ok(created, 201);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Auth
  const authResult = await requireGymAccessApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // 2. Validate UUID param
  const { id } = await params;
  const paramValidation = UuidParamSchema.safeParse({ id });
  if (!paramValidation.success) {
    return error("Invalid athlete ID", ApiErrorCode.VALIDATION_ERROR, 422);
  }

  // 3. Check athlete exists in this gym
  const existing = await db
    .select({ id: athletes.id, gymId: athletes.gymId })
    .from(athletes)
    .where(and(eq(athletes.id, id), eq(athletes.gymId, authResult.gymId)));

  if (existing.length === 0) {
    return error("Athlete not found", ApiErrorCode.ATHLETE_NOT_FOUND, 404);
  }

  // 4. Deactivate all active bands for this athlete (idempotent)
  await db
    .update(athleteBands)
    .set({ isActive: false })
    .where(
      and(
        eq(athleteBands.athleteId, id),
        eq(athleteBands.gymId, authResult.gymId),
        eq(athleteBands.isActive, true)
      )
    );

  return ok({ message: "Band assignment removed" });
}
