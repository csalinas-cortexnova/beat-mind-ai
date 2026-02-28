// @vitest-environment node
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getRouteDecision, getClientIp } from "../middleware";
import { _resetStore, RATE_LIMITS } from "../lib/api/rate-limit";

type AuthData = {
  userId: string | null;
  orgId: string | null;
  orgRole: string | null;
  sessionClaims: Record<string, unknown> | null;
};

const unauthUser: AuthData = {
  userId: null,
  orgId: null,
  orgRole: null,
  sessionClaims: null,
};

const authedUser: AuthData = {
  userId: "user_123",
  orgId: null,
  orgRole: null,
  sessionClaims: {},
};

const superAdmin: AuthData = {
  userId: "user_sa",
  orgId: null,
  orgRole: null,
  sessionClaims: { metadata: { isSuperAdmin: true } },
};

const gymOwner: AuthData = {
  userId: "user_owner",
  orgId: "org_gym1",
  orgRole: "org:admin",
  sessionClaims: {},
};

const trainer: AuthData = {
  userId: "user_trainer",
  orgId: "org_gym1",
  orgRole: "org:trainer",
  sessionClaims: {},
};

const athlete: AuthData = {
  userId: "user_athlete",
  orgId: "org_gym1",
  orgRole: "org:athlete",
  sessionClaims: {},
};

