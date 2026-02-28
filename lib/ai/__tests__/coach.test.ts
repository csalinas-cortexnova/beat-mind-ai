import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mockCreate = vi.hoisted(() => vi.fn());
const mockInsert = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockFindFirstGyms = vi.hoisted(() => vi.fn());
const mockFindFirstSessions = vi.hoisted(() => vi.fn());
const mockLog = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
    },
  };
});

vi.mock("@/lib/db", () => {
  // Chainable mock builder
  function chain() {
    const obj: Record<string, unknown> = {};
    obj.values = vi.fn().mockReturnValue(obj);
    obj.from = vi.fn().mockReturnValue(obj);
    obj.innerJoin = vi.fn().mockReturnValue(obj);
    obj.where = vi.fn().mockReturnValue(obj);
    obj.orderBy = vi.fn().mockReturnValue(obj);
    obj.set = vi.fn().mockReturnValue(obj);
    // Make thenable to resolve as empty array by default
    obj.then = vi.fn((resolve: (v: unknown) => void) => resolve([]));
    return obj;
  }

  const insertChain = chain();
  mockInsert.mockReturnValue(insertChain);

  const updateChain = chain();
  mockUpdate.mockReturnValue(updateChain);

  const selectChain = chain();
  mockSelect.mockReturnValue(selectChain);

  return {
    db: {
      insert: mockInsert,
      update: mockUpdate,
      select: mockSelect,
      query: {
        gyms: { findFirst: mockFindFirstGyms },
        sessions: { findFirst: mockFindFirstSessions },
      },
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  hrReadings: { athleteId: "athleteId", sessionId: "sessionId", gymId: "gymId", recordedAt: "recordedAt", heartRateBpm: "heartRateBpm", hrZone: "hrZone", hrZoneName: "hrZoneName", id: "id" },
  athletes: { id: "id", name: "name" },
  sessions: { id: "id", aiSummary: "aiSummary", classType: "classType", durationSeconds: "durationSeconds", status: "status" },
  gyms: { id: "id", language: "language" },
  aiCoachingMessages: { id: "id" },
}));

vi.mock("@/lib/logger", () => ({
  log: mockLog,
}));

vi.mock("@/lib/hr/zones", () => ({
  getZoneForLang: vi.fn(),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
  getCoachingConfig,
  startCoachingTimer,
  stopCoachingTimer,
  stopAllTimers,
  getActiveTimerCount,
  runAnalysisCycle,
  fetchAndSummarize,
  callOpenAI,
  generatePostSessionSummary,
  _testing,
} from "../coach";
import type { CoachingConfig, CoachBroadcastFn } from "../types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SESSION_ID = "550e8400-e29b-41d4-a716-446655440010";
const GYM_ID = "550e8400-e29b-41d4-a716-446655440020";

function makeConfig(overrides?: Partial<CoachingConfig>): CoachingConfig {
  return {
    enabled: true,
    model: "gpt-4o-mini",
    intervalMs: 60000,
    warmupPeriodMs: 60000,
    analysisMinutes: 10,
    language: "es",
    classType: null,
    ...overrides,
  };
}

function mockOpenAIResponse(content: string) {
  mockCreate.mockResolvedValue({
    choices: [{ message: { content } }],
  });
}

// ─── Setup/Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  _testing.resetClient();
  stopAllTimers();
  // Default env
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_MODEL = "gpt-4o-mini";
});

afterEach(() => {
  stopAllTimers();
  vi.useRealTimers();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  delete process.env.AI_ANALYSIS_INTERVAL_MS;
  delete process.env.AI_WARMUP_MS;
  delete process.env.AI_ANALYSIS_MINUTES;
});

// ─── getCoachingConfig ──────────────────────────────────────────────────────

describe("getCoachingConfig", () => {
  it("returns defaults when env vars not set", () => {
    delete process.env.AI_ANALYSIS_INTERVAL_MS;
    delete process.env.AI_WARMUP_MS;
    delete process.env.AI_ANALYSIS_MINUTES;

    const config = getCoachingConfig({ language: "es" });
    expect(config.enabled).toBe(true);
    expect(config.model).toBe("gpt-4o-mini");
    expect(config.intervalMs).toBe(60000);
    expect(config.warmupPeriodMs).toBe(60000);
    expect(config.analysisMinutes).toBe(10);
    expect(config.language).toBe("es");
  });

  it("returns config from env vars when set", () => {
    process.env.AI_ANALYSIS_INTERVAL_MS = "30000";
    process.env.AI_WARMUP_MS = "45000";
    process.env.AI_ANALYSIS_MINUTES = "5";
    process.env.OPENAI_MODEL = "gpt-4o";

    const config = getCoachingConfig({ language: "es" });
    expect(config.intervalMs).toBe(30000);
    expect(config.warmupPeriodMs).toBe(45000);
    expect(config.analysisMinutes).toBe(5);
    expect(config.model).toBe("gpt-4o");
  });

  it('normalizes "pt-BR" to "pt"', () => {
    const config = getCoachingConfig({ language: "pt-BR" });
    expect(config.language).toBe("pt");
  });
});

// ─── callOpenAI ─────────────────────────────────────────────────────────────

describe("callOpenAI", () => {
  it("returns message on success", async () => {
    mockOpenAIResponse("Great job, keep going!");

    const result = await callOpenAI(
      makeConfig(),
      "system prompt",
      "user prompt",
      200
    );
    expect(result).toBe("Great job, keep going!");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        max_tokens: 200,
        temperature: 0.8,
      })
    );
  });

  it("returns null when API key not set", async () => {
    delete process.env.OPENAI_API_KEY;
    _testing.resetClient();

    const result = await callOpenAI(
      makeConfig({ enabled: false }),
      "sys",
      "usr",
      200
    );
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns null on empty response", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "" } }],
    });

    const result = await callOpenAI(makeConfig(), "sys", "usr", 200);
    expect(result).toBeNull();
  });

  it("returns null on API error (401)", async () => {
    const error = new Error("Unauthorized");
    (error as unknown as { status: number }).status = 401;
    mockCreate.mockRejectedValue(error);

    const result = await callOpenAI(makeConfig(), "sys", "usr", 200);
    expect(result).toBeNull();
  });

  it("returns null on timeout", async () => {
    mockCreate.mockRejectedValue(new Error("Request timed out"));

    const result = await callOpenAI(makeConfig(), "sys", "usr", 200);
    expect(result).toBeNull();
  });

  it("logs appropriate error for each failure type", async () => {
    const error = new Error("Rate limited");
    (error as unknown as { status: number }).status = 429;
    mockCreate.mockRejectedValue(error);

    await callOpenAI(makeConfig(), "sys", "usr", 200);
    expect(mockLog.error).toHaveBeenCalledWith(
      "OpenAI API call failed",
      expect.objectContaining({
        module: "ai-coach",
        status: 429,
      })
    );
  });
});

