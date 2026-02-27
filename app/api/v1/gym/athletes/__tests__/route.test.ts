// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const {
  mockAuth,
  mockQueryResults,
  mockDbInsertReturning,
} = vi.hoisted(() => {
  const mockQueryResults: unknown[][] = [];
  const mockDbInsertReturning = vi.fn();

  return {
    mockAuth: vi.fn(),
    mockQueryResults,
    mockDbInsertReturning,
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
  for (const method of ["from", "where", "orderBy", "limit", "offset", "groupBy"]) {
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
    id: "id", name: "name", slug: "slug", clerkOrgId: "clerk_org_id",
    maxAthletes: "max_athletes",
  },
  athletes: {
    id: "id", gymId: "gym_id", name: "name", email: "email", phone: "phone",
    age: "age", weightKg: "weight_kg", maxHr: "max_hr", whatsappOptIn: "whatsapp_opt_in",
    isActive: "is_active", createdAt: "created_at", updatedAt: "updated_at",
  },
  athleteBands: {
    id: "id", athleteId: "athlete_id", gymId: "gym_id", sensorId: "sensor_id",
    bandLabel: "band_label", isActive: "is_active", createdAt: "created_at",
  },
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
}));

import { GET, POST } from "../route";

// Test fixtures
const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";

function createGetRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost:3000/api/v1/gym/athletes");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Request(url.toString(), { method: "GET" });
}

function createPostRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/v1/gym/athletes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupGymAccess() {
  mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: "org_123", orgRole: "org:admin" });
  // findGymByOrg
  queueResults([{ id: GYM_ID }]);
  // findDbUser
  queueResults([
    { id: DB_USER_ID, clerkUserId: "clerk_user", email: "owner@test.com", isSuperadmin: false },
  ]);
}

// =========================================================
// GET /api/v1/gym/athletes
// =========================================================
describe("GET /api/v1/gym/athletes", () => {
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
    const data = await res.json();
    expect(data.code).toBe("FORBIDDEN");
  });

  it("should return 422 for invalid query params", async () => {
    setupGymAccess();
    const res = await GET(createGetRequest({ page: "abc" }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  it("should return 200 with empty athletes list", async () => {
    setupGymAccess();
    // athletes list
    queueResults([]);
    // count
    queueResults([{ total: 0 }]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(0);
    expect(data.pagination).toEqual({
      total: 0, page: 1, limit: 20, totalPages: 0,
    });
  });

  it("should return 200 with paginated athletes", async () => {
    setupGymAccess();
    const athlete = {
      id: "ath-1", gymId: GYM_ID, name: "John Doe", email: "john@test.com",
      phone: null, age: 30, weightKg: "80.00", maxHr: 190,
      whatsappOptIn: false, isActive: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      bandSensorId: 12345, bandLabel: "Band A",
    };
    queueResults([athlete]);
    queueResults([{ total: 1 }]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(1);
    expect(data.data[0].name).toBe("John Doe");
    expect(data.data[0].band).toBeDefined();
    expect(data.pagination.total).toBe(1);
  });

  it("should accept search filter", async () => {
    setupGymAccess();
    queueResults([]);
    queueResults([{ total: 0 }]);

    const res = await GET(createGetRequest({ search: "john" }));
    expect(res.status).toBe(200);
  });

  it("should accept active filter", async () => {
    setupGymAccess();
    queueResults([]);
    queueResults([{ total: 0 }]);

    const res = await GET(createGetRequest({ active: "true" }));
    expect(res.status).toBe(200);
  });

  it("should accept pagination params", async () => {
    setupGymAccess();
    queueResults([]);
    queueResults([{ total: 0 }]);

    const res = await GET(createGetRequest({ page: "2", limit: "10" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pagination.page).toBe(2);
    expect(data.pagination.limit).toBe(10);
  });
});

// =========================================================
// POST /api/v1/gym/athletes
// =========================================================
describe("POST /api/v1/gym/athletes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  const validBody = {
    name: "Jane Doe",
    email: "jane@test.com",
    maxHr: 185,
  };

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await POST(createPostRequest(validBody));
    expect(res.status).toBe(401);
  });

  it("should return 403 when no org context", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: null });
    const res = await POST(createPostRequest(validBody));
    expect(res.status).toBe(403);
  });

  it("should return 422 for invalid body", async () => {
    setupGymAccess();
    const res = await POST(createPostRequest({ name: "" }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  it("should return 422 for non-JSON body", async () => {
    setupGymAccess();
    const req = new Request("http://localhost:3000/api/v1/gym/athletes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("should return 409 when max athletes reached", async () => {
    setupGymAccess();
    // gym lookup (maxAthletes)
    queueResults([{ maxAthletes: 2 }]);
    // active athlete count
    queueResults([{ count: 2 }]);

    const res = await POST(createPostRequest(validBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("MAX_ATHLETES_REACHED");
  });

  it("should return 409 when email already exists in gym", async () => {
    setupGymAccess();
    // gym lookup
    queueResults([{ maxAthletes: 20 }]);
    // active athlete count
    queueResults([{ count: 5 }]);
    // email uniqueness check
    queueResults([{ id: "existing-athlete" }]);

    const res = await POST(createPostRequest(validBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("EMAIL_ALREADY_EXISTS");
  });

  it("should return 201 with created athlete (with email)", async () => {
    setupGymAccess();
    // gym lookup
    queueResults([{ maxAthletes: 20 }]);
    // active athlete count
    queueResults([{ count: 5 }]);
    // email uniqueness check
    queueResults([]);
    // insert
    const created = {
      id: "new-athlete-id", gymId: GYM_ID, name: "Jane Doe",
      email: "jane@test.com", maxHr: 185, isActive: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    mockDbInsertReturning.mockResolvedValue([created]);

    const res = await POST(createPostRequest(validBody));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Jane Doe");
    expect(data.email).toBe("jane@test.com");
  });

  it("should return 201 with created athlete (without email)", async () => {
    setupGymAccess();
    // gym lookup
    queueResults([{ maxAthletes: 20 }]);
    // active athlete count
    queueResults([{ count: 0 }]);
    // No email uniqueness check needed
    // insert
    const created = {
      id: "new-athlete-id", gymId: GYM_ID, name: "No Email",
      email: null, maxHr: 190, isActive: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    mockDbInsertReturning.mockResolvedValue([created]);

    const res = await POST(createPostRequest({ name: "No Email" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("No Email");
    expect(data.email).toBeNull();
  });
});
