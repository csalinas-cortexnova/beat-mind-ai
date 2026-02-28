import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildInitMessage, setupTvPing } from "../tv-handler";
import type { GymStateManager } from "../gym-state";
import type { TvConnection } from "../types";
import type { WebSocket } from "ws";

const gymId = "550e8400-e29b-41d4-a716-446655440000";
const athleteId = "660e8400-e29b-41d4-a716-446655440000";
const sessionId = "770e8400-e29b-41d4-a716-446655440000";

function createMockGymState(
  hasSession = false
): GymStateManager {
  const sensorMap = new Map();
  sensorMap.set(101, { id: athleteId, name: "Carlos", maxHr: 185, age: 30 });

  return {
    getOrLoadState: vi.fn().mockResolvedValue({
      gymId,
      config: {
        name: "Test Gym",
        language: "pt-BR",
        timezone: "America/Sao_Paulo",
        logoUrl: "https://example.com/logo.png",
        primaryColor: "#FF0000",
        secondaryColor: "#00FF00",
        subscriptionStatus: "active",
      },
      sensorAthleteMap: sensorMap,
      activeSession: hasSession
        ? { id: sessionId, classType: "HIIT", startedAt: "2026-02-27T10:00:00Z" }
        : null,
      lastActivity: Date.now(),
      lastRefresh: Date.now(),
      deviceLastSeen: new Map(),
    }),
  } as unknown as GymStateManager;
}

function createMockWs() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    close: vi.fn(),
    send: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
    readyState: 1,
  }) as unknown as WebSocket & EventEmitter;
}

describe("buildInitMessage", () => {
  it("should return correct init message shape", async () => {
    const gymState = createMockGymState();
    const msg = await buildInitMessage(gymState, gymId);

    expect(msg.type).toBe("init");
    expect(msg.gym.id).toBe(gymId);
    expect(msg.gym.name).toBe("Test Gym");
    expect(msg.gym.primaryColor).toBe("#FF0000");
    expect(msg.athletes).toHaveLength(1);
    expect(msg.athletes[0].sensorId).toBe(101);
    expect(msg.athletes[0].athleteId).toBe(athleteId);
    expect(msg.athletes[0].athleteName).toBe("Carlos");
    expect(msg.session).toBeNull();
  });

  it("should include active session when present", async () => {
    const gymState = createMockGymState(true);
    const msg = await buildInitMessage(gymState, gymId);

    expect(msg.session).not.toBeNull();
    expect(msg.session!.id).toBe(sessionId);
    expect(msg.session!.classType).toBe("HIIT");
  });
});

describe("setupTvPing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should send pings at the specified interval", () => {
    const ws = createMockWs();
    const tv: TvConnection = { ws, gymId, connectedAt: Date.now(), lastPong: Date.now() };

    const cleanup = setupTvPing(tv, 5000, 30000);

    vi.advanceTimersByTime(5000);
    expect(ws.ping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(ws.ping).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it("should update lastPong on pong event", () => {
    const ws = createMockWs();
    const tv: TvConnection = { ws, gymId, connectedAt: Date.now(), lastPong: Date.now() - 10000 };

    const cleanup = setupTvPing(tv, 5000, 30000);

    ws.emit("pong");
    expect(tv.lastPong).toBeGreaterThan(Date.now() - 100);

    cleanup();
  });

  it("should terminate connection on pong timeout", () => {
    const ws = createMockWs();
    const startTime = Date.now();
    const tv: TvConnection = { ws, gymId, connectedAt: startTime, lastPong: startTime };

    const cleanup = setupTvPing(tv, 5000, 15000);

    // Advance past pong timeout (no pong responses)
    vi.advanceTimersByTime(20000);

    expect(ws.terminate).toHaveBeenCalled();
    cleanup();
  });
});