// ─── fetchAndSummarize ──────────────────────────────────────────────────────

describe("fetchAndSummarize", () => {
  it("returns empty array when no HR data", async () => {
    // Default mock returns []
    const result = await fetchAndSummarize(SESSION_ID, GYM_ID, makeConfig());
    expect(result).toEqual([]);
  });

  it("returns single athlete summary with correct fields", async () => {
    const mockRows = [
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 150, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 140, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 130, hrZone: 2, hrZoneName: "Quema de grasa", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 120, hrZone: 2, hrZoneName: "Quema de grasa", recordedAt: new Date() },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) => resolve(mockRows)),
            }),
          }),
        }),
      }),
    });

    const result = await fetchAndSummarize(SESSION_ID, GYM_ID, makeConfig());
    expect(result).toHaveLength(1);
    expect(result[0].athleteId).toBe("a1");
    expect(result[0].athleteName).toBe("Carlos");
    expect(result[0].readingsCount).toBe(4);
    expect(result[0].currentZoneName).toBe("Aeróbico");
  });

  it("returns multiple athlete summaries", async () => {
    const mockRows = [
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 150, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
      { athleteId: "a2", athleteName: "Maria", heartRateBpm: 130, hrZone: 2, hrZoneName: "Quema de grasa", recordedAt: new Date() },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) => resolve(mockRows)),
            }),
          }),
        }),
      }),
    });

    const result = await fetchAndSummarize(SESSION_ID, GYM_ID, makeConfig());
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.athleteName)).toContain("Carlos");
    expect(result.map((s) => s.athleteName)).toContain("Maria");
  });

  it("computes avgBpm correctly (rounded integer)", async () => {
    const mockRows = [
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 145, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 150, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 155, hrZone: 4, hrZoneName: "Umbral", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 140, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) => resolve(mockRows)),
            }),
          }),
        }),
      }),
    });

    const result = await fetchAndSummarize(SESSION_ID, GYM_ID, makeConfig());
    // (145+150+155+140)/4 = 147.5 → 148
    expect(result[0].avgBpm).toBe(148);
  });

  it("computes maxBpm and minBpm correctly", async () => {
    const mockRows = [
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 170, hrZone: 4, hrZoneName: "Umbral", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 95, hrZone: 1, hrZoneName: "Calentamiento", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 130, hrZone: 2, hrZoneName: "Quema", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 145, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) => resolve(mockRows)),
            }),
          }),
        }),
      }),
    });

    const result = await fetchAndSummarize(SESSION_ID, GYM_ID, makeConfig());
    expect(result[0].maxBpm).toBe(170);
    expect(result[0].minBpm).toBe(95);
  });

  it('computes trend "rising" when recent avg > older avg by >5', async () => {
    // Readings in DESC order: recent first (higher BPMs), older last (lower BPMs)
    const mockRows = [
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 160, hrZone: 4, hrZoneName: "Umbral", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 155, hrZone: 4, hrZoneName: "Umbral", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 130, hrZone: 2, hrZoneName: "Quema", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 125, hrZone: 2, hrZoneName: "Quema", recordedAt: new Date() },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) => resolve(mockRows)),
            }),
          }),
        }),
      }),
    });

    const result = await fetchAndSummarize(SESSION_ID, GYM_ID, makeConfig());
    // recent avg: (160+155)/2 = 157.5, older avg: (130+125)/2 = 127.5, diff = 30 > 5
    expect(result[0].trend).toBe("rising");
  });

  it('computes trend "falling" when recent avg < older avg by >5', async () => {
    const mockRows = [
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 120, hrZone: 2, hrZoneName: "Quema", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 115, hrZone: 2, hrZoneName: "Quema", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 155, hrZone: 4, hrZoneName: "Umbral", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 160, hrZone: 4, hrZoneName: "Umbral", recordedAt: new Date() },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) => resolve(mockRows)),
            }),
          }),
        }),
      }),
    });

    const result = await fetchAndSummarize(SESSION_ID, GYM_ID, makeConfig());
    // recent avg: (120+115)/2 = 117.5, older avg: (155+160)/2 = 157.5, diff = -40 < -5
    expect(result[0].trend).toBe("falling");
  });

  it('computes trend "stable" when difference <= 5', async () => {
    const mockRows = [
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 142, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 143, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 140, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 141, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) => resolve(mockRows)),
            }),
          }),
        }),
      }),
    });

    const result = await fetchAndSummarize(SESSION_ID, GYM_ID, makeConfig());
    // recent avg: (142+143)/2 = 142.5, older avg: (140+141)/2 = 140.5, diff = 2 <= 5
    expect(result[0].trend).toBe("stable");
  });
});

