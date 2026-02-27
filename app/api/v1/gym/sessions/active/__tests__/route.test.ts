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
    createdAt: "created_at",
  },
  sessionAthletes: {
    id: "id", sessionId: "session_id", athleteId: "athlete_id",
    avgHr: "avg_hr", maxHr: "max_hr", minHr: "min_hr",
    sensorId: "sensor_id",
  },
  hrReadings: {
    id: "id", sessionId: "session_id", athleteId: "athlete_id",
    heartRateBpm: "heart_rate_bpm", hrZone: "hr_zone", hrZoneName: "hr_zone_name",
    hrZoneColor: "hr_zone_color", recordedAt: "recorded_at",
  },
  athletes: { id: "id", name: "name", maxHr: "max_hr", userId: "user_id" },
  sessionStatusEnum: ["active", "completed", "cancelled"],
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  desc: (col: unknown) => ({ desc: col }),
  avg: (col: unknown) => ({ avg: col }),
  max: (col: unknown) => ({ max: col }),
  min: (col: unknown) => ({ min: col }),
  count: (col?: unknown) => ({ count: col }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
    { join: (...args: unknown[]) => ({ join: args }) }
  ),
}));

import { GET } from "../route";

const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";

function createGetRequest(): Request {
  return new Request("http://localhost:3000/api/v1/gym/sessions/active", { method: "GET" });
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

describe("GET /api/v1/gym/sessions/active", () => {
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

  it("should return 200 with null when no active session", async () => {
    setupGymAccess();
    // active session query
    queueResults([]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session).toBeNull();
  });

  it("should return 200 with active session and no athletes", async () => {
    setupGymAccess();
    const startedAt = new Date(Date.now() - 1800000).toISOString(); // 30 min ago
    // active session
    queueResults([{
      id: "sess-1",
      gymId: GYM_ID,
      classType: "HIIT",
      status: "active",
      startedAt,
      athleteCount: 0,
      trainerName: "John",
    }]);
    // athletes in session
    queueResults([]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session).toBeDefined();
    expect(data.session.id).toBe("sess-1");
    expect(data.session.classType).toBe("HIIT");
    expect(typeof data.session.durationSeconds).toBe("number");
    expect(data.session.athletes).toHaveLength(0);
  });

  it("should return 200 with active session and athletes", async () => {
    setupGymAccess();
    const now = Date.now();
    const startedAt = new Date(now - 1800000).toISOString();
    // active session
    queueResults([{
      id: "sess-1",
      gymId: GYM_ID,
      classType: "Spin",
      status: "active",
      startedAt,
      athleteCount: 2,
      trainerName: "Maria",
    }]);
    // athletes with latest HR
    queueResults([
      {
        athleteId: "ath-1",
        athleteName: "Alice",
        athleteMaxHr: 190,
        sensorId: 123,
        latestHr: 150,
        latestZone: 3,
        latestZoneName: "Cardio",
        latestZoneColor: "#FFFF00",
        latestRecordedAt: new Date(now - 5000).toISOString(),
        avgHr: 145,
        maxHr: 160,
        minHr: 120,
        readingCount: 100,
      },
      {
        athleteId: "ath-2",
        athleteName: "Bob",
        athleteMaxHr: 185,
        sensorId: 456,
        latestHr: 130,
        latestZone: 2,
        latestZoneName: "Fat Burn",
        latestZoneColor: "#00FF00",
        latestRecordedAt: new Date(now - 60000).toISOString(),
        avgHr: 125,
        maxHr: 140,
        minHr: 110,
        readingCount: 50,
      },
    ]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session.athletes).toHaveLength(2);
    expect(data.session.athletes[0].name).toBe("Alice");
    expect(data.session.athletes[0].latestHr).toBe(150);
    expect(data.session.athletes[0].isActive).toBe(true);
    // Bob's last reading is > 30s ago
    expect(data.session.athletes[1].isActive).toBe(false);
  });

  it("should allow trainer access", async () => {
    setupGymAccess("org:trainer");
    queueResults([]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
  });
});
