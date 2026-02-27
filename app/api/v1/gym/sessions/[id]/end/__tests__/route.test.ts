// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const {
  mockAuth,
  mockQueryResults,
  mockDbUpdateReturning,
  mockDbInsertValues,
} = vi.hoisted(() => {
  const mockQueryResults: unknown[][] = [];
  const mockDbUpdateReturning = vi.fn();
  const mockDbInsertOnConflict = vi.fn(() => Promise.resolve());
  const mockDbInsertValues = vi.fn(() => ({
    onConflictDoUpdate: mockDbInsertOnConflict,
  }));

  return {
    mockAuth: vi.fn(),
    mockQueryResults,
    mockDbUpdateReturning,
    mockDbInsertValues,
    mockDbInsertOnConflict,
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
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: mockDbUpdateReturning,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: mockDbInsertValues,
    })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", isSuperadmin: "is_superadmin" },
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
    calories: "calories",
    timeZone1S: "time_zone_1_s", timeZone2S: "time_zone_2_s",
    timeZone3S: "time_zone_3_s", timeZone4S: "time_zone_4_s",
    timeZone5S: "time_zone_5_s",
    sensorId: "sensor_id",
  },
  hrReadings: {
    id: "id", sessionId: "session_id", athleteId: "athlete_id",
    heartRateBpm: "heart_rate_bpm", recordedAt: "recorded_at",
  },
  athletes: { id: "id", userId: "user_id" },
  sessionStatusEnum: ["active", "completed", "cancelled"],
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  avg: (col: unknown) => ({ avg: col }),
  max: (col: unknown) => ({ max: col }),
  min: (col: unknown) => ({ min: col }),
  count: (col?: unknown) => ({ count: col }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
    { join: (...args: unknown[]) => ({ join: args }) }
  ),
}));

import { POST } from "../route";

const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";
const SESSION_ID = "880e8400-e29b-41d4-a716-446655440003";

function createPostRequest(body?: unknown): Request {
  return new Request(`http://localhost:3000/api/v1/gym/sessions/${SESSION_ID}/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function createEmptyPostRequest(): Request {
  return new Request(`http://localhost:3000/api/v1/gym/sessions/${SESSION_ID}/end`, {
    method: "POST",
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

describe("POST /api/v1/gym/sessions/[id]/end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await POST(createPostRequest(), { params: Promise.resolve({ id: SESSION_ID }) });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("UNAUTHORIZED");
  });

  it("should return 403 when no org context", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: null });
    const res = await POST(createPostRequest(), { params: Promise.resolve({ id: SESSION_ID }) });
    expect(res.status).toBe(403);
  });

  it("should return 404 when session not found", async () => {
    setupGymAccess();
    // session lookup
    queueResults([]);

    const res = await POST(createPostRequest(), { params: Promise.resolve({ id: SESSION_ID }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("SESSION_NOT_FOUND");
  });

  it("should return 403 when session belongs to different gym", async () => {
    setupGymAccess();
    // session lookup
    queueResults([{
      id: SESSION_ID,
      gymId: "different-gym-id",
      status: "active",
      startedAt: new Date(Date.now() - 3600000).toISOString(),
    }]);

    const res = await POST(createPostRequest(), { params: Promise.resolve({ id: SESSION_ID }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("GYM_MISMATCH");
  });

  it("should return 409 when session is not active", async () => {
    setupGymAccess();
    // session lookup
    queueResults([{
      id: SESSION_ID,
      gymId: GYM_ID,
      status: "completed",
      startedAt: new Date(Date.now() - 3600000).toISOString(),
    }]);

    const res = await POST(createPostRequest(), { params: Promise.resolve({ id: SESSION_ID }) });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("SESSION_NOT_ACTIVE");
  });

  it("should return 200 when session is successfully ended (no body)", async () => {
    setupGymAccess();
    const startedAt = new Date(Date.now() - 3600000); // 1 hour ago
    // session lookup
    queueResults([{
      id: SESSION_ID,
      gymId: GYM_ID,
      status: "active",
      startedAt: startedAt.toISOString(),
    }]);
    // per-athlete HR stats
    queueResults([
      {
        athleteId: "ath-1",
        avgHr: "150",
        maxHr: 170,
        minHr: 120,
      },
    ]);
    // session update
    const updatedSession = {
      id: SESSION_ID,
      gymId: GYM_ID,
      status: "completed",
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: 3600,
      athleteCount: 1,
    };
    mockDbUpdateReturning.mockResolvedValue([updatedSession]);

    const res = await POST(createEmptyPostRequest(), { params: Promise.resolve({ id: SESSION_ID }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("completed");
    expect(data.durationSeconds).toBeDefined();
  });

  it("should return 200 when session is successfully ended (with classType)", async () => {
    setupGymAccess();
    const startedAt = new Date(Date.now() - 1800000); // 30 min ago
    // session lookup
    queueResults([{
      id: SESSION_ID,
      gymId: GYM_ID,
      status: "active",
      startedAt: startedAt.toISOString(),
    }]);
    // per-athlete HR stats
    queueResults([]);
    // session update
    const updatedSession = {
      id: SESSION_ID,
      gymId: GYM_ID,
      classType: "Spin",
      status: "completed",
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: 1800,
      athleteCount: 0,
    };
    mockDbUpdateReturning.mockResolvedValue([updatedSession]);

    const res = await POST(
      createPostRequest({ classType: "Spin" }),
      { params: Promise.resolve({ id: SESSION_ID }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.classType).toBe("Spin");
    expect(data.status).toBe("completed");
  });

  it("should allow trainer access", async () => {
    setupGymAccess("org:trainer");
    const startedAt = new Date(Date.now() - 600000);
    queueResults([{
      id: SESSION_ID,
      gymId: GYM_ID,
      status: "active",
      startedAt: startedAt.toISOString(),
    }]);
    queueResults([]);
    mockDbUpdateReturning.mockResolvedValue([{
      id: SESSION_ID,
      gymId: GYM_ID,
      status: "completed",
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: 600,
      athleteCount: 0,
    }]);

    const res = await POST(createEmptyPostRequest(), { params: Promise.resolve({ id: SESSION_ID }) });
    expect(res.status).toBe(200);
  });
});
