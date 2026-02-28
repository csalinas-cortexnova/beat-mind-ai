// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockDb,
  mockCalculateStats,
  mockGenerateToken,
  mockGenerateSummary,
  mockSendWhatsApp,
  mockBuildTemplate,
  mockLog,
} = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    query: {
      sessions: { findFirst: vi.fn() },
      gyms: { findFirst: vi.fn() },
    },
  },
  mockCalculateStats: vi.fn(),
  mockGenerateToken: vi.fn(),
  mockGenerateSummary: vi.fn(),
  mockSendWhatsApp: vi.fn(),
  mockBuildTemplate: vi.fn(),
  mockLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/db/schema", () => ({
  sessions: {
    id: "id",
    gymId: "gymId",
    classType: "classType",
    durationSeconds: "durationSeconds",
    athleteCount: "athleteCount",
    aiSummary: "aiSummary",
    status: "status",
  },
  sessionAthletes: {
    id: "id",
    sessionId: "sessionId",
    athleteId: "athleteId",
    avgHr: "avgHr",
    maxHr: "maxHr",
    minHr: "minHr",
    calories: "calories",
    timeZone1S: "timeZone1S",
    timeZone2S: "timeZone2S",
    timeZone3S: "timeZone3S",
    timeZone4S: "timeZone4S",
    timeZone5S: "timeZone5S",
    reportToken: "reportToken",
    whatsappSentAt: "whatsappSentAt",
    whatsappStatus: "whatsappStatus",
  },
  athletes: {
    id: "id",
    name: "name",
    phone: "phone",
    whatsappOptIn: "whatsappOptIn",
  },
  gyms: {
    id: "id",
    name: "name",
  },
}));

vi.mock("@/lib/reports/stats", () => ({
  calculateAthleteSessionStats: mockCalculateStats,
}));

vi.mock("@/lib/reports/token", () => ({
  generateReportToken: mockGenerateToken,
}));

vi.mock("@/lib/ai/coach", () => ({
  generatePostSessionSummary: mockGenerateSummary,
}));

vi.mock("@/lib/whatsapp/client", () => ({
  sendWhatsAppMessage: mockSendWhatsApp,
}));

vi.mock("@/lib/whatsapp/templates", () => ({
  buildSessionReportTemplate: mockBuildTemplate,
}));

vi.mock("@/lib/logger", () => ({
  log: mockLog,
}));

// Mock drizzle-orm operators
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  isNull: vi.fn((...args: unknown[]) => ({ op: "isNull", args })),
  sql: vi.fn(),
}));

import { generateSessionReport, formatDuration } from "../generate";

// ─── Test data ──────────────────────────────────────────────────────────────

const sessionId = "550e8400-e29b-41d4-a716-446655440001";
const gymId = "550e8400-e29b-41d4-a716-446655440002";

const mockStats = [
  {
    athleteId: "a1",
    athleteName: "Maria",
    avgHr: 145,
    maxHr: 170,
    minHr: 110,
    calories: 420,
    zoneTimes: {
      zone1Seconds: 120,
      zone2Seconds: 300,
      zone3Seconds: 600,
      zone4Seconds: 400,
      zone5Seconds: 80,
    },
  },
  {
    athleteId: "a2",
    athleteName: "Carlos",
    avgHr: 155,
    maxHr: 180,
    minHr: 120,
    calories: 550,
    zoneTimes: {
      zone1Seconds: 60,
      zone2Seconds: 200,
      zone3Seconds: 500,
      zone4Seconds: 600,
      zone5Seconds: 140,
    },
  },
];

describe("formatDuration", () => {
  it("should format seconds into mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(90)).toBe("01:30");
    expect(formatDuration(3600)).toBe("60:00");
    expect(formatDuration(3661)).toBe("61:01");
  });
});

