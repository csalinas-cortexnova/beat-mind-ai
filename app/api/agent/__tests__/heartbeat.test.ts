// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetStore } from "@/lib/api/rate-limit";

// --- Mocks ---

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  athleteBands: {
    gymId: "gym_id",
    sensorId: "sensor_id",
    isActive: "is_active",
    athleteId: "athlete_id",
  },
  athletes: {
    id: "id",
    gymId: "gym_id",
    maxHr: "max_hr",
  },
  sessions: {
    id: "id",
    gymId: "gym_id",
    status: "status",
    classType: "class_type",
    startedAt: "started_at",
  },
  hrReadings: {
    sessionId: "session_id",
    gymId: "gym_id",
    athleteId: "athlete_id",
    sensorId: "sensor_id",
    heartRateBpm: "heart_rate_bpm",
    hrZone: "hr_zone",
    hrZoneName: "hr_zone_name",
    hrZoneColor: "hr_zone_color",
    hrMaxPercent: "hr_max_percent",
    beatTime: "beat_time",
    beatCount: "beat_count",
    deviceActive: "device_active",
    recordedAt: "recorded_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...conditions: unknown[]) => ({ conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  inArray: (col: unknown, vals: unknown[]) => ({ col, vals }),
}));

const mockVerifyAgentAuth = vi.fn();
vi.mock("@/lib/auth/agent-auth", () => ({
  verifyAgentAuth: (...args: unknown[]) => mockVerifyAgentAuth(...args),
  isAuthError: (result: Record<string, unknown>) =>
    "error" in result && "status" in result,
}));

import { POST } from "../../agent/heartbeat/route";

// Test fixtures
const AGENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";
const ATHLETE_ID_1 = "770e8400-e29b-41d4-a716-446655440002";
const SESSION_ID = "990e8400-e29b-41d4-a716-446655440004";

function createRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/agent/heartbeat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Id": AGENT_ID,
      "X-Agent-Secret": "test-secret",
    },
    body: JSON.stringify(body),
  });
}

function validBody(overrides = {}) {
  return {
    agentId: AGENT_ID,
    gymId: GYM_ID,
    devices: {
      "12345": {
        bpm: 150,
        beatTime: 1000,
        beatCount: 100,
        deviceActive: true,
      },
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to set up DB mocks for the happy path
function setupHappyPath() {
  // verifyAgentAuth succeeds
  mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });

  // db.select chain for athlete_bands
  const mockBandsWhere = vi.fn().mockResolvedValue([
    { sensorId: 12345, athleteId: ATHLETE_ID_1 },
  ]);
  const mockBandsFrom = vi.fn(() => ({ where: mockBandsWhere }));
  // db.select chain for athletes
  const mockAthletesWhere = vi.fn().mockResolvedValue([
    { id: ATHLETE_ID_1, maxHr: 190 },
  ]);
  const mockAthletesFrom = vi.fn(() => ({ where: mockAthletesWhere }));
  // db.select chain for active session
  const mockSessionWhere = vi.fn().mockResolvedValue([
    { id: SESSION_ID },
  ]);
  const mockSessionFrom = vi.fn(() => ({ where: mockSessionWhere }));

  let selectCallCount = 0;
  mockDbSelect.mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) return { from: mockBandsFrom };
    if (selectCallCount === 2) return { from: mockAthletesFrom };
    return { from: mockSessionFrom };
  });

  // db.insert chain
  const mockValues = vi.fn().mockResolvedValue([]);
  mockDbInsert.mockReturnValue({ values: mockValues });

  return { mockValues, mockBandsWhere, mockAthletesWhere, mockSessionWhere };
}

