// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const {
  mockAuth,
  mockQueryResults,
  mockDbInsertReturning,
  mockClerkClient,
} = vi.hoisted(() => {
  // Queue-based mock: each db.select() chain resolves to next queued result
  const mockQueryResults: unknown[][] = [];
  const mockDbInsertReturning = vi.fn();

  return {
    mockAuth: vi.fn(),
    mockQueryResults,
    mockDbInsertReturning,
    mockClerkClient: vi.fn(),
  };
});

/** Push results to the queue for sequential db.select() calls */
function queueResults(...results: unknown[][]) {
  mockQueryResults.push(...results);
}

/** Create a chainable mock that resolves to the next queued result */
function createChain(): unknown {
  const chain: Record<string, unknown> = {};
  const resolve = () => {
    const result = mockQueryResults.shift() ?? [];
    return Promise.resolve(result);
  };
  // Every chain method returns the same chainable object
  for (const method of ["from", "where", "orderBy", "limit", "offset", "groupBy"]) {
    chain[method] = vi.fn(() => chain);
  }
  // Make chain thenable (awaitable)
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    resolve().then(onFulfilled, onRejected);
  return chain;
}

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  clerkClient: mockClerkClient,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => createChain()),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockDbInsertReturning,
      })),
    })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", isSuperadmin: "is_superadmin" },
  gyms: {
    id: "id", name: "name", slug: "slug", address: "address", clerkOrgId: "clerk_org_id",
    subscriptionStatus: "subscription_status", subscriptionPlan: "subscription_plan",
    maxAthletes: "max_athletes", timezone: "timezone", language: "language",
    createdAt: "created_at", updatedAt: "updated_at",
  },
  athletes: { id: "id", gymId: "gym_id", isActive: "is_active" },
  sessions: { id: "id", gymId: "gym_id", status: "status", startedAt: "started_at" },
  agents: { id: "id", gymId: "gym_id", status: "status", lastHeartbeat: "last_heartbeat" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  or: (...conditions: unknown[]) => ({ or: conditions }),
  ilike: (col: unknown, val: unknown) => ({ ilike: [col, val] }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
    { join: (...args: unknown[]) => ({ join: args }) }
  ),
  count: (col?: unknown) => ({ count: col }),
  desc: (col: unknown) => ({ desc: col }),
  max: (col: unknown) => ({ max: col }),
}));

import { GET, POST } from "../route";

// Test fixtures
const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";

function createGetRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost:3000/api/v1/superadmin/gyms");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Request(url.toString(), { method: "GET" });
}

function createPostRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/v1/superadmin/gyms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupSuperAdmin() {
  mockAuth.mockResolvedValue({ userId: "clerk_admin" });
  // findDbUser returns superadmin user
  queueResults([
    { id: DB_USER_ID, clerkUserId: "clerk_admin", email: "admin@test.com", isSuperadmin: true },
  ]);
}

function setupNonAdmin() {
  mockAuth.mockResolvedValue({ userId: "clerk_user" });
  // findDbUser returns non-superadmin
  queueResults([
    { id: DB_USER_ID, clerkUserId: "clerk_user", email: "user@test.com", isSuperadmin: false },
  ]);
}

/** Queue typical GET results: gymRows, count, athleteCounts, sessionCounts, agentStatuses, lastSessions */
function setupGetResults(gymRows: unknown[] = [], total = 0) {
  queueResults(
    gymRows,           // gym list
    [{ total }],       // count
    [],                // athlete counts
    [],                // session counts
    [],                // agent statuses
    [],                // last sessions
  );
}

const validGymBody = {
  name: "Test Gym",
  slug: "test-gym",
  address: "123 Main St",
  ownerEmail: "owner@test.com",
  plan: "starter",
  maxAthletes: 20,
};

