// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const {
  mockAuth,
  mockQueryResults,
  mockDbUpdateSet,
  mockDbUpdateReturning,
} = vi.hoisted(() => {
  const mockQueryResults: unknown[][] = [];
  const mockDbUpdateReturning = vi.fn();
  const mockDbUpdateWhere = vi.fn(() => ({
    returning: mockDbUpdateReturning,
  }));
  const mockDbUpdateSet = vi.fn(() => ({
    where: mockDbUpdateWhere,
  }));

  return {
    mockAuth: vi.fn(),
    mockQueryResults,
    mockDbUpdateSet,
    mockDbUpdateWhere,
    mockDbUpdateReturning,
  };
});

function queueResults(...results: unknown[][]) {
  mockQueryResults.push(...results);
}

function createChain(): unknown {
  const chain: Record<string, unknown> = {};
  const resolve = () => {
    const result = mockQueryResults.shift() ?? [];
    return Promise.resolve(result);
  };
  for (const method of ["from", "where", "orderBy", "limit", "offset", "groupBy", "leftJoin"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    resolve().then(onFulfilled, onRejected);
  return chain;
}

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => createChain()),
    update: vi.fn(() => ({
      set: mockDbUpdateSet,
    })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", isSuperadmin: "is_superadmin" },
  gyms: {
    id: "id", name: "name", slug: "slug", clerkOrgId: "clerk_org_id",
    address: "address", phone: "phone", timezone: "timezone", language: "language",
    logoUrl: "logo_url", primaryColor: "primary_color", secondaryColor: "secondary_color",
    tvAccessToken: "tv_access_token", subscriptionStatus: "subscription_status",
    subscriptionPlan: "subscription_plan", maxAthletes: "max_athletes",
    createdAt: "created_at", updatedAt: "updated_at",
  },
  athletes: { id: "id", userId: "user_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
    { join: (...args: unknown[]) => ({ join: args }) }
  ),
}));

import { GET, PATCH } from "../route";

const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";

function createGetRequest(): Request {
  return new Request("http://localhost:3000/api/v1/gym/profile", { method: "GET" });
}

function createPatchRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/v1/gym/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupGymAccess(role: string = "org:admin") {
  mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: "org_123", orgRole: role });
  // findGymByOrg
  queueResults([{ id: GYM_ID }]);
  // findDbUser
  queueResults([
    { id: DB_USER_ID, clerkUserId: "clerk_user", email: "owner@test.com", isSuperadmin: false },
  ]);
}

