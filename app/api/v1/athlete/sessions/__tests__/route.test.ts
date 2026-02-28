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
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", isSuperadmin: "is_superadmin" },
  gyms: { id: "id", clerkOrgId: "clerk_org_id", name: "name" },
  athletes: { id: "id", userId: "user_id" },
  sessions: {
    id: "id", gymId: "gym_id", classType: "class_type", status: "status",
    startedAt: "started_at", endedAt: "ended_at", durationSeconds: "duration_seconds",
  },
  sessionAthletes: {
    id: "id", sessionId: "session_id", athleteId: "athlete_id",
    avgHr: "avg_hr", maxHr: "max_hr", minHr: "min_hr", calories: "calories",
    timeZone1S: "time_zone_1_s", timeZone2S: "time_zone_2_s",
    timeZone3S: "time_zone_3_s", timeZone4S: "time_zone_4_s",
    timeZone5S: "time_zone_5_s",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  desc: (col: unknown) => ({ desc: col }),
  count: (col?: unknown) => ({ count: col }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
    { join: (...args: unknown[]) => ({ join: args }) }
  ),
}));

import { GET } from "../route";

const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";
const ATHLETE_ID = "770e8400-e29b-41d4-a716-446655440002";

function createGetRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost:3000/api/v1/athlete/sessions");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Request(url.toString(), { method: "GET" });
}

function setupAthleteAccess() {
  mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: "org_123", orgRole: "org:athlete" });
  queueResults([{ id: GYM_ID }]);
  queueResults([
    { id: DB_USER_ID, clerkUserId: "clerk_user", email: "athlete@test.com", isSuperadmin: false },
  ]);
  queueResults([{ id: ATHLETE_ID }]);
}

describe("GET /api/v1/athlete/sessions", () => {
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

  it("should return 403 for non-athlete role", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: "org_123", orgRole: "org:admin" });
    const res = await GET(createGetRequest());
    expect(res.status).toBe(403);
  });

  it("should return 422 for invalid pagination", async () => {
    setupAthleteAccess();
    const res = await GET(createGetRequest({ page: "abc" }));
    expect(res.status).toBe(422);
  });

  it("should return 200 with empty session list", async () => {
    setupAthleteAccess();
    queueResults([]); // sessions
    queueResults([{ total: 0 }]); // count

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(0);
    expect(data.pagination).toEqual({
      total: 0, page: 1, limit: 20, totalPages: 0,
    });
  });

  it("should return 200 with sessions and hrZones shaped", async () => {
    setupAthleteAccess();
    const session = {
      sessionId: "sess-1",
      classType: "HIIT",
      status: "completed",
      startedAt: "2026-02-20T10:00:00Z",
      endedAt: "2026-02-20T11:00:00Z",
      durationSeconds: 3600,
      gymName: "Test Gym",
      avgHr: 145,
      maxHr: 180,
      minHr: 110,
      calories: 500,
      timeZone1S: 120,
      timeZone2S: 300,
      timeZone3S: 600,
      timeZone4S: 1200,
      timeZone5S: 1380,
    };
    queueResults([session]);
    queueResults([{ total: 1 }]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(1);
    expect(data.data[0].sessionId).toBe("sess-1");
    expect(data.data[0].hrZones).toEqual({
      zone1: 120, zone2: 300, zone3: 600, zone4: 1200, zone5: 1380,
    });
    // Flat zone fields should be removed
    expect(data.data[0].timeZone1S).toBeUndefined();
  });

  it("should accept pagination params", async () => {
    setupAthleteAccess();
    queueResults([]);
    queueResults([{ total: 0 }]);

    const res = await GET(createGetRequest({ page: "2", limit: "10" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pagination.page).toBe(2);
    expect(data.pagination.limit).toBe(10);
  });
});
