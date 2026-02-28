import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockInsert = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockReturning = vi.hoisted(() => vi.fn());
const mockUpdateSet = vi.hoisted(() => vi.fn());
const mockUpdateWhere = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: mockReturning }) }),
    update: () => ({ set: mockUpdateSet }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  sessions: { id: "id", gymId: "gym_id", status: "status", startedAt: "started_at" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ _type: "eq", a, b })),
  and: vi.fn((...args) => ({ _type: "and", args })),
}));

vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { AutoSessionManager } from "../auto-session";
import type { GymStateManager } from "../gym-state";

const gymId = "550e8400-e29b-41d4-a716-446655440000";
const sessionId = "660e8400-e29b-41d4-a716-446655440000";

function createMockGymState(): GymStateManager {
  return {
    getActiveSession: vi.fn().mockReturnValue(null),
    setActiveSession: vi.fn(),
    clearActiveSession: vi.fn(),
  } as unknown as GymStateManager;
}

describe("AutoSessionManager", () => {
  let autoSession: AutoSessionManager;
  let mockGymState: GymStateManager;
  let mockBroadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockGymState = createMockGymState();
    mockBroadcast = vi.fn();
    autoSession = new AutoSessionManager(mockGymState, mockBroadcast);

    mockReturning.mockResolvedValue([
      { id: sessionId, startedAt: new Date("2026-02-27T10:00:00Z") },
    ]);
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockResolvedValue(undefined);
  });

  afterEach(() => {
    autoSession.shutdown();
    vi.useRealTimers();
  });

  it("should not auto-start before 30 consecutive HR ticks", async () => {
    for (let i = 0; i < 29; i++) {
      await autoSession.onHRData(gymId, { "101": { bpm: 120, deviceActive: true } });
    }
    expect(mockReturning).not.toHaveBeenCalled();
  });

  it("should auto-start session after 30 consecutive HR ticks with bpm > 0", async () => {
    for (let i = 0; i < 30; i++) {
      await autoSession.onHRData(gymId, { "101": { bpm: 120, deviceActive: true } });
    }
    expect(mockReturning).toHaveBeenCalled();
    expect((mockGymState.setActiveSession as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      gymId,
      expect.objectContaining({ id: sessionId, classType: "auto" })
    );
    expect(mockBroadcast).toHaveBeenCalledWith(
      gymId,
      expect.objectContaining({ type: "session-start", sessionId })
    );
  });

  it("should not auto-start if bpm=0 (reset counter)", async () => {
    for (let i = 0; i < 15; i++) {
      await autoSession.onHRData(gymId, { "101": { bpm: 120, deviceActive: true } });
    }
    // All bpm=0 resets counter
    await autoSession.onHRData(gymId, { "101": { bpm: 0, deviceActive: false } });
    for (let i = 0; i < 15; i++) {
      await autoSession.onHRData(gymId, { "101": { bpm: 120, deviceActive: true } });
    }
    expect(mockReturning).not.toHaveBeenCalled();
  });

  it("should not auto-start if manual session already exists", async () => {
    (mockGymState.getActiveSession as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "existing-session",
      classType: "HIIT",
      startedAt: "2026-02-27T10:00:00Z",
    });

    for (let i = 0; i < 30; i++) {
      await autoSession.onHRData(gymId, { "101": { bpm: 120, deviceActive: true } });
    }
    expect(mockReturning).not.toHaveBeenCalled();
  });

  it("should auto-end session after 2 min of silence", async () => {
    // Simulate session started
    (mockGymState.getActiveSession as ReturnType<typeof vi.fn>).mockReturnValue({
      id: sessionId,
      classType: "auto",
      startedAt: "2026-02-27T10:00:00Z",
    });

    // Last active HR
    await autoSession.onHRData(gymId, { "101": { bpm: 120, deviceActive: true } });

    autoSession.start();

    // Advance past 2 min + check interval (130s total, in 10s steps to trigger checks)
    for (let i = 0; i < 14; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
    }

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
    expect((mockGymState.clearActiveSession as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(gymId);
    expect(mockBroadcast).toHaveBeenCalledWith(
      gymId,
      expect.objectContaining({ type: "session-end", sessionId })
    );
  });

  it("should not auto-end during active data", async () => {
    (mockGymState.getActiveSession as ReturnType<typeof vi.fn>).mockReturnValue({
      id: sessionId,
      classType: "auto",
      startedAt: "2026-02-27T10:00:00Z",
    });

    autoSession.start();

    // Keep sending HR data every 10s (less than 2 min)
    for (let i = 0; i < 10; i++) {
      await autoSession.onHRData(gymId, { "101": { bpm: 120, deviceActive: true } });
      vi.advanceTimersByTime(10_000);
    }

    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("should broadcast session-start on auto-start", async () => {
    for (let i = 0; i < 30; i++) {
      await autoSession.onHRData(gymId, { "101": { bpm: 120, deviceActive: true } });
    }
    expect(mockBroadcast).toHaveBeenCalledWith(
      gymId,
      expect.objectContaining({
        type: "session-start",
        classType: "auto",
      })
    );
  });

  it("should broadcast session-end on auto-end", async () => {
    (mockGymState.getActiveSession as ReturnType<typeof vi.fn>).mockReturnValue({
      id: sessionId,
      classType: "auto",
      startedAt: new Date(Date.now() - 300_000).toISOString(), // 5 min ago
    });

    await autoSession.onHRData(gymId, { "101": { bpm: 120, deviceActive: true } });
    autoSession.start();

    // Advance in 10s steps to trigger interval checks
    for (let i = 0; i < 14; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
    }

    expect(mockBroadcast).toHaveBeenCalledWith(
      gymId,
      expect.objectContaining({
        type: "session-end",
        sessionId,
      })
    );
  });
});
