import { requireGymAccessApi, isAuthError } from "@/lib/auth/guards";
import { validateBody } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { UuidParamSchema } from "@/lib/validations/common";
import { UpdateAthleteSchema } from "@/lib/validations/athlete";
import { db } from "@/lib/db";
import { athletes, athleteBands } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
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
  const validation = validateBody(UpdateAthleteSchema, body);
  if (!validation.success) return validation.response;

  const data = validation.data;

  // 5. Check athlete exists in this gym
  const existing = await db
    .select({ id: athletes.id, gymId: athletes.gymId, email: athletes.email })
    .from(athletes)
    .where(and(eq(athletes.id, id), eq(athletes.gymId, authResult.gymId)));

  if (existing.length === 0) {
    return error("Athlete not found", ApiErrorCode.ATHLETE_NOT_FOUND, 404);
  }

  // 6. Check email uniqueness within gym (if email is being changed)
  if (data.email !== undefined && data.email !== null) {
    const emailConflict = await db
      .select({ id: athletes.id })
      .from(athletes)
      .where(
        and(
          eq(athletes.gymId, authResult.gymId),
          eq(athletes.email, data.email)
        )
      );

    // Exclude self from conflict check
    if (emailConflict.length > 0 && emailConflict[0].id !== id) {
      return error(
        "An athlete with this email already exists in this gym",
        ApiErrorCode.EMAIL_ALREADY_EXISTS,
        409
      );
    }
  }

  // 7. Update athlete
  const [updated] = await db
    .update(athletes)
    .set({
      ...data,
      weightKg: data.weightKg !== undefined ? (data.weightKg !== null ? String(data.weightKg) : null) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(athletes.id, id))
    .returning();

  // 8. Side effect: deactivate bands if setting isActive=false
  if (data.isActive === false) {
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
  }

  return ok(updated);
}