describe("POST /api/agent/heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetStore();
  });

  // --- Auth ---
  it("should return 401 when auth fails", async () => {
    mockVerifyAgentAuth.mockResolvedValue({
      error: "Missing agent credentials",
      status: 401,
    });
    const req = createRequest(validBody());
    const res = await POST(req);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("UNAUTHORIZED");
  });

  // --- Validation ---
  it("should return 422 for invalid body", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });
    const req = createRequest({ invalid: true });
    const res = await POST(req);

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  it("should return 422 for empty devices", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });
    const req = createRequest(validBody({ devices: {} }));
    const res = await POST(req);

    expect(res.status).toBe(422);
  });

  // --- Gym mismatch ---
  it("should return 422 for gym mismatch", async () => {
    mockVerifyAgentAuth.mockResolvedValue({
      agentId: AGENT_ID,
      gymId: "different-gym-id",
    });
    const req = createRequest(validBody());
    const res = await POST(req);

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("GYM_MISMATCH");
  });

  // --- Happy path ---
  it("should return 200 with sessionId for valid heartbeat", async () => {
    setupHappyPath();
    const req = createRequest(validBody());
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sessionId).toBe(SESSION_ID);
  });

  it("should insert hr_readings for mapped sensors", async () => {
    const { mockValues } = setupHappyPath();
    const req = createRequest(validBody());
    await POST(req);

    expect(mockDbInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          athleteId: ATHLETE_ID_1,
          heartRateBpm: 150,
          sensorId: 12345,
        }),
      ])
    );
  });

  it("should compute HR zones in inserted readings", async () => {
    const { mockValues } = setupHappyPath();
    const req = createRequest(validBody());
    await POST(req);

    const insertedRows = mockValues.mock.calls[0][0];
    expect(insertedRows[0]).toEqual(
      expect.objectContaining({
        hrZone: expect.any(Number),
        hrZoneName: expect.any(String),
        hrZoneColor: expect.any(String),
        hrMaxPercent: expect.any(String),
      })
    );
  });

  // --- Unmapped sensors ---
  it("should silently skip devices with no athlete_band mapping", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });

    // No athlete_bands found for any sensor
    const mockBandsWhere = vi.fn().mockResolvedValue([]);
    const mockBandsFrom = vi.fn(() => ({ where: mockBandsWhere }));

    mockDbSelect.mockReturnValue({ from: mockBandsFrom });

    const req = createRequest(validBody());
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    // No insert should happen
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // --- Auto-session ---
  it("should auto-create session when none is active", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });

    // athlete_bands
    const mockBandsWhere = vi.fn().mockResolvedValue([
      { sensorId: 12345, athleteId: ATHLETE_ID_1 },
    ]);
    const mockBandsFrom = vi.fn(() => ({ where: mockBandsWhere }));

    // athletes
    const mockAthletesWhere = vi.fn().mockResolvedValue([
      { id: ATHLETE_ID_1, maxHr: 190 },
    ]);
    const mockAthletesFrom = vi.fn(() => ({ where: mockAthletesWhere }));

    // No active session
    const mockSessionWhere = vi.fn().mockResolvedValue([]);
    const mockSessionFrom = vi.fn(() => ({ where: mockSessionWhere }));

    let selectCallCount = 0;
    mockDbSelect.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return { from: mockBandsFrom };
      if (selectCallCount === 2) return { from: mockAthletesFrom };
      return { from: mockSessionFrom };
    });

    // db.insert for session creation
    const NEW_SESSION_ID = "aaa00000-0000-0000-0000-000000000000";
    const mockSessionInsertReturning = vi.fn().mockResolvedValue([
      { id: NEW_SESSION_ID },
    ]);
    const mockSessionInsertValues = vi.fn(() => ({
      returning: mockSessionInsertReturning,
    }));
    // db.insert for hr_readings
    const mockReadingsValues = vi.fn().mockResolvedValue([]);

    let insertCallCount = 0;
    mockDbInsert.mockImplementation(() => {
      insertCallCount++;
      if (insertCallCount === 1) return { values: mockSessionInsertValues };
      return { values: mockReadingsValues };
    });

    const req = createRequest(validBody());
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sessionId).toBe(NEW_SESSION_ID);
    // Session insert should have been called
    expect(mockDbInsert).toHaveBeenCalledTimes(2); // session + readings
  });

  // --- Multiple devices ---
  it("should handle multiple devices with mixed mapping", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });

    // Only sensor 12345 is mapped, 99999 is not
    const mockBandsWhere = vi.fn().mockResolvedValue([
      { sensorId: 12345, athleteId: ATHLETE_ID_1 },
    ]);
    const mockBandsFrom = vi.fn(() => ({ where: mockBandsWhere }));

    const mockAthletesWhere = vi.fn().mockResolvedValue([
      { id: ATHLETE_ID_1, maxHr: 200 },
    ]);
    const mockAthletesFrom = vi.fn(() => ({ where: mockAthletesWhere }));

    const mockSessionWhere = vi.fn().mockResolvedValue([{ id: SESSION_ID }]);
    const mockSessionFrom = vi.fn(() => ({ where: mockSessionWhere }));

    let selectCallCount = 0;
    mockDbSelect.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return { from: mockBandsFrom };
      if (selectCallCount === 2) return { from: mockAthletesFrom };
      return { from: mockSessionFrom };
    });

    const mockValues = vi.fn().mockResolvedValue([]);
    mockDbInsert.mockReturnValue({ values: mockValues });

    const body = validBody({
      devices: {
        "12345": { bpm: 160, beatTime: 1000, beatCount: 100, deviceActive: true },
        "99999": { bpm: 140, beatTime: 1000, beatCount: 50, deviceActive: true },
      },
    });

    const req = createRequest(body);
    const res = await POST(req);

    expect(res.status).toBe(200);
    // Only 1 reading inserted (mapped sensor 12345)
    const insertedRows = mockValues.mock.calls[0][0];
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].sensorId).toBe(12345);
  });

  // --- JSON parse error ---
  it("should return 422 for non-JSON body", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });
    const req = new Request("http://localhost:3000/api/agent/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Id": AGENT_ID,
        "X-Agent-Secret": "test-secret",
      },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  // --- Rate limiting ---
  describe("rate limiting", () => {
    it("should allow 20 requests per second", async () => {
      // Heartbeat rate limit: 20/sec
      for (let i = 0; i < 20; i++) {
        setupHappyPath();
        const res = await POST(createRequest(validBody()));
        expect(res.status).toBe(200);
      }
    });

    it("should return 429 on 21st request within 1 second", async () => {
      for (let i = 0; i < 20; i++) {
        setupHappyPath();
        await POST(createRequest(validBody()));
      }

      setupHappyPath();
      const res = await POST(createRequest(validBody()));
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeTruthy();
      const data = await res.json();
      expect(data.code).toBe("RATE_LIMITED");
    });

    it("should rate limit per agent independently", async () => {
      const AGENT_2 = "660e8400-e29b-41d4-a716-446655440099";

      // Exhaust Agent 1 limit (20 req/sec)
      for (let i = 0; i < 20; i++) {
        setupHappyPath();
        await POST(createRequest(validBody()));
      }
      setupHappyPath();
      const blocked = await POST(createRequest(validBody()));
      expect(blocked.status).toBe(429);

      // Agent 2 should still be allowed
      mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_2, gymId: GYM_ID });
      const mockBandsWhere = vi.fn().mockResolvedValue([]);
      const mockBandsFrom = vi.fn(() => ({ where: mockBandsWhere }));
      mockDbSelect.mockReturnValue({ from: mockBandsFrom });

      const res = await POST(createRequest(validBody({ agentId: AGENT_2 })));
      expect(res.status).toBe(200);
    });
  });
});
