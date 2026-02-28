import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/api/rate-limit";

// --- Public route patterns ---
const PUBLIC_PATTERNS = [
  "/",
  "/sign-in",
  "/sign-up",
  "/api/webhooks",
  "/api/tv",
  "/api/agent",
  "/tv",
  "/reports",
  "/api/v1/reports",
];

function isPublicPath(pathname: string): boolean {
  for (const pattern of PUBLIC_PATTERNS) {
    if (pattern === "/") {
      if (pathname === "/") return true;
    } else {
      if (pathname === pattern || pathname.startsWith(pattern + "/")) return true;
    }
  }
  return false;
}

// --- Testable route decision logic ---
export type RouteAuthData = {
  userId: string | null;
  orgId: string | null;
  orgRole: string | null;
  sessionClaims: Record<string, unknown> | null;
};

export type RouteDecision =
  | { action: "allow" }
  | { action: "require-auth" }
  | { action: "redirect"; url: string };

export function getRouteDecision(
  pathname: string,
  authData: RouteAuthData
): RouteDecision {
  // Public routes: always allow
  if (isPublicPath(pathname)) {
    return { action: "allow" };
  }

  // Unauthenticated users must sign in
  if (!authData.userId) {
    return { action: "require-auth" };
  }

  // SuperAdmin routes
  if (pathname.startsWith("/superadmin")) {
    const claims = authData.sessionClaims as Record<string, unknown> | null;
    const metadata = claims?.metadata as Record<string, unknown> | undefined;
    const isSA = metadata?.isSuperAdmin === true;
    if (!isSA) {
      return { action: "redirect", url: "/unauthorized" };
    }
    return { action: "allow" };
  }

  // Gym routes: require org membership, exclude athletes
  if (pathname.startsWith("/gym")) {
    if (!authData.orgId) {
      return { action: "redirect", url: "/unauthorized" };
    }
    if (authData.orgRole === "org:athlete") {
      return { action: "redirect", url: "/unauthorized" };
    }
    return { action: "allow" };
  }

  // Athlete routes: require org membership with athlete role
  if (pathname.startsWith("/athlete")) {
    if (!authData.orgId || authData.orgRole !== "org:athlete") {
      return { action: "redirect", url: "/unauthorized" };
    }
    return { action: "allow" };
  }

  // All other authenticated routes: allow
  return { action: "allow" };
}

// --- IP extraction ---
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "unknown";
}

// --- Clerk middleware integration ---
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/tv(.*)",
  "/api/agent(.*)",
  "/tv(.*)",
  "/reports(.*)",
  "/api/v1/reports(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  const { pathname } = request.nextUrl;

  // Rate limit: IP-based for all API routes (before auth)
  if (pathname.startsWith("/api/")) {
    const ip = getClientIp(request);
    const ipResult = checkRateLimit(
      `ip:${ip}`,
      RATE_LIMITS.UNAUTHENTICATED_API
    );
    if (!ipResult.allowed) {
      return rateLimitResponse(ipResult.retryAfterS);
    }
  }

  // Allow public routes without auth
  if (isPublicRoute(request)) {
    return;
  }

  // All other routes require auth
  const { userId, orgId, orgRole, sessionClaims } = await auth.protect();

  // Rate limit: user-based for authenticated V1 API routes
  if (pathname.startsWith("/api/v1/") && userId) {
    const userResult = checkRateLimit(
      `user:${userId}`,
      RATE_LIMITS.AUTHENTICATED_API
    );
    if (!userResult.allowed) {
      return rateLimitResponse(userResult.retryAfterS);
    }
  }

  const decision = getRouteDecision(pathname, {
    userId,
    orgId: orgId ?? null,
    orgRole: orgRole ?? null,
    sessionClaims: (sessionClaims as Record<string, unknown>) ?? null,
  });

  if (decision.action === "redirect") {
    return Response.redirect(new URL(decision.url, request.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
