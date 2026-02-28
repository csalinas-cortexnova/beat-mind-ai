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
  gyms: { id: "id", clerkOrgId: "clerk_org_id" },
  athletes: { id: "id", userId: "user_id" },
  sessions: {
    id: "id", gymId: "gym_id", startedAt: "started_at", status: "status",
  },
  sessionAthletes: {
    id: "id", sessionId: "session_id", athleteId: "athlete_id",
    avgHr: "avg_hr", calories: "calories",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  count: (col?: unknown) => ({ count: col }),
  avg: (col: unknown) => ({ avg: col }),
  sum: (col: unknown) => ({ sum: col }),
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
  const url = new URL("http://localhost:3000/api/v1/athlete/progress");
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

describe("GET /api/v1/athlete/progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await GET(createGetRequest());
    expect(res.status).toBe(401);
  });

  it("should return 403 for non-athlete role", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: "org_123", orgRole: "org:admin" });
    const res = await GET(createGetRequest());
    expect(res.status).toBe(403);
  });

  it("should return 200 with weekly progress data", async () => {
    setupAthleteAccess();
    queueResults([
      { period: "2026-02-10", sessionCount: 3, avgHr: 145, totalCalories: 1500 },
      { period: "2026-02-17", sessionCount: 4, avgHr: 150, totalCalories: 2000 },
    ]);

    const res = await GET(createGetRequest({ period: "weekly" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.period).toBe("weekly");
    expect(data.data).toHaveLength(2);
    expect(data.data[0].sessionCount).toBe(3);
    expect(data.summary).toBeDefined();
    expect(data.trend).toBeDefined();
  });

  it("should return 200 with monthly progress data", async () => {
    setupAthleteAccess();
    queueResults([
      { period: "2026-01-01", sessionCount: 10, avgHr: 140, totalCalories: 5000 },
      { period: "2026-02-01", sessionCount: 12, avgHr: 148, totalCalories: 6000 },
    ]);

    const res = await GET(createGetRequest({ period: "monthly" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.period).toBe("monthly");
    expect(data.data).toHaveLength(2);
  });

  it("should return 200 with empty data when no sessions", async () => {
    setupAthleteAccess();
    queueResults([]); // no progress data

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(0);
    expect(data.summary.totalSessions).toBe(0);
    expect(data.trend).toBe("stable");
  });

  it("should default to weekly period", async () => {
    setupAthleteAccess();
    queueResults([]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.period).toBe("weekly");
  });

  it("should return 422 for invalid period", async () => {
    setupAthleteAccess();
    const res = await GET(createGetRequest({ period: "daily" }));
    expect(res.status).toBe(422);
  });
});
