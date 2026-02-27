import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { users, gyms } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type {
  AuthenticatedUser,
  GymContext,
  AthleteContext,
  AuthError,
} from "./types";
import { athletes } from "@/lib/db/schema";

// ─── Helpers ────────────────────────────────────────────

/** Type guard to check if a result is an AuthError */
export function isAuthError(result: unknown): result is AuthError {
  return (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    "status" in result
  );
}

/** Clerk orgRole → our GymContext role */
function mapOrgRole(orgRole: string | null | undefined): "owner" | "trainer" {
  return orgRole === "org:admin" ? "owner" : "trainer";
}

/** Lookup DB user by Clerk ID */
async function findDbUser(clerkUserId: string) {
  const rows = await db
    .select({
      id: users.id,
      clerkUserId: users.clerkUserId,
      email: users.email,
      isSuperadmin: users.isSuperadmin,
    })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId));
  return rows[0] ?? null;
}

/** Lookup gym by Clerk org ID */
async function findGymByOrg(orgId: string) {
  const rows = await db
    .select({ id: gyms.id })
    .from(gyms)
    .where(eq(gyms.clerkOrgId, orgId));
  return rows[0] ?? null;
}

/** Build AuthenticatedUser from DB row */
function toAuthUser(
  clerkUserId: string,
  dbUser: { id: string; email: string; isSuperadmin: boolean }
): AuthenticatedUser {
  return {
    clerkUserId,
    dbUserId: dbUser.id,
    email: dbUser.email,
    isSuperAdmin: dbUser.isSuperadmin,
  };
}

// ─── Page Guards (redirect on failure) ──────────────────

/**
 * Require the current user to be a SuperAdmin.
 * Redirects to /sign-in or /unauthorized on failure.
 */
export async function requireSuperAdmin(): Promise<AuthenticatedUser> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const dbUser = await findDbUser(userId);
  if (!dbUser || !dbUser.isSuperadmin) redirect("/unauthorized");

  return toAuthUser(userId, dbUser);
}

/**
 * Require gym access (owner or trainer role).
 * Optionally validates that the gym matches an explicit gymId.
 */
export async function requireGymAccess(gymId?: string): Promise<GymContext> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/unauthorized");
  if (orgRole === "org:athlete") redirect("/unauthorized");

  const gym = await findGymByOrg(orgId);
  if (!gym) redirect("/unauthorized");
  if (gymId && gym.id !== gymId) redirect("/unauthorized");

  const dbUser = await findDbUser(userId);
  if (!dbUser) redirect("/unauthorized");

  return {
    user: toAuthUser(userId, dbUser),
    gymId: gym.id,
    orgId,
    role: mapOrgRole(orgRole),
  };
}

/**
 * Require gym owner (org:admin) role. Trainers are redirected.
 */
export async function requireGymOwner(): Promise<GymContext> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId || orgRole !== "org:admin") redirect("/unauthorized");

  const gym = await findGymByOrg(orgId);
  if (!gym) redirect("/unauthorized");

  const dbUser = await findDbUser(userId);
  if (!dbUser) redirect("/unauthorized");

  return {
    user: toAuthUser(userId, dbUser),
    gymId: gym.id,
    orgId,
    role: "owner",
  };
}

/**
 * Require trainer-level access (admin or trainer both OK).
 */
export async function requireTrainer(): Promise<GymContext> {
  return requireGymAccess();
}

/**
 * Require athlete role with active athlete record.
 */
export async function requireAthlete(): Promise<AthleteContext> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId || orgRole !== "org:athlete") redirect("/unauthorized");

  const gym = await findGymByOrg(orgId);
  if (!gym) redirect("/unauthorized");

  const dbUser = await findDbUser(userId);
  if (!dbUser) redirect("/unauthorized");

  const athleteRows = await db
    .select({ id: athletes.id })
    .from(athletes)
    .where(eq(athletes.userId, dbUser.id));

  if (athleteRows.length === 0) redirect("/unauthorized");

  return {
    user: toAuthUser(userId, dbUser),
    gymId: gym.id,
    orgId,
    athleteId: athleteRows[0].id,
  };
}

// ─── API Guards (return JSON errors) ───────────────────

/**
 * API version of requireSuperAdmin.
 * Returns AuthError instead of redirecting.
 */
export async function requireSuperAdminApi(): Promise<
  AuthenticatedUser | AuthError
> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized", status: 401 };

  const dbUser = await findDbUser(userId);
  if (!dbUser || !dbUser.isSuperadmin)
    return { error: "Forbidden", status: 403 };

  return toAuthUser(userId, dbUser);
}

/**
 * API version of requireGymAccess.
 * Returns AuthError instead of redirecting.
 */
export async function requireGymAccessApi(
  gymId?: string
): Promise<GymContext | AuthError> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) return { error: "Unauthorized", status: 401 };
  if (!orgId) return { error: "Forbidden", status: 403 };
  if (orgRole === "org:athlete") return { error: "Forbidden", status: 403 };

  const gym = await findGymByOrg(orgId);
  if (!gym) return { error: "Forbidden", status: 403 };
  if (gymId && gym.id !== gymId) return { error: "Forbidden", status: 403 };

  const dbUser = await findDbUser(userId);
  if (!dbUser) return { error: "Forbidden", status: 403 };

  return {
    user: toAuthUser(userId, dbUser),
    gymId: gym.id,
    orgId,
    role: mapOrgRole(orgRole),
  };
}