// ─── runAnalysisCycle ───────────────────────────────────────────────────────

describe("runAnalysisCycle", () => {
  const mockBroadcast: CoachBroadcastFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips during warmup period", async () => {
    const config = makeConfig({ warmupPeriodMs: 120000 });

    // Manually set up timer state to simulate an active timer
    const timers = _testing.getActiveTimers();
    timers.set(SESSION_ID, {
      sessionId: SESSION_ID,
      gymId: GYM_ID,
      config,
      timer: setInterval(() => {}, 60000),
      startedAt: Date.now(), // just started, within warmup
      broadcastFn: mockBroadcast,
    });

    await runAnalysisCycle(SESSION_ID, GYM_ID, config, mockBroadcast);

    // Should not call select (data fetch)
    expect(mockSelect).not.toHaveBeenCalled();

    // Cleanup
    clearInterval(timers.get(SESSION_ID)!.timer);
    timers.delete(SESSION_ID);
  });

  it("skips when no HR data", async () => {
    // Explicitly set up select to return empty array
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) => resolve([])),
            }),
          }),
        }),
      }),
    });

    await runAnalysisCycle(SESSION_ID, GYM_ID, makeConfig(), mockBroadcast);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it("calls OpenAI and stores message on success", async () => {
    const mockRows = [
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 145, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 140, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) => resolve(mockRows)),
            }),
          }),
        }),
      }),
    });

    mockOpenAIResponse("Keep pushing Carlos!");

    await runAnalysisCycle(SESSION_ID, GYM_ID, makeConfig(), mockBroadcast);

    // Should have called OpenAI
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // Should have inserted to DB
    expect(mockInsert).toHaveBeenCalled();
  });

  it("broadcasts TvCoachMessage on success", async () => {
    const mockRows = [
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 145, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 140, hrZone: 3, hrZoneName: "Aeróbico", recordedAt: new Date() },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) => resolve(mockRows)),
            }),
          }),
        }),
      }),
    });

    mockOpenAIResponse("Great pace Carlos!");

    await runAnalysisCycle(SESSION_ID, GYM_ID, makeConfig(), mockBroadcast);

    expect(mockBroadcast).toHaveBeenCalledWith(GYM_ID, {
      type: "coach-message",
      message: "Great pace Carlos!",
    });
  });

  it("catches errors and continues (no throw)", async () => {
    mockSelect.mockImplementation(() => {
      throw new Error("DB connection lost");
    });

    // Should not throw
    await expect(
      runAnalysisCycle(SESSION_ID, GYM_ID, makeConfig(), mockBroadcast)
    ).resolves.not.toThrow();
  });
});

