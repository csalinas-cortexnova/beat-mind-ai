// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const {
  mockAuth,
  mockQueryResults,
} = vi.hoisted(() => {
  const mockQueryResults: unknown[][] = [];
  return {
    mockAuth: vi.fn(),
    mockQueryResults,
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
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", name: "name", isSuperadmin: "is_superadmin" },
  gyms: { id: "id", clerkOrgId: "clerk_org_id" },
  sessions: {
    id: "id", gymId: "gym_id", trainerId: "trainer_id", classType: "class_type",
    status: "status", startedAt: "started_at", endedAt: "ended_at",
    durationSeconds: "duration_seconds", athleteCount: "athlete_count",
    aiSummary: "ai_summary", createdAt: "created_at",
  },
  sessionAthletes: {
    id: "id", sessionId: "session_id", athleteId: "athlete_id",
    avgHr: "avg_hr", maxHr: "max_hr", minHr: "min_hr",
  },
  sessionStatusEnum: ["active", "completed", "cancelled"],
  athletes: { id: "id", userId: "user_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  desc: (col: unknown) => ({ desc: col }),
  count: (col?: unknown) => ({ count: col }),
  avg: (col: unknown) => ({ avg: col }),
  max: (col: unknown) => ({ max: col }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
    { join: (...args: unknown[]) => ({ join: args }) }
  ),
}));

import { GET } from "../route";

const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";

function createGetRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost:3000/api/v1/gym/sessions");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Request(url.toString(), { method: "GET" });
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

describe("GET /api/v1/gym/sessions", () => {
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

  it("should return 422 for invalid query params", async () => {
    setupGymAccess();
    const res = await GET(createGetRequest({ page: "abc" }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  it("should return 200 with empty sessions list", async () => {
    setupGymAccess();
    // sessions list
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

  it("should return 200 with sessions list", async () => {
    setupGymAccess();
    const session = {
      id: "sess-1",
      gymId: GYM_ID,
      classType: "HIIT",
      status: "completed",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: 3600,
      athleteCount: 10,
      trainerName: "John Trainer",
      createdAt: new Date().toISOString(),
    };
    queueResults([session]);
    queueResults([{ total: 1 }]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(1);
    expect(data.data[0].classType).toBe("HIIT");
    expect(data.data[0].trainerName).toBe("John Trainer");
    expect(data.pagination.total).toBe(1);
  });

  it("should accept status filter", async () => {
    setupGymAccess();
    queueResults([]);
    queueResults([{ total: 0 }]);

    const res = await GET(createGetRequest({ status: "active" }));
    expect(res.status).toBe(200);
  });

  it("should accept date range filter", async () => {
    setupGymAccess();
    queueResults([]);
    queueResults([{ total: 0 }]);

    const res = await GET(
      createGetRequest({
        from: "2026-01-01T00:00:00Z",
        to: "2026-12-31T23:59:59Z",
      })
    );
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

  it("should allow trainer access", async () => {
    setupGymAccess("org:trainer");
    queueResults([]);
    queueResults([{ total: 0 }]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
  });
});
