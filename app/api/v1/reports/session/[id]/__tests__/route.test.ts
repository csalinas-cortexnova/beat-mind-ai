// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// --- Hoisted mocks ---
const {
  mockAuth,
  mockValidateReportToken,
  mockDownsampleHrData,
  mockQueryResults,
} = vi.hoisted(() => {
  return {
    mockAuth: vi.fn(),
    mockValidateReportToken: vi.fn(),
    mockDownsampleHrData: vi.fn(),
    mockQueryResults: [] as unknown[][],
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
  for (const method of [
    "from",
    "where",
    "orderBy",
    "limit",
    "offset",
    "groupBy",
    "leftJoin",
    "innerJoin",
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown
  ) => resolve().then(onFulfilled, onRejected);
  return chain;
}

// --- Mocks ---

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      sessions: {
        findFirst: vi.fn(() => {
          const result = mockQueryResults.shift() ?? undefined;
          // findFirst returns single item or undefined
          return Promise.resolve(
            Array.isArray(result) ? result[0] ?? undefined : result
          );
        }),
      },
      gyms: {
        findFirst: vi.fn(() => {
          const result = mockQueryResults.shift() ?? undefined;
          return Promise.resolve(
            Array.isArray(result) ? result[0] ?? undefined : result
          );
        }),
      },
      users: {
        findFirst: vi.fn(() => {
          const result = mockQueryResults.shift() ?? undefined;
          return Promise.resolve(
            Array.isArray(result) ? result[0] ?? undefined : result
          );
        }),
      },
    },
    select: vi.fn(() => createChain()),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: {
    id: "id",
    clerkUserId: "clerk_user_id",
    email: "email",
    isSuperadmin: "is_superadmin",
    name: "name",
  },
  gyms: {
    id: "id",
    clerkOrgId: "clerk_org_id",
    name: "name",
    logoUrl: "logo_url",
    primaryColor: "primary_color",
    secondaryColor: "secondary_color",
  },
  sessions: {
    id: "id",
    gymId: "gym_id",
    trainerId: "trainer_id",
    classType: "class_type",
    status: "status",
    startedAt: "started_at",
    endedAt: "ended_at",
    durationSeconds: "duration_seconds",
    athleteCount: "athlete_count",
    aiSummary: "ai_summary",
    createdAt: "created_at",
  },
  sessionAthletes: {
    id: "id",
    sessionId: "session_id",
    athleteId: "athlete_id",
    avgHr: "avg_hr",
    maxHr: "max_hr",
    minHr: "min_hr",
    calories: "calories",
    timeZone1S: "time_zone_1_s",
    timeZone2S: "time_zone_2_s",
    timeZone3S: "time_zone_3_s",
    timeZone4S: "time_zone_4_s",
    timeZone5S: "time_zone_5_s",
  },
  athletes: {
    id: "id",
    name: "name",
    userId: "user_id",
    phone: "phone",
    whatsappOptIn: "whatsapp_opt_in",
  },
  hrReadings: {
    id: "id",
    sessionId: "session_id",
    athleteId: "athlete_id",
    heartRateBpm: "heart_rate_bpm",
    recordedAt: "recorded_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  asc: (col: unknown) => ({ asc: col }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
}));

vi.mock("@/lib/reports/token", () => ({
  validateReportToken: mockValidateReportToken,
}));

vi.mock("@/lib/utils/downsample", () => ({
  downsampleHrData: mockDownsampleHrData,
}));

import { GET } from "../route";

// --- Constants ---
const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";
const SESSION_ID = "880e8400-e29b-41d4-a716-446655440003";
const ATHLETE_ID = "990e8400-e29b-41d4-a716-446655440004";
const TRAINER_ID = "aa0e8400-e29b-41d4-a716-446655440005";

function buildRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"));
}

