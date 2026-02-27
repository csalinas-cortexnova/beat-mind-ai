import { requireSuperAdminApi, isAuthError } from "@/lib/auth/guards";
import { validateBody } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { UuidParamSchema } from "@/lib/validations/common";
import { UpdateGymSchema } from "@/lib/validations/gym";
import { db } from "@/lib/db";
import { gyms } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Auth
  const authResult = await requireSuperAdminApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // 2. Validate UUID param
  const { id } = await params;
  const paramValidation = UuidParamSchema.safeParse({ id });
  if (!paramValidation.success) {
    return error("Invalid gym ID", ApiErrorCode.VALIDATION_ERROR, 422);
  }

  // 3. Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body", ApiErrorCode.VALIDATION_ERROR, 422);
  }

  // 4. Validate body
  const validation = validateBody(UpdateGymSchema, body);
  if (!validation.success) return validation.response;

  const data = validation.data;

  // 5. Check gym exists
  const existing = await db
    .select({
      id: gyms.id,
      clerkOrgId: gyms.clerkOrgId,
      subscriptionStatus: gyms.subscriptionStatus,
    })
    .from(gyms)
    .where(eq(gyms.id, id));

  if (existing.length === 0) {
    return error("Gym not found", ApiErrorCode.GYM_NOT_FOUND, 404);
  }

  const gym = existing[0];

  // 6. Sync Clerk metadata on subscription status change
  if (data.subscriptionStatus && data.subscriptionStatus !== gym.subscriptionStatus) {
    const isSuspending = data.subscriptionStatus === "suspended" || data.subscriptionStatus === "cancelled";
    const isReactivating = data.subscriptionStatus === "active" || data.subscriptionStatus === "trial";

    if (isSuspending || isReactivating) {
      try {
        const clerk = await clerkClient();
        await clerk.organizations.updateOrganizationMetadata(gym.clerkOrgId, {
          publicMetadata: { suspended: isSuspending },
        });
      } catch {
        // Log but don't fail — DB update is more important
      }
    }
  }

  // 7. Update gym
  const [updated] = await db
    .update(gyms)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(gyms.id, id))
    .returning();

  return ok(updated);
}
