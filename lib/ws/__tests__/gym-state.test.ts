import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted Mocks ────────────────────────────────────────────────────────────

const mockDbSelect = vi.hoisted(() => vi.fn());
const mockGetZoneForLang = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ db: { select: mockDbSelect } }));
vi.mock("@/lib/db/schema", () => ({
  gyms: {
    id: "id",
    name: "name",
    language: "language",
    timezone: "timezone",
    logoUrl: "logo_url",
    primaryColor: "primary_color",
    secondaryColor: "secondary_color",
    subscriptionStatus: "subscription_status",
  },
  athleteBands: {
    sensorId: "sensor_id",
    athleteId: "athlete_id",
    gymId: "gym_id",
    isActive: "is_active",
  },
  athletes: {
    id: "id",
    name: "name",
    maxHr: "max_hr",
    age: "age",
  },
  sessions: {
    id: "id",
    classType: "class_type",
    startedAt: "started_at",
    status: "status",
    gymId: "gym_id",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ _type: "eq", a, b })),
  and: vi.fn((...args) => ({ _type: "and", args })),
}));
vi.mock("@/lib/hr/zones", () => ({
  getZoneForLang: mockGetZoneForLang,
}));
vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Test Constants ───────────────────────────────────────────────────────────

const GYM_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID_2 = "550e8400-e29b-41d4-a716-446655440001";
const ATHLETE_ID = "550e8400-e29b-41d4-a716-446655440010";
const ATHLETE_ID_2 = "550e8400-e29b-41d4-a716-446655440011";
const SESSION_ID = "550e8400-e29b-41d4-a716-446655440020";

const gymConfigRow = {
  name: "Gym Pulse",
  language: "pt-BR",
  timezone: "America/Sao_Paulo",
  logoUrl: "https://example.com/logo.png",
  primaryColor: "#FF0000",
  secondaryColor: "#00FF00",
  subscriptionStatus: "active",
};

const bandRows = [
  { sensorId: 101, athleteId: ATHLETE_ID, name: "Carlos", maxHr: 185, age: 30 },
  { sensorId: 102, athleteId: ATHLETE_ID_2, name: "Maria", maxHr: 195, age: 25 },
];

const sessionRows = [
  { id: SESSION_ID, classType: "HIIT", startedAt: new Date("2026-02-27T10:00:00Z") },
];

// ─── Mock Setup Helpers ───────────────────────────────────────────────────────

let selectCallCount: number;

function setupDbMocks(
  gymRows = [gymConfigRow],
  bands = bandRows,
  sessions = sessionRows,
) {
  selectCallCount = 0;
  mockDbSelect.mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      // Gym config query
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(gymRows),
        }),
      };
    }
    if (selectCallCount === 2) {
      // Athlete-band mappings query (has innerJoin)
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(bands),
          }),
        }),
      };
    }
    // Active session query
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(sessions),
      }),
    };
  });
}

function setupRefreshMock(bands = bandRows) {
  // For refreshMappings — only 1 db.select call (bands query)
  mockDbSelect.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(bands),
      }),
    }),
  }));
}