function setupGymAccess(role: string = "org:admin") {
  mockAuth.mockResolvedValue({
    userId: "clerk_user",
    orgId: "org_123",
    orgRole: role,
  });
  // findGymByOrg → returns gym
  queueResults([{ id: GYM_ID }]);
  // findDbUser → returns DB user
  queueResults([
    {
      id: DB_USER_ID,
      clerkUserId: "clerk_user",
      email: "owner@test.com",
      isSuperadmin: false,
    },
  ]);
}

function setupSession(overrides: Record<string, unknown> = {}) {
  // db.query.sessions.findFirst
  queueResults([
    {
      id: SESSION_ID,
      gymId: GYM_ID,
      classType: "Spin",
      status: "completed",
      startedAt: new Date("2026-01-15T10:00:00Z"),
      endedAt: new Date("2026-01-15T11:00:00Z"),
      durationSeconds: 3600,
      athleteCount: 1,
      aiSummary: "Great session!",
      trainerId: TRAINER_ID,
      ...overrides,
    },
  ]);
}

function setupGym() {
  // db.query.gyms.findFirst
  queueResults([
    {
      id: GYM_ID,
      name: "Test Gym",
      logoUrl: "https://example.com/logo.png",
      primaryColor: "#FF0000",
      secondaryColor: "#00FF00",
    },
  ]);
}

function setupTrainer() {
  // db.query.users.findFirst (trainer lookup)
  queueResults([{ name: "John Trainer" }]);
}

function setupSessionAthletes() {
  // db.select().from(sessionAthletes).innerJoin(athletes)
  queueResults([
    {
      session_athletes: {
        athleteId: ATHLETE_ID,
        avgHr: 150,
        maxHr: 180,
        minHr: 100,
        calories: 500,
        timeZone1S: 600,
        timeZone2S: 1200,
        timeZone3S: 900,
        timeZone4S: 600,
        timeZone5S: 300,
      },
      athletes: {
        id: ATHLETE_ID,
        name: "Alice Athlete",
      },
    },
  ]);
}

function setupHrReadings() {
  // db.select().from(hrReadings).where().orderBy()
  queueResults([
    {
      heartRateBpm: 150,
      recordedAt: new Date("2026-01-15T10:05:00Z"),
    },
    {
      heartRateBpm: 160,
      recordedAt: new Date("2026-01-15T10:10:00Z"),
    },
  ]);
}