describe("middleware route protection", () => {
  describe("public routes", () => {
    it("should allow / path", () => {
      const result = getRouteDecision("/", unauthUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow /sign-in", () => {
      const result = getRouteDecision("/sign-in", unauthUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow /sign-in/factor-one", () => {
      const result = getRouteDecision("/sign-in/factor-one", unauthUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow /sign-up", () => {
      const result = getRouteDecision("/sign-up", unauthUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow /sign-up/verify-email", () => {
      const result = getRouteDecision("/sign-up/verify-email", unauthUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow /api/webhooks", () => {
      const result = getRouteDecision("/api/webhooks", unauthUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow /api/webhooks/clerk", () => {
      const result = getRouteDecision("/api/webhooks/clerk", unauthUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow /api/tv/data", () => {
      const result = getRouteDecision("/api/tv/data", unauthUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow /api/agent/heartbeat", () => {
      const result = getRouteDecision("/api/agent/heartbeat", unauthUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow /tv", () => {
      const result = getRouteDecision("/tv", unauthUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow /tv/gym123", () => {
      const result = getRouteDecision("/tv/gym123", unauthUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow /reports without auth (token-based)", () => {
      const result = getRouteDecision("/reports/session/abc/def", unauthUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow /api/v1/reports without auth (token-based)", () => {
      const result = getRouteDecision(
        "/api/v1/reports/session/abc",
        unauthUser
      );
      expect(result).toEqual({ action: "allow" });
    });
  });

  describe("unauthenticated access to protected routes", () => {
    it("should require sign-in for /dashboard", () => {
      const result = getRouteDecision("/dashboard", unauthUser);
      expect(result).toEqual({ action: "require-auth" });
    });

    it("should require sign-in for /superadmin", () => {
      const result = getRouteDecision("/superadmin", unauthUser);
      expect(result).toEqual({ action: "require-auth" });
    });

    it("should require sign-in for /gym/settings", () => {
      const result = getRouteDecision("/gym/settings", unauthUser);
      expect(result).toEqual({ action: "require-auth" });
    });

    it("should require sign-in for /athlete/profile", () => {
      const result = getRouteDecision("/athlete/profile", unauthUser);
      expect(result).toEqual({ action: "require-auth" });
    });
  });

  describe("superadmin routes", () => {
    it("should redirect non-SA from /superadmin to /unauthorized", () => {
      const result = getRouteDecision("/superadmin", authedUser);
      expect(result).toEqual({ action: "redirect", url: "/unauthorized" });
    });

    it("should redirect non-SA with org from /superadmin to /unauthorized", () => {
      const result = getRouteDecision("/superadmin", gymOwner);
      expect(result).toEqual({ action: "redirect", url: "/unauthorized" });
    });

    it("should allow SA on /superadmin", () => {
      const result = getRouteDecision("/superadmin", superAdmin);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow SA on /superadmin/gyms", () => {
      const result = getRouteDecision("/superadmin/gyms", superAdmin);
      expect(result).toEqual({ action: "allow" });
    });

    it("should redirect athlete from /superadmin to /unauthorized", () => {
      const result = getRouteDecision("/superadmin", athlete);
      expect(result).toEqual({ action: "redirect", url: "/unauthorized" });
    });
  });

  describe("gym routes", () => {
    it("should redirect when no org on /gym/dashboard", () => {
      const result = getRouteDecision("/gym/dashboard", authedUser);
      expect(result).toEqual({ action: "redirect", url: "/unauthorized" });
    });

    it("should redirect athlete on /gym/dashboard", () => {
      const result = getRouteDecision("/gym/dashboard", athlete);
      expect(result).toEqual({ action: "redirect", url: "/unauthorized" });
    });

    it("should allow admin on /gym/dashboard", () => {
      const result = getRouteDecision("/gym/dashboard", gymOwner);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow trainer on /gym/classes", () => {
      const result = getRouteDecision("/gym/classes", trainer);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow admin on /gym/settings", () => {
      const result = getRouteDecision("/gym/settings", gymOwner);
      expect(result).toEqual({ action: "allow" });
    });
  });

  describe("athlete routes", () => {
    it("should redirect non-athlete without org on /athlete/profile", () => {
      const result = getRouteDecision("/athlete/profile", authedUser);
      expect(result).toEqual({ action: "redirect", url: "/unauthorized" });
    });

    it("should redirect gym owner on /athlete/profile", () => {
      const result = getRouteDecision("/athlete/profile", gymOwner);
      expect(result).toEqual({ action: "redirect", url: "/unauthorized" });
    });

    it("should redirect trainer on /athlete/history", () => {
      const result = getRouteDecision("/athlete/history", trainer);
      expect(result).toEqual({ action: "redirect", url: "/unauthorized" });
    });

    it("should allow athlete on /athlete/profile", () => {
      const result = getRouteDecision("/athlete/profile", athlete);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow athlete on /athlete/history", () => {
      const result = getRouteDecision("/athlete/history", athlete);
      expect(result).toEqual({ action: "allow" });
    });
  });

  describe("general authenticated routes", () => {
    it("should allow authenticated user on /dashboard", () => {
      const result = getRouteDecision("/dashboard", authedUser);
      expect(result).toEqual({ action: "allow" });
    });

    it("should allow gym owner on /dashboard", () => {
      const result = getRouteDecision("/dashboard", gymOwner);
      expect(result).toEqual({ action: "allow" });
    });
  });
});

describe("getClientIp", () => {
  it("should extract IP from x-forwarded-for header", () => {
    const request = new Request("http://localhost/api/v1/test", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(request)).toBe("1.2.3.4");
  });

  it("should extract IP from x-real-ip header when x-forwarded-for absent", () => {
    const request = new Request("http://localhost/api/v1/test", {
      headers: { "x-real-ip": "10.0.0.1" },
    });
    expect(getClientIp(request)).toBe("10.0.0.1");
  });

  it("should prefer x-forwarded-for over x-real-ip", () => {
    const request = new Request("http://localhost/api/v1/test", {
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "10.0.0.1",
      },
    });
    expect(getClientIp(request)).toBe("1.2.3.4");
  });

  it("should return 'unknown' when no IP headers present", () => {
    const request = new Request("http://localhost/api/v1/test");
    expect(getClientIp(request)).toBe("unknown");
  });
});

describe("middleware rate limiting", () => {
  beforeEach(() => {
    _resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Note: The actual middleware rate limiting is tested through the checkRateLimit
  // unit tests in rate-limit.test.ts. These tests verify the integration points:
  // - getClientIp correctly extracts IPs
  // - Rate limit configs are correct for each route type
  // The middleware itself wraps clerkMiddleware which requires Clerk server context,
  // making direct integration testing complex without E2E setup.

  it("should have correct unauthenticated API rate limit (10/min)", () => {
    expect(RATE_LIMITS.UNAUTHENTICATED_API.maxRequests).toBe(10);
    expect(RATE_LIMITS.UNAUTHENTICATED_API.windowMs).toBe(60_000);
  });

  it("should have correct authenticated API rate limit (100/min)", () => {
    expect(RATE_LIMITS.AUTHENTICATED_API.maxRequests).toBe(100);
    expect(RATE_LIMITS.AUTHENTICATED_API.windowMs).toBe(60_000);
  });

  it("should not rate limit non-API routes", () => {
    // Non-API routes should not be rate-limited
    // The middleware only applies IP rate limits to /api/* paths
    const result = getRouteDecision("/dashboard", authedUser);
    expect(result).toEqual({ action: "allow" });
  });
});
