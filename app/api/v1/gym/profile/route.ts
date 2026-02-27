import { requireGymAccessApi, requireGymOwnerApi, isAuthError } from "@/lib/auth/guards";
import { validateBody } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { UpdateGymProfileSchema } from "@/lib/validations/gym";
import { db } from "@/lib/db";
import { gyms } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

function shapeGymProfile(gym: Record<string, unknown>, role: string) {
  const {
    logoUrl, primaryColor, secondaryColor, tvAccessToken,
    ...rest
  } = gym;

  const shaped: Record<string, unknown> = {
    ...rest,
    branding: { logoUrl, primaryColor, secondaryColor },
  };

  if (role === "owner") {
    shaped.tvAccessToken = tvAccessToken;
  }

  return shaped;
}

export async function GET(_request: Request) {
  // 1. Auth — any gym member (owner or trainer)
  const authResult = await requireGymAccessApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // 2. Fetch gym profile
  const rows = await db
    .select({
      id: gyms.id,
      name: gyms.name,
      slug: gyms.slug,
      address: gyms.address,
      phone: gyms.phone,
      timezone: gyms.timezone,
      language: gyms.language,
      logoUrl: gyms.logoUrl,
      primaryColor: gyms.primaryColor,
      secondaryColor: gyms.secondaryColor,
      tvAccessToken: gyms.tvAccessToken,
      subscriptionStatus: gyms.subscriptionStatus,
      subscriptionPlan: gyms.subscriptionPlan,
      maxAthletes: gyms.maxAthletes,
      createdAt: gyms.createdAt,
      updatedAt: gyms.updatedAt,
    })
    .from(gyms)
    .where(eq(gyms.id, authResult.gymId));

  if (rows.length === 0) {
    return error("Gym not found", ApiErrorCode.GYM_NOT_FOUND, 404);
  }

  return ok(shapeGymProfile(rows[0] as unknown as Record<string, unknown>, authResult.role));
}

export async function PATCH(request: Request) {
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
  const validation = validateBody(UpdateGymProfileSchema, body);
  if (!validation.success) return validation.response;

  const { branding, ...directFields } = validation.data;

  // 4. Build update set — flatten branding into individual columns
  const updateSet: Record<string, unknown> = { ...directFields };
  if (branding) {
    if (branding.logoUrl !== undefined) updateSet.logoUrl = branding.logoUrl;
    if (branding.primaryColor !== undefined) updateSet.primaryColor = branding.primaryColor;
    if (branding.secondaryColor !== undefined) updateSet.secondaryColor = branding.secondaryColor;
  }
  updateSet.updatedAt = sql`now()`;

  // 5. Update
  const [updated] = await db
    .update(gyms)
    .set(updateSet)
    .where(eq(gyms.id, authResult.gymId))
    .returning();

  return ok(shapeGymProfile(updated as unknown as Record<string, unknown>, "owner"));
}