// ─── startCoachingTimer ─────────────────────────────────────────────────────

describe("startCoachingTimer", () => {
  const mockBroadcast: CoachBroadcastFn = vi.fn();

  it("starts timer and adds to activeTimers", () => {
    startCoachingTimer(SESSION_ID, GYM_ID, makeConfig(), mockBroadcast);
    expect(getActiveTimerCount()).toBe(1);
  });

  it("prevents duplicate timer for same session", () => {
    startCoachingTimer(SESSION_ID, GYM_ID, makeConfig(), mockBroadcast);
    startCoachingTimer(SESSION_ID, GYM_ID, makeConfig(), mockBroadcast);

    expect(getActiveTimerCount()).toBe(1);
    expect(mockLog.warn).toHaveBeenCalledWith(
      "Coaching timer already active for session",
      expect.objectContaining({ sessionId: SESSION_ID })
    );
  });

  it("does nothing when coaching disabled", () => {
    const config = makeConfig({ enabled: false });
    delete process.env.OPENAI_API_KEY;

    startCoachingTimer(SESSION_ID, GYM_ID, config, mockBroadcast);
    expect(getActiveTimerCount()).toBe(0);
  });
});

// ─── stopCoachingTimer ──────────────────────────────────────────────────────

describe("stopCoachingTimer", () => {
  const mockBroadcast: CoachBroadcastFn = vi.fn();

  it("clears interval and removes from map", () => {
    startCoachingTimer(SESSION_ID, GYM_ID, makeConfig(), mockBroadcast);
    expect(getActiveTimerCount()).toBe(1);

    stopCoachingTimer(SESSION_ID);
    expect(getActiveTimerCount()).toBe(0);
  });

  it("handles non-existent session gracefully", () => {
    expect(() => stopCoachingTimer("non-existent")).not.toThrow();
    expect(getActiveTimerCount()).toBe(0);
  });
});

// ─── stopAllTimers ──────────────────────────────────────────────────────────

describe("stopAllTimers", () => {
  const mockBroadcast: CoachBroadcastFn = vi.fn();

  it("clears all active timers", () => {
    startCoachingTimer(SESSION_ID, GYM_ID, makeConfig(), mockBroadcast);
    startCoachingTimer("session-2", GYM_ID, makeConfig(), mockBroadcast);
    expect(getActiveTimerCount()).toBe(2);

    stopAllTimers();
    expect(getActiveTimerCount()).toBe(0);
  });
});

// ─── generatePostSessionSummary ─────────────────────────────────────────────

describe("generatePostSessionSummary", () => {
  it("generates summary and stores in sessions.aiSummary", async () => {
    mockFindFirstGyms.mockResolvedValue({ language: "es" });
    mockFindFirstSessions.mockResolvedValue({
      classType: "spinning",
      durationSeconds: 1800,
    });

    const hrRows = [
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 150, hrZone: 3, hrZoneName: "Aeróbico" },
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 140, hrZone: 3, hrZoneName: "Aeróbico" },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: vi.fn((resolve: (v: unknown) => void) => resolve(hrRows)),
          }),
        }),
      }),
    });

    mockOpenAIResponse("Great session! The group maintained a strong aerobic pace.");

    const updateChain = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    mockUpdate.mockReturnValue(updateChain);

    const result = await generatePostSessionSummary(SESSION_ID, GYM_ID);

    expect(result).toBe("Great session! The group maintained a strong aerobic pace.");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("returns null when no athlete data", async () => {
    mockFindFirstGyms.mockResolvedValue({ language: "es" });
    mockFindFirstSessions.mockResolvedValue({
      classType: "spinning",
      durationSeconds: 1800,
    });

    // Empty HR data
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: vi.fn((resolve: (v: unknown) => void) => resolve([])),
          }),
        }),
      }),
    });

    const result = await generatePostSessionSummary(SESSION_ID, GYM_ID);
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns null when OpenAI disabled", async () => {
    delete process.env.OPENAI_API_KEY;
    _testing.resetClient();

    mockFindFirstGyms.mockResolvedValue({ language: "es" });
    mockFindFirstSessions.mockResolvedValue({
      classType: "spinning",
      durationSeconds: 1800,
    });

    const hrRows = [
      { athleteId: "a1", athleteName: "Carlos", heartRateBpm: 150, hrZone: 3, hrZoneName: "Aeróbico" },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: vi.fn((resolve: (v: unknown) => void) => resolve(hrRows)),
          }),
        }),
      }),
    });

    const result = await generatePostSessionSummary(SESSION_ID, GYM_ID);
    expect(result).toBeNull();
  });
});