describe("GET /api/v1/reports/session/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
    mockValidateReportToken.mockReturnValue(null);
    mockDownsampleHrData.mockImplementation(
      (
        data: Array<{ recordedAt: string; heartRateBpm: number }>
      ) => data
    );
  });

  it("should return session data with Clerk auth", async () => {
    setupGymAccess();
    setupSession();
    setupGym();
    setupTrainer();
    setupSessionAthletes();
    setupHrReadings();

    const req = buildRequest(`/api/v1/reports/session/${SESSION_ID}`);
    const res = await GET(req, {
      params: Promise.resolve({ id: SESSION_ID }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    // Session fields
    expect(data.session.id).toBe(SESSION_ID);
    expect(data.session.classType).toBe("Spin");
    expect(data.session.status).toBe("completed");
    expect(data.session.trainer).toEqual({
      id: TRAINER_ID,
      name: "John Trainer",
    });

    // Gym fields
    expect(data.gym.name).toBe("Test Gym");
    expect(data.gym.primaryColor).toBe("#FF0000");

    // Athletes
    expect(data.athletes).toHaveLength(1);
    expect(data.athletes[0].id).toBe(ATHLETE_ID);
    expect(data.athletes[0].name).toBe("Alice Athlete");
    expect(data.athletes[0].avgHr).toBe(150);
    expect(data.athletes[0].hrReadings).toHaveLength(2);
  });

  it("should return filtered athlete data with report token", async () => {
    // Clerk auth fails (no userId)
    mockAuth.mockResolvedValue({ userId: null });

    // Token is valid
    mockValidateReportToken.mockReturnValue({
      sessionId: SESSION_ID,
      athleteId: ATHLETE_ID,
      gymId: GYM_ID,
    });

    setupSession();
    setupGym();
    // No trainer lookup when token auth (trainerId still present, so it fetches)
    setupTrainer();
    setupSessionAthletes();
    setupHrReadings();

    const req = buildRequest(
      `/api/v1/reports/session/${SESSION_ID}?token=valid-token`
    );
    const res = await GET(req, {
      params: Promise.resolve({ id: SESSION_ID }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session.id).toBe(SESSION_ID);
    expect(data.athletes).toHaveLength(1);
  });

  it("should return 401 with invalid token and no Clerk auth", async () => {
    // Clerk auth fails
    mockAuth.mockResolvedValue({ userId: null });
    // Token invalid
    mockValidateReportToken.mockReturnValue(null);

    const req = buildRequest(
      `/api/v1/reports/session/${SESSION_ID}?token=bad-token`
    );
    const res = await GET(req, {
      params: Promise.resolve({ id: SESSION_ID }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("UNAUTHORIZED");
  });

  it("should return 404 when session not found", async () => {
    setupGymAccess();
    // Session not found
    queueResults([]);

    const req = buildRequest(`/api/v1/reports/session/${SESSION_ID}`);
    const res = await GET(req, {
      params: Promise.resolve({ id: SESSION_ID }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("NOT_FOUND");
  });

  it("should filter by athleteId query param with Clerk auth", async () => {
    setupGymAccess();
    setupSession();
    setupGym();
    setupTrainer();
    // Return athlete matching the filter
    setupSessionAthletes();
    setupHrReadings();

    const req = buildRequest(
      `/api/v1/reports/session/${SESSION_ID}?athleteId=${ATHLETE_ID}`
    );
    const res = await GET(req, {
      params: Promise.resolve({ id: SESSION_ID }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    // Should have athletes
    expect(data.athletes).toBeDefined();
  });

  it("should include downsampled hrReadings per athlete", async () => {
    setupGymAccess();
    setupSession();
    setupGym();
    setupTrainer();
    setupSessionAthletes();
    // Return some HR readings
    const readings = [
      {
        heartRateBpm: 120,
        recordedAt: new Date("2026-01-15T10:01:00Z"),
      },
      {
        heartRateBpm: 140,
        recordedAt: new Date("2026-01-15T10:02:00Z"),
      },
      {
        heartRateBpm: 160,
        recordedAt: new Date("2026-01-15T10:03:00Z"),
      },
    ];
    queueResults(readings);

    // Mock downsample to return a subset
    mockDownsampleHrData.mockReturnValue([
      {
        recordedAt: "2026-01-15T10:01:00.000Z",
        heartRateBpm: 120,
      },
      {
        recordedAt: "2026-01-15T10:03:00.000Z",
        heartRateBpm: 160,
      },
    ]);

    const req = buildRequest(`/api/v1/reports/session/${SESSION_ID}`);
    const res = await GET(req, {
      params: Promise.resolve({ id: SESSION_ID }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.athletes[0].hrReadings).toHaveLength(2);
    expect(data.athletes[0].hrReadings[0].bpm).toBe(120);
    expect(data.athletes[0].hrReadings[0].timestamp).toBe(
      "2026-01-15T10:01:00.000Z"
    );
    // Verify downsample was called
    expect(mockDownsampleHrData).toHaveBeenCalled();
  });

  it("should return 404 when session belongs to different gym (gymId filter in query)", async () => {
    setupGymAccess();
    // Session not found because gymId filter doesn't match
    // (the query uses and(eq(sessions.id, sessionId), eq(sessions.gymId, gymId))
    // so if session's gymId != auth's gymId, findFirst returns undefined)
    queueResults([]);

    const req = buildRequest(`/api/v1/reports/session/${SESSION_ID}`);
    const res = await GET(req, {
      params: Promise.resolve({ id: SESSION_ID }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("NOT_FOUND");
  });
});
