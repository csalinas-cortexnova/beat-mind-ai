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
    id: "id", gymId: "gym_id", classType: "class_type", status: "status",
    startedAt: "started_at", endedAt: "ended_at", durationSeconds: "duration_seconds",
    athleteCount: "athlete_count", aiSummary: "ai_summary",
  },
  sessionAthletes: {
    id: "id", sessionId: "session_id", athleteId: "athlete_id",
    avgHr: "avg_hr", maxHr: "max_hr", minHr: "min_hr", calories: "calories",
    timeZone1S: "time_zone_1_s", timeZone2S: "time_zone_2_s",
    timeZone3S: "time_zone_3_s", timeZone4S: "time_zone_4_s",
    timeZone5S: "time_zone_5_s", joinedAt: "joined_at", leftAt: "left_at",
  },
  hrReadings: {
    id: "id", sessionId: "session_id", athleteId: "athlete_id",
    heartRateBpm: "heart_rate_bpm", hrZone: "hr_zone", recordedAt: "recorded_at",
  },
  aiCoachingMessages: {
    id: "id", sessionId: "session_id", message: "message", createdAt: "created_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
    { join: (...args: unknown[]) => ({ join: args }) }
  ),
}));

vi.mock("@/lib/utils/downsample", () => ({
  downsampleHrData: vi.fn((data: unknown[]) => data),
}));

import { GET } from "../route";

const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";
const ATHLETE_ID = "770e8400-e29b-41d4-a716-446655440002";
const SESSION_ID = "880e8400-e29b-41d4-a716-446655440003";

function createGetRequest(id: string = SESSION_ID): Request {
  return new Request(`http://localhost:3000/api/v1/athlete/sessions/${id}`, { method: "GET" });
}

function setupAthleteAccess() {
  mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: "org_123", orgRole: "org:athlete" });
  queueResults([{ id: GYM_ID }]);
  queueResults([
    { id: DB_USER_ID, clerkUserId: "clerk_user", email: "athlete@test.com", isSuperadmin: false },
  ]);
  queueResults([{ id: ATHLETE_ID }]);
}

describe("GET /api/v1/athlete/sessions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await GET(createGetRequest(), { params: Promise.resolve({ id: SESSION_ID }) });
    expect(res.status).toBe(401);
  });

  it("should return 403 for non-athlete role", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: "org_123", orgRole: "org:admin" });
    const res = await GET(createGetRequest(), { params: Promise.resolve({ id: SESSION_ID }) });
    expect(res.status).toBe(403);
  });

  it("should return 404 when session not found or athlete not participant", async () => {
    setupAthleteAccess();
    // session_athletes lookup — not found
    queueResults([]);

    const res = await GET(createGetRequest(), { params: Promise.resolve({ id: SESSION_ID }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("SESSION_NOT_FOUND");
  });

  it("should return 200 with full session detail", async () => {
    setupAthleteAccess();
    // session_athletes participation check
    queueResults([{
      sessionId: SESSION_ID,
      avgHr: 145,
      maxHr: 180,
      minHr: 110,
      calories: 500,
      timeZone1S: 120,
      timeZone2S: 300,
      timeZone3S: 600,
      timeZone4S: 1200,
      timeZone5S: 1380,
      joinedAt: "2026-02-20T10:00:00Z",
      leftAt: "2026-02-20T11:00:00Z",
    }]);
    // session detail
    queueResults([{
      id: SESSION_ID,
      classType: "HIIT",
      status: "completed",
      startedAt: "2026-02-20T10:00:00Z",
      endedAt: "2026-02-20T11:00:00Z",
      durationSeconds: 3600,
      athleteCount: 10,
      aiSummary: "Great session!",
    }]);
    // HR readings
    queueResults([
      { recordedAt: "2026-02-20T10:00:00Z", heartRateBpm: 120, hrZone: 2 },
      { recordedAt: "2026-02-20T10:30:00Z", heartRateBpm: 160, hrZone: 4 },
    ]);
    // AI messages
    queueResults([
      { id: "msg-1", message: "Push harder!", createdAt: "2026-02-20T10:15:00Z" },
    ]);

    const res = await GET(createGetRequest(), { params: Promise.resolve({ id: SESSION_ID }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session.id).toBe(SESSION_ID);
    expect(data.session.classType).toBe("HIIT");
    expect(data.participation.avgHr).toBe(145);
    expect(data.participation.hrZones).toEqual({
      zone1: 120, zone2: 300, zone3: 600, zone4: 1200, zone5: 1380,
    });
    expect(data.hrReadings).toHaveLength(2);
    expect(data.aiMessages).toHaveLength(1);
  });

  it("should return 200 with empty HR readings and AI messages", async () => {
    setupAthleteAccess();
    queueResults([{
      sessionId: SESSION_ID,
      avgHr: null, maxHr: null, minHr: null, calories: null,
      timeZone1S: 0, timeZone2S: 0, timeZone3S: 0, timeZone4S: 0, timeZone5S: 0,
      joinedAt: null, leftAt: null,
    }]);
    queueResults([{
      id: SESSION_ID,
      classType: null,
      status: "active",
      startedAt: "2026-02-20T10:00:00Z",
      endedAt: null,
      durationSeconds: null,
      athleteCount: 1,
      aiSummary: null,
    }]);
    queueResults([]); // empty HR
    queueResults([]); // empty AI

    const res = await GET(createGetRequest(), { params: Promise.resolve({ id: SESSION_ID }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hrReadings).toEqual([]);
    expect(data.aiMessages).toEqual([]);
  });
});
