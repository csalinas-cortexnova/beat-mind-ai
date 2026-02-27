/**
 * Auth types for BeatMind AI.
 * Used across guards, middleware, and route handlers.
 */

/** Authenticated user from Clerk + DB lookup */
export interface AuthenticatedUser {
  clerkUserId: string;
  dbUserId: string;
  email: string;
  isSuperAdmin: boolean;
}

/** User with gym context (owner/trainer accessing gym routes) */
export interface GymContext {
  user: AuthenticatedUser;
  gymId: string;
  orgId: string;
  role: "owner" | "trainer";
}

/** User with athlete context */
export interface AthleteContext {
  user: AuthenticatedUser;
  gymId: string;
  orgId: string;
  athleteId: string;
}

/** Local agent (mini PC) context */
export interface AgentContext {
  agentId: string;
  gymId: string;
}

/** TV dashboard context */
export interface TvContext {
  gymId: string;
}

/** Union of all auth error responses */
export interface AuthError {
  error: string;
  status: 401 | 403;
}
