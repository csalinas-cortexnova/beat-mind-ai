import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

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
  sessions: {
    id: "id",
    gymId: "gym_id",
    status: "status",
    startedAt: "started_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ _type: "eq", a, b })),
  and: vi.fn((...args) => ({ _type: "and", args })),
}));

vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { AutoSessionManager } from "@/lib/ws/auto-session";
import type { SessionLifecycleCallbacks } from "@/lib/ws/auto-session";
import type { GymStateManager } from "@/lib/ws/gym-state";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const gymId = "550e8400-e29b-41d4-a716-446655440020";
const sessionId = "550e8400-e29b-41d4-a716-446655440010";

function createMockGymState(): GymStateManager {
  return {
    getActiveSession: vi.fn().mockReturnValue(null),
    setActiveSession: vi.fn(),
    clearActiveSession: vi.fn(),
  } as unknown as GymStateManager;
}

function activeDevices(): Record<
  string,
  { bpm: number; deviceActive: boolean }
> {
  return { "123": { bpm: 140, deviceActive: true } };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AutoSessionManager lifecycle callbacks", () => {
  let autoSession: AutoSessionManager;
  let mockGymState: GymStateManager;
  let mockBroadcast: ReturnType<typeof vi.fn>;
  let callbacks: SessionLifecycleCallbacks;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockGymState = createMockGymState();
    mockBroadcast = vi.fn();

    callbacks = {
      onSessionStart: vi.fn().mockResolvedValue(undefined),
      onSessionEnd: vi.fn().mockResolvedValue(undefined),
    };

    autoSession = new AutoSessionManager(
      mockGymState,
      mockBroadcast,
      callbacks
    );

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

  it("onSessionStart callback is triggered after auto-start", async () => {
    // Send 30 consecutive HR ticks to trigger auto-start
    for (let i = 0; i < 30; i++) {
      await autoSession.onHRData(gymId, activeDevices());
    }

    // Allow microtask (the callback is fire-and-forget via .catch)
    await vi.advanceTimersByTimeAsync(0);

    expect(callbacks.onSessionStart).toHaveBeenCalledWith(sessionId, gymId);
  });

  it("onSessionEnd callback is triggered after auto-end", async () => {
    // Auto-start first
    for (let i = 0; i < 30; i++) {
      await autoSession.onHRData(gymId, activeDevices());
    }
    await vi.advanceTimersByTimeAsync(0);

    // Now set active session in mock
    (mockGymState.getActiveSession as ReturnType<typeof vi.fn>).mockReturnValue(
      {
        id: sessionId,
        classType: "auto",
        startedAt: "2026-02-27T10:00:00.000Z",
      }
    );

    // Start auto-end checker and advance past timeout
    autoSession.start();
    await vi.advanceTimersByTimeAsync(130_000); // 120s timeout + 10s check interval

    expect(callbacks.onSessionEnd).toHaveBeenCalledWith(sessionId, gymId);
  });
});
