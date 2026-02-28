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
  for (const method of ["from", "where", "orderBy", "limit", "offset", "groupBy", "leftJoin", "innerJoin"]) {
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
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", name: "name", isSuperadmin: "is_superadmin" },
  gyms: { id: "id", clerkOrgId: "clerk_org_id", name: "name" },
  athletes: {
    id: "id", userId: "user_id", gymId: "gym_id", name: "name",
    email: "email", phone: "phone", age: "age", weightKg: "weight_kg",
    maxHr: "max_hr", whatsappOptIn: "whatsapp_opt_in", isActive: "is_active",
    createdAt: "created_at", updatedAt: "updated_at",
  },
  athleteBands: {
    id: "id", athleteId: "athlete_id", sensorId: "sensor_id",
    bandLabel: "band_label", isActive: "is_active",
  },
  sessions: { id: "id", gymId: "gym_id", startedAt: "started_at" },
  sessionAthletes: { id: "id", sessionId: "session_id", athleteId: "athlete_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
    { join: (...args: unknown[]) => ({ join: args }) }
  ),
  count: (col?: unknown) => ({ count: col }),
  max: (col: unknown) => ({ max: col }),
  desc: (col: unknown) => ({ desc: col }),
}));

import { GET, PATCH } from "../route";

const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";
const ATHLETE_ID = "770e8400-e29b-41d4-a716-446655440002";

function createGetRequest(): Request {
  return new Request("http://localhost:3000/api/v1/athlete/profile", { method: "GET" });
}

function createPatchRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/v1/athlete/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupAthleteAccess() {
  mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: "org_123", orgRole: "org:athlete" });
  // findGymByOrg
  queueResults([{ id: GYM_ID }]);
  // findDbUser
  queueResults([
    { id: DB_USER_ID, clerkUserId: "clerk_user", email: "athlete@test.com", isSuperadmin: false },
  ]);
  // findAthlete
  queueResults([{ id: ATHLETE_ID }]);
}

// =========================================================
// GET /api/v1/athlete/profile
// =========================================================
describe("GET /api/v1/athlete/profile", () => {
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

  it("should return 403 when not athlete role", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: "org_123", orgRole: "org:admin" });
    const res = await GET(createGetRequest());
    expect(res.status).toBe(403);
  });

  it("should return 200 with full profile", async () => {
    setupAthleteAccess();
    // athlete profile query
    queueResults([{
      id: ATHLETE_ID,
      name: "John Doe",
      email: "john@test.com",
      phone: "+5511999999999",
      age: 28,
      weightKg: "80.50",
      maxHr: 192,
      whatsappOptIn: true,
      isActive: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      bandSensorId: 42,
      bandLabel: "Band A",
      gymName: "Test Gym",
      totalSessions: 15,
      lastSessionAt: "2026-02-20T10:00:00Z",
    }]);
    // weekly streak query
    queueResults([
      { weekStart: "2026-02-17" },
      { weekStart: "2026-02-10" },
      { weekStart: "2026-02-03" },
    ]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("John Doe");
    expect(data.gymName).toBe("Test Gym");
    expect(data.band).toEqual({ sensorId: 42, label: "Band A" });
    expect(data.stats.totalSessions).toBe(15);
    expect(data.stats.weeklyStreak).toBe(3);
  });

  it("should return 200 with null band when no band assigned", async () => {
    setupAthleteAccess();
    queueResults([{
      id: ATHLETE_ID,
      name: "Jane Doe",
      email: null,
      phone: null,
      age: null,
      weightKg: null,
      maxHr: 190,
      whatsappOptIn: false,
      isActive: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      bandSensorId: null,
      bandLabel: null,
      gymName: "Test Gym",
      totalSessions: 0,
      lastSessionAt: null,
    }]);
    // weekly streak query (empty)
    queueResults([]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.band).toBeNull();
    expect(data.stats.totalSessions).toBe(0);
    expect(data.stats.weeklyStreak).toBe(0);
    expect(data.stats.lastSessionAt).toBeNull();
  });
});

// =========================================================
// PATCH /api/v1/athlete/profile
// =========================================================
describe("PATCH /api/v1/athlete/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await PATCH(createPatchRequest({ name: "New Name" }));
    expect(res.status).toBe(401);
  });

  it("should return 403 for non-athlete role", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: "org_123", orgRole: "org:admin" });
    const res = await PATCH(createPatchRequest({ name: "New Name" }));
    expect(res.status).toBe(403);
  });

  it("should return 422 for invalid body", async () => {
    setupAthleteAccess();
    const res = await PATCH(createPatchRequest({ name: "" }));
    expect(res.status).toBe(422);
  });

  it("should return 422 for empty body", async () => {
    setupAthleteAccess();
    const res = await PATCH(createPatchRequest({}));
    expect(res.status).toBe(422);
  });

  it("should return 422 for non-JSON body", async () => {
    setupAthleteAccess();
    const req = new Request("http://localhost:3000/api/v1/athlete/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(422);
  });

  it("should reject disallowed fields (email, isActive)", async () => {
    setupAthleteAccess();
    // Attempt to set email — should be ignored by schema
    const res = await PATCH(createPatchRequest({ email: "hacker@evil.com" }));
    expect(res.status).toBe(422); // schema rejects unknown fields via refine
  });

  it("should return 200 with updated profile", async () => {
    setupAthleteAccess();
    const updated = {
      id: ATHLETE_ID,
      name: "Updated Name",
      email: "john@test.com",
      phone: "+5511999999999",
      age: 29,
      weightKg: "82.00",
      maxHr: 192,
      whatsappOptIn: true,
      isActive: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-02-27T00:00:00Z",
    };
    mockDbUpdateReturning.mockResolvedValue([updated]);

    const res = await PATCH(createPatchRequest({ name: "Updated Name", age: 29 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Name");
    expect(data.age).toBe(29);
  });
});