// =========================================================
// GET /api/v1/gym/profile
// =========================================================
describe("GET /api/v1/gym/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await GET(createGetRequest());
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("UNAUTHORIZED");
  });

  it("should return 403 when no org context", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: null });
    const res = await GET(createGetRequest());
    expect(res.status).toBe(403);
  });

  it("should return 404 when gym not found in DB", async () => {
    setupGymAccess();
    // gym profile query
    queueResults([]);
    const res = await GET(createGetRequest());
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("GYM_NOT_FOUND");
  });

  it("should return 200 with gym profile for owner (includes tvAccessToken)", async () => {
    setupGymAccess("org:admin");
    const gym = {
      id: GYM_ID,
      name: "Test Gym",
      slug: "test-gym",
      address: "123 Main St",
      phone: "+1234567890",
      timezone: "America/Sao_Paulo",
      language: "pt-BR",
      logoUrl: "https://example.com/logo.png",
      primaryColor: "#FF0000",
      secondaryColor: "#0000FF",
      tvAccessToken: "tv-token-123",
      subscriptionStatus: "active",
      subscriptionPlan: "pro",
      maxAthletes: 20,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    queueResults([gym]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Test Gym");
    expect(data.branding).toEqual({
      logoUrl: "https://example.com/logo.png",
      primaryColor: "#FF0000",
      secondaryColor: "#0000FF",
    });
    expect(data.tvAccessToken).toBe("tv-token-123");
    // Should not leak flat branding fields
    expect(data.logoUrl).toBeUndefined();
    expect(data.primaryColor).toBeUndefined();
    expect(data.secondaryColor).toBeUndefined();
  });

  it("should return 200 without tvAccessToken for trainer", async () => {
    setupGymAccess("org:trainer");
    const gym = {
      id: GYM_ID,
      name: "Test Gym",
      slug: "test-gym",
      address: null,
      phone: null,
      timezone: "America/Sao_Paulo",
      language: "pt-BR",
      logoUrl: null,
      primaryColor: "#000000",
      secondaryColor: "#FFFFFF",
      tvAccessToken: "tv-token-123",
      subscriptionStatus: "active",
      subscriptionPlan: "starter",
      maxAthletes: 20,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    queueResults([gym]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Test Gym");
    expect(data.tvAccessToken).toBeUndefined();
    expect(data.branding).toEqual({
      logoUrl: null,
      primaryColor: "#000000",
      secondaryColor: "#FFFFFF",
    });
  });
});

// =========================================================
// PATCH /api/v1/gym/profile
// =========================================================
describe("PATCH /api/v1/gym/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await PATCH(createPatchRequest({ name: "New Name" }));
    expect(res.status).toBe(401);
  });

  it("should return 403 for trainer role", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user",
      orgId: "org_123",
      orgRole: "org:trainer",
    });
    const res = await PATCH(createPatchRequest({ name: "New Name" }));
    expect(res.status).toBe(403);
  });

  it("should return 422 for invalid body", async () => {
    setupGymAccess();
    const res = await PATCH(createPatchRequest({ name: "" }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  it("should return 422 for non-JSON body", async () => {
    setupGymAccess();
    const req = new Request("http://localhost:3000/api/v1/gym/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(422);
  });

  it("should return 422 when empty body (no fields provided)", async () => {
    setupGymAccess();
    const res = await PATCH(createPatchRequest({}));
    expect(res.status).toBe(422);
  });

  it("should return 200 with updated profile (simple fields)", async () => {
    setupGymAccess();
    const updated = {
      id: GYM_ID,
      name: "Updated Gym",
      slug: "test-gym",
      address: "456 Oak Ave",
      phone: "+1234567890",
      timezone: "America/Sao_Paulo",
      language: "pt-BR",
      logoUrl: null,
      primaryColor: "#000000",
      secondaryColor: "#FFFFFF",
      tvAccessToken: "tv-token",
      subscriptionStatus: "active",
      subscriptionPlan: "pro",
      maxAthletes: 20,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockDbUpdateReturning.mockResolvedValue([updated]);

    const res = await PATCH(
      createPatchRequest({ name: "Updated Gym", address: "456 Oak Ave" })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Gym");
    expect(data.branding).toBeDefined();
  });

  it("should return 200 with updated branding", async () => {
    setupGymAccess();
    const updated = {
      id: GYM_ID,
      name: "Test Gym",
      slug: "test-gym",
      address: null,
      phone: null,
      timezone: "America/Sao_Paulo",
      language: "pt-BR",
      logoUrl: "https://example.com/new-logo.png",
      primaryColor: "#FF0000",
      secondaryColor: "#FFFFFF",
      tvAccessToken: "tv-token",
      subscriptionStatus: "active",
      subscriptionPlan: "pro",
      maxAthletes: 20,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockDbUpdateReturning.mockResolvedValue([updated]);

    const res = await PATCH(
      createPatchRequest({
        branding: {
          logoUrl: "https://example.com/new-logo.png",
          primaryColor: "#FF0000",
        },
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.branding.logoUrl).toBe("https://example.com/new-logo.png");
    expect(data.branding.primaryColor).toBe("#FF0000");
  });

  it("should return 200 with timezone update", async () => {
    setupGymAccess();
    const updated = {
      id: GYM_ID,
      name: "Test Gym",
      slug: "test-gym",
      address: null,
      phone: null,
      timezone: "America/New_York",
      language: "en",
      logoUrl: null,
      primaryColor: "#000000",
      secondaryColor: "#FFFFFF",
      tvAccessToken: "tv-token",
      subscriptionStatus: "active",
      subscriptionPlan: "pro",
      maxAthletes: 20,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockDbUpdateReturning.mockResolvedValue([updated]);

    const res = await PATCH(
      createPatchRequest({ timezone: "America/New_York", language: "en" })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.timezone).toBe("America/New_York");
    expect(data.language).toBe("en");
  });
});
