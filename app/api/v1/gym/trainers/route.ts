import { requireGymOwnerApi, isAuthError } from "@/lib/auth/guards";
import { validateBody } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { InviteTrainerSchema } from "@/lib/validations/trainer";
import { db } from "@/lib/db";
import { gymMemberships, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";

export async function GET(_request: Request) {
  // 1. Auth — owner only
  const authResult = await requireGymOwnerApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // 2. Fetch trainers (gym_memberships joined with users where role = 'trainer')
  const rows = await db
    .select({
      membershipId: gymMemberships.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: gymMemberships.role,
      isActive: gymMemberships.isActive,
      createdAt: gymMemberships.createdAt,
    })
    .from(gymMemberships)
    .innerJoin(users, eq(gymMemberships.userId, users.id))
    .where(
      and(
        eq(gymMemberships.gymId, authResult.gymId),
        eq(gymMemberships.role, "trainer")
      )
    );

  return ok({ data: rows });
}

export async function POST(request: Request) {
  // 1. Auth — owner only
  const authResult = await requireGymOwnerApi();
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
  const validation = validateBody(InviteTrainerSchema, body);
  if (!validation.success) return validation.response;

  const { email: trainerEmail, name } = validation.data;

  // 4. Check if email is already a member of this gym
  const existing = await db
    .select({ id: gymMemberships.id })
    .from(gymMemberships)
    .innerJoin(users, eq(gymMemberships.userId, users.id))
    .where(
      and(
        eq(gymMemberships.gymId, authResult.gymId),
        eq(users.email, trainerEmail)
      )
    );

  if (existing.length > 0) {
    return error(
      "This email is already a member of this gym",
      ApiErrorCode.ALREADY_MEMBER,
      409
    );
  }

  // 5. Create Clerk org invitation — do NOT create DB rows
  // The webhook handler (organizationMembership.created) handles that
  try {
    const clerk = await clerkClient();
    await clerk.organizations.createOrganizationInvitation({
      organizationId: authResult.orgId,
      emailAddress: trainerEmail,
      role: "org:trainer",
      inviterUserId: authResult.user.clerkUserId,
    });
  } catch (err) {
    return error(
      `Failed to send invitation: ${err instanceof Error ? err.message : "Unknown error"}`,
      ApiErrorCode.CLERK_ERROR,
      502
    );
  }

  return ok({ email: trainerEmail, name, status: "invited" }, 201);
}