describe("generateSessionReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default: session has durationSeconds and aiSummary
    mockDb.query.sessions.findFirst.mockResolvedValue({
      durationSeconds: 1800,
      classType: "Spinning",
      aiSummary: "Great workout!",
    });

    mockDb.query.gyms.findFirst.mockResolvedValue({
      name: "PowerGym",
    });

    // Default: stats for 2 athletes
    mockCalculateStats.mockResolvedValue(mockStats);

    // Default: upsert chain
    const mockInsertChain = {
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    };
    mockDb.insert.mockReturnValue(mockInsertChain);

    // Default: update chain
    const mockUpdateChain = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };
    mockDb.update.mockReturnValue(mockUpdateChain);

    // Default: WhatsApp eligible athletes query
    const mockSelectChain = {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              athleteId: "a1",
              athleteName: "Maria",
              phone: "+5511999998888",
              whatsappOptIn: true,
              whatsappSentAt: null,
            },
          ]),
        }),
      }),
    };
    mockDb.select.mockReturnValue(mockSelectChain);

    // Default: token generation
    mockGenerateToken.mockReturnValue("mock-report-token");

    // Default: template builder
    mockBuildTemplate.mockReturnValue({
      templateName: "session_report",
      params: ["Maria", "Spinning", "PowerGym", "30:00", "145", "420", "https://app.com/report"],
    });

    // Default: WhatsApp send success
    mockSendWhatsApp.mockResolvedValue({ success: true, messageSid: "SM123" });

    // Set env vars
    process.env.NEXT_PUBLIC_APP_URL = "https://app.beatmind.ai";
    process.env.REPORT_TOKEN_SECRET = "test-secret";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.REPORT_TOKEN_SECRET;
  });

  it("should run full pipeline: stats, upsert, update count, schedule WhatsApp", async () => {
    const promise = generateSessionReport(sessionId, gymId);

    // Advance past the 2-minute WhatsApp delay
    await vi.advanceTimersByTimeAsync(120_000);

    await promise;

    // 1. Queried session
    expect(mockDb.query.sessions.findFirst).toHaveBeenCalled();

    // 2. Calculated stats
    expect(mockCalculateStats).toHaveBeenCalledWith(sessionId, 1800);

    // 3. Upserted session_athletes (once per athlete)
    expect(mockDb.insert).toHaveBeenCalledTimes(2);

    // 4. Updated sessions.athlete_count
    expect(mockDb.update).toHaveBeenCalled();

    // 5. Did NOT call generatePostSessionSummary (aiSummary already exists)
    expect(mockGenerateSummary).not.toHaveBeenCalled();

    // 6. WhatsApp was scheduled and sent
    expect(mockSendWhatsApp).toHaveBeenCalled();
  });

  it("should return early with no upserts when no readings exist", async () => {
    mockCalculateStats.mockResolvedValue([]);

    await generateSessionReport(sessionId, gymId);

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringContaining("No stats"),
      expect.objectContaining({ module: "reports" })
    );
  });

  it("should skip WhatsApp when no opt-in athletes", async () => {
    // Override select to return empty eligible list
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const promise = generateSessionReport(sessionId, gymId);
    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    expect(mockSendWhatsApp).not.toHaveBeenCalled();
  });

  it("should skip WhatsApp when athlete has no phone number", async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              athleteId: "a1",
              athleteName: "Maria",
              phone: null,
              whatsappOptIn: true,
              whatsappSentAt: null,
            },
          ]),
        }),
      }),
    });

    const promise = generateSessionReport(sessionId, gymId);
    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    expect(mockSendWhatsApp).not.toHaveBeenCalled();
  });

  it("should skip WhatsApp when already sent (whatsappSentAt is not null)", async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              athleteId: "a1",
              athleteName: "Maria",
              phone: "+5511999998888",
              whatsappOptIn: true,
              whatsappSentAt: new Date(), // Already sent
            },
          ]),
        }),
      }),
    });

    const promise = generateSessionReport(sessionId, gymId);
    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    expect(mockSendWhatsApp).not.toHaveBeenCalled();
  });

  it("should not call generatePostSessionSummary when aiSummary already exists", async () => {
    // aiSummary is already set in the default mock
    const promise = generateSessionReport(sessionId, gymId);
    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    expect(mockGenerateSummary).not.toHaveBeenCalled();
  });

  it("should call generatePostSessionSummary when aiSummary is null", async () => {
    mockDb.query.sessions.findFirst.mockResolvedValue({
      durationSeconds: 1800,
      classType: "Spinning",
      aiSummary: null,
    });
    mockGenerateSummary.mockResolvedValue("AI generated summary");

    const promise = generateSessionReport(sessionId, gymId);
    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    expect(mockGenerateSummary).toHaveBeenCalledWith(sessionId, gymId);
  });

  it("should update sessions.athlete_count correctly", async () => {
    const mockSetFn = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: mockSetFn });

    const promise = generateSessionReport(sessionId, gymId);
    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    // athlete_count should be 2 (number of stats)
    expect(mockSetFn).toHaveBeenCalledWith(
      expect.objectContaining({ athleteCount: 2 })
    );
  });
});