function setupZoneMock() {
  mockGetZoneForLang.mockImplementation((bpm: number, _maxHr: number, _lang: string) => ({
    zone: bpm > 0 ? 3 : 0,
    zoneName: bpm > 0 ? "Aerobico" : "Repouso",
    zoneColor: bpm > 0 ? "#EAB308" : "#64748B",
    hrMaxPercent: bpm > 0 ? 76 : 0,
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GymStateManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupDbMocks();
    setupZoneMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Lazy import so mocks are registered first
  async function createManager() {
    const { GymStateManager } = await import("../gym-state");
    return new GymStateManager();
  }

  // ─── State Initialization ───────────────────────────────────────────────────

  it("loads gym config from database on first access", async () => {
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    expect(state.config.name).toBe("Gym Pulse");
    expect(state.config.language).toBe("pt-BR");
    expect(state.config.timezone).toBe("America/Sao_Paulo");
    expect(state.config.logoUrl).toBe("https://example.com/logo.png");
    expect(state.config.primaryColor).toBe("#FF0000");
    expect(state.config.secondaryColor).toBe("#00FF00");
    expect(state.config.subscriptionStatus).toBe("active");
    mgr.shutdown();
  });

  it("loads athlete-band mappings into sensorAthleteMap", async () => {
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    expect(state.sensorAthleteMap.size).toBe(2);
    expect(state.sensorAthleteMap.get(101)).toEqual({
      id: ATHLETE_ID,
      name: "Carlos",
      maxHr: 185,
      age: 30,
    });
    expect(state.sensorAthleteMap.get(102)).toEqual({
      id: ATHLETE_ID_2,
      name: "Maria",
      maxHr: 195,
      age: 25,
    });
    mgr.shutdown();
  });

  it("loads active session (or null when none)", async () => {
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    expect(state.activeSession).toEqual({
      id: SESSION_ID,
      classType: "HIIT",
      startedAt: "2026-02-27T10:00:00.000Z",
    });
    mgr.shutdown();
  });

  it("loads null activeSession when no active session exists", async () => {
    setupDbMocks([gymConfigRow], bandRows, []);
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    expect(state.activeSession).toBeNull();
    mgr.shutdown();
  });

  it("throws when gym not found in database", async () => {
    setupDbMocks([], bandRows, sessionRows);
    const mgr = await createManager();

    await expect(mgr.getOrLoadState(GYM_ID)).rejects.toThrow(
      `Gym not found: ${GYM_ID}`
    );
    mgr.shutdown();
  });

  it("defaults primaryColor to #000000 and secondaryColor to #FFFFFF when null", async () => {
    setupDbMocks(
      [{ ...gymConfigRow, primaryColor: null, secondaryColor: null }],
      bandRows,
      sessionRows
    );
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    expect(state.config.primaryColor).toBe("#000000");
    expect(state.config.secondaryColor).toBe("#FFFFFF");
    mgr.shutdown();
  });

  // ─── processHRData ──────────────────────────────────────────────────────────

  it("enriches HR data with athlete name and zone", async () => {
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    const result = mgr.processHRData(
      state,
      { "101": { bpm: 145, deviceActive: true } },
      "2026-02-27T12:00:00Z"
    );

    expect(result.enriched).toHaveLength(1);
    expect(result.enriched[0]).toMatchObject({
      sensorId: 101,
      athleteId: ATHLETE_ID,
      athleteName: "Carlos",
      bpm: 145,
      zone: 3,
      zoneName: "Aerobico",
      zoneColor: "#EAB308",
      hrMaxPercent: 76,
      deviceActive: true,
    });
    mgr.shutdown();
  });

  it("returns null athleteId for unknown sensor and does NOT generate HR reading", async () => {
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    const result = mgr.processHRData(
      state,
      { "999": { bpm: 120, deviceActive: true } },
      "2026-02-27T12:00:00Z"
    );

    expect(result.enriched).toHaveLength(1);
    expect(result.enriched[0].athleteId).toBeNull();
    expect(result.enriched[0].athleteName).toBeNull();
    expect(result.readings).toHaveLength(0);
    mgr.shutdown();
  });

  it("uses athlete maxHr (not default 190) for zone calculation", async () => {
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    mgr.processHRData(
      state,
      { "101": { bpm: 145, deviceActive: true } },
      "2026-02-27T12:00:00Z"
    );

    // Carlos has maxHr=185 — verify getZoneForLang was called with 185
    expect(mockGetZoneForLang).toHaveBeenCalledWith(145, 185, "pt");
    mgr.shutdown();
  });

  it("BPM=0 returns zone 0 (rest) and no HR reading", async () => {
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    const result = mgr.processHRData(
      state,
      { "101": { bpm: 0, deviceActive: true } },
      "2026-02-27T12:00:00Z"
    );

    expect(result.enriched[0].bpm).toBe(0);
    expect(result.enriched[0].zone).toBe(0);
    // BPM=0 → no reading even for mapped athlete
    expect(result.readings).toHaveLength(0);
    mgr.shutdown();
  });

  it("normalizes language 'pt-BR' to 'pt' for getZoneForLang", async () => {
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    mgr.processHRData(
      state,
      { "101": { bpm: 145, deviceActive: true } },
      "2026-02-27T12:00:00Z"
    );

    // Language in config is "pt-BR", should normalize to "pt"
    expect(mockGetZoneForLang).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      "pt"
    );
    mgr.shutdown();
  });

  it("generates readings only for mapped athletes with bpm > 0 and active session", async () => {
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    const result = mgr.processHRData(
      state,
      {
        "101": { bpm: 145, deviceActive: true },  // mapped, bpm > 0
        "102": { bpm: 0, deviceActive: true },     // mapped, bpm = 0 → no reading
        "999": { bpm: 130, deviceActive: true },   // unmapped → no reading
      },
      "2026-02-27T12:00:00Z"
    );

    // 3 enriched entries (all sensors get enriched)
    expect(result.enriched.length).toBe(3);
    // Only 1 reading (sensor 101 mapped + bpm > 0 + active session)
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]).toMatchObject({
      sessionId: SESSION_ID,
      gymId: GYM_ID,
      athleteId: ATHLETE_ID,
      sensorId: 101,
      heartRateBpm: 145,
      hrZone: 3,
      hrZoneName: "Aerobico",
      hrZoneColor: "#EAB308",
      hrMaxPercent: "76",
      deviceActive: true,
    });
    expect(result.readings[0].beatTime).toBeInstanceOf(Date);
    mgr.shutdown();
  });

  it("does NOT generate readings when no active session", async () => {
    setupDbMocks([gymConfigRow], bandRows, []); // No active session
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    const result = mgr.processHRData(
      state,
      { "101": { bpm: 145, deviceActive: true } },
      "2026-02-27T12:00:00Z"
    );

    expect(result.enriched).toHaveLength(1);
    expect(result.readings).toHaveLength(0);
    mgr.shutdown();
  });

  // ─── Refresh & Cache ────────────────────────────────────────────────────────

  it("periodic refresh reloads athlete-band mappings", async () => {
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    expect(state.sensorAthleteMap.size).toBe(2);

    // Now set up a refresh that returns a new athlete mapping
    const newBands = [
      { sensorId: 101, athleteId: ATHLETE_ID, name: "Carlos", maxHr: 185, age: 30 },
      { sensorId: 103, athleteId: ATHLETE_ID_2, name: "Maria Updated", maxHr: 200, age: 26 },
      { sensorId: 104, athleteId: "550e8400-e29b-41d4-a716-446655440012", name: "Pedro", maxHr: 180, age: 35 },
    ];
    setupRefreshMock(newBands);

    await mgr.refreshMappings(GYM_ID);

    expect(state.sensorAthleteMap.size).toBe(3);
    expect(state.sensorAthleteMap.get(103)?.name).toBe("Maria Updated");
    expect(state.sensorAthleteMap.get(104)?.name).toBe("Pedro");
    // Sensor 102 should be gone (not in new mapping)
    expect(state.sensorAthleteMap.has(102)).toBe(false);
    mgr.shutdown();
  });

  it("invalidateCache() removes cached state (next call forces fresh DB load)", async () => {
    const mgr = await createManager();
    await mgr.getOrLoadState(GYM_ID);

    // State is cached — getStats should show 1 active gym
    expect(mgr.getStats().activeGyms).toBe(1);

    mgr.invalidateCache(GYM_ID);

    // State should be gone
    expect(mgr.getStats().activeGyms).toBe(0);

    // Re-setup mocks for fresh load
    setupDbMocks();

    // Next call should trigger fresh DB load
    const newState = await mgr.getOrLoadState(GYM_ID);
    expect(newState.config.name).toBe("Gym Pulse");
    // Should have called db.select again (3 more queries)
    mgr.shutdown();
  });

  it("cached state returned on second call (no double DB load)", async () => {
    const mgr = await createManager();
    const state1 = await mgr.getOrLoadState(GYM_ID);

    // Clear call history after first load
    mockDbSelect.mockClear();
    setupDbMocks(); // Re-setup mocks (resets call counter)

    const state2 = await mgr.getOrLoadState(GYM_ID);

    // Same reference — no new DB call
    expect(state1).toBe(state2);
    // mockDbSelect should NOT have been called again (cache hit)
    expect(mockDbSelect).toHaveBeenCalledTimes(0);
    mgr.shutdown();
  });

  // ─── Eviction ───────────────────────────────────────────────────────────────

  it("eviction after 10 min idle removes state", async () => {
    const mgr = await createManager();
    await mgr.getOrLoadState(GYM_ID);

    expect(mgr.getStats().activeGyms).toBe(1);

    // Advance 11 minutes (past 10 min threshold)
    vi.advanceTimersByTime(11 * 60 * 1000);
    mgr.evictIdle();

    expect(mgr.getStats().activeGyms).toBe(0);
    mgr.shutdown();
  });

  it("eviction skips states with recent activity", async () => {
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    // Simulate activity at 9 minutes
    vi.advanceTimersByTime(9 * 60 * 1000);
    // processHRData updates lastActivity
    mgr.processHRData(state, { "101": { bpm: 100, deviceActive: true } }, "2026-02-27T12:00:00Z");

    // Advance 5 more minutes (total 14 from start, but only 5 from last activity)
    vi.advanceTimersByTime(5 * 60 * 1000);
    mgr.evictIdle();

    expect(mgr.getStats().activeGyms).toBe(1);
    mgr.shutdown();
  });

  // ─── Multiple Gyms ──────────────────────────────────────────────────────────

  it("multiple gyms maintain independent state", async () => {
    const mgr = await createManager();

    // Load first gym
    const state1 = await mgr.getOrLoadState(GYM_ID);

    // Setup mocks for second gym with different config
    setupDbMocks(
      [{ ...gymConfigRow, name: "Gym Beta", language: "es" }],
      [{ sensorId: 201, athleteId: ATHLETE_ID_2, name: "Ana", maxHr: 175, age: 28 }],
      []
    );

    const state2 = await mgr.getOrLoadState(GYM_ID_2);

    expect(mgr.getStats().activeGyms).toBe(2);
    expect(state1.config.name).toBe("Gym Pulse");
    expect(state2.config.name).toBe("Gym Beta");
    expect(state1.sensorAthleteMap.size).toBe(2);
    expect(state2.sensorAthleteMap.size).toBe(1);
    mgr.shutdown();
  });

  // ─── getStats ───────────────────────────────────────────────────────────────

  it("getStats() returns correct counts", async () => {
    const mgr = await createManager();

    expect(mgr.getStats()).toEqual({ activeGyms: 0 });

    await mgr.getOrLoadState(GYM_ID);
    expect(mgr.getStats()).toEqual({ activeGyms: 1 });

    mgr.invalidateCache(GYM_ID);
    expect(mgr.getStats()).toEqual({ activeGyms: 0 });
    mgr.shutdown();
  });

  // ─── Session Management ─────────────────────────────────────────────────────

  it("clearActiveSession() removes session from state", async () => {
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    expect(state.activeSession).not.toBeNull();

    mgr.clearActiveSession(GYM_ID);

    expect(state.activeSession).toBeNull();
    expect(mgr.getActiveSession(GYM_ID)).toBeNull();
    mgr.shutdown();
  });

  it("setActiveSession() updates session in state", async () => {
    setupDbMocks([gymConfigRow], bandRows, []); // No initial session
    const mgr = await createManager();
    await mgr.getOrLoadState(GYM_ID);

    expect(mgr.getActiveSession(GYM_ID)).toBeNull();

    const newSession = {
      id: "550e8400-e29b-41d4-a716-446655440030",
      classType: "Yoga",
      startedAt: "2026-02-27T14:00:00Z",
    };
    mgr.setActiveSession(GYM_ID, newSession);

    expect(mgr.getActiveSession(GYM_ID)).toEqual(newSession);
    mgr.shutdown();
  });

  // ─── Language Normalization (es) ────────────────────────────────────────────

  it("normalizes 'es' language (default) correctly", async () => {
    setupDbMocks(
      [{ ...gymConfigRow, language: "es-AR" }],
      [{ sensorId: 101, athleteId: ATHLETE_ID, name: "Carlos", maxHr: 185, age: 30 }],
      sessionRows
    );
    const mgr = await createManager();
    const state = await mgr.getOrLoadState(GYM_ID);

    mgr.processHRData(
      state,
      { "101": { bpm: 145, deviceActive: true } },
      "2026-02-27T12:00:00Z"
    );

    expect(mockGetZoneForLang).toHaveBeenCalledWith(145, 185, "es");
    mgr.shutdown();
  });
});