// =========================================================
// GET /api/v1/superadmin/gyms
// =========================================================
describe("GET /api/v1/superadmin/gyms", () => {
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

  it("should return 403 when not superadmin", async () => {
    setupNonAdmin();
    const res = await GET(createGetRequest());
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("FORBIDDEN");
  });

  it("should return 200 with gyms and pagination", async () => {
    setupSuperAdmin();
    const gymRow = {
      id: GYM_ID, name: "Gym 1", slug: "gym-1", address: "Addr",
      subscriptionStatus: "active", subscriptionPlan: "starter",
      maxAthletes: 20, timezone: "America/Sao_Paulo", language: "pt-BR",
      createdAt: new Date().toISOString(),
    };
    setupGetResults([gymRow], 1);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(1);
    expect(data.data[0].id).toBe(GYM_ID);
    expect(data.data[0].stats).toBeDefined();
    expect(data.pagination).toEqual({
      total: 1, page: 1, limit: 20, totalPages: 1,
    });
  });

  it("should return 422 for invalid query params", async () => {
    setupSuperAdmin();
    const res = await GET(createGetRequest({ status: "invalid" }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  it("should accept status filter", async () => {
    setupSuperAdmin();
    setupGetResults([], 0);
    const res = await GET(createGetRequest({ status: "suspended" }));
    expect(res.status).toBe(200);
  });

  it("should accept search filter", async () => {
    setupSuperAdmin();
    setupGetResults([], 0);
    const res = await GET(createGetRequest({ search: "test" }));
    expect(res.status).toBe(200);
  });

  it("should accept pagination params", async () => {
    setupSuperAdmin();
    setupGetResults([], 0);
    const res = await GET(createGetRequest({ page: "2", limit: "10" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pagination.page).toBe(2);
    expect(data.pagination.limit).toBe(10);
  });

  it("should return empty stats when no gyms", async () => {
    setupSuperAdmin();
    // Empty gyms → skip stats queries (only gym list + count)
    queueResults([], [{ total: 0 }]);
    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(0);
  });
});

// =========================================================
// POST /api/v1/superadmin/gyms
// =========================================================
describe("POST /api/v1/superadmin/gyms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await POST(createPostRequest(validGymBody));
    expect(res.status).toBe(401);
  });

  it("should return 403 when not superadmin", async () => {
    setupNonAdmin();
    const res = await POST(createPostRequest(validGymBody));
    expect(res.status).toBe(403);
  });

  it("should return 422 for invalid body", async () => {
    setupSuperAdmin();
    const res = await POST(createPostRequest({ name: "" }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  it("should return 422 for non-JSON body", async () => {
    setupSuperAdmin();
    const req = new Request("http://localhost:3000/api/v1/superadmin/gyms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("should return 409 when slug is taken", async () => {
    setupSuperAdmin();
    // Slug check returns existing gym
    queueResults([{ id: "existing-gym" }]);

    const res = await POST(createPostRequest(validGymBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("SLUG_TAKEN");
  });

  it("should return 201 with created gym on success", async () => {
    setupSuperAdmin();
    // Slug check — not taken
    queueResults([]);
    // Clerk org creation
    mockClerkClient.mockResolvedValue({
      organizations: {
        createOrganization: vi.fn().mockResolvedValue({ id: "org_new" }),
        createOrganizationInvitation: vi.fn().mockResolvedValue({}),
      },
    });
    // DB insert
    const createdGym = {
      id: GYM_ID,
      name: "Test Gym",
      slug: "test-gym",
      address: "123 Main St",
      clerkOrgId: "org_new",
      subscriptionStatus: "active",
      subscriptionPlan: "starter",
      maxAthletes: 20,
      timezone: "America/Sao_Paulo",
      language: "pt-BR",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockDbInsertReturning.mockResolvedValue([createdGym]);

    const res = await POST(createPostRequest(validGymBody));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(GYM_ID);
    expect(data.slug).toBe("test-gym");
  });

  it("should return 500 when Clerk org creation fails", async () => {
    setupSuperAdmin();
    // Slug check — not taken
    queueResults([]);
    // Clerk org creation fails
    mockClerkClient.mockResolvedValue({
      organizations: {
        createOrganization: vi.fn().mockRejectedValue(new Error("Clerk error")),
      },
    });

    const res = await POST(createPostRequest(validGymBody));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.code).toBe("CLERK_ERROR");
  });
});
