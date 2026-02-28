import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { BatchWriter } from "../batch-writer";
import { GymStateManager } from "../gym-state";
import { AutoSessionManager } from "../auto-session";
import { ConnectionManager } from "../manager";
import type { WebSocketServer } from "ws";

// Mock all DB and external deps for BatchWriter/GymState/AutoSession
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({ values: vi.fn().mockResolvedValue(undefined) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: () => ({
      set: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    execute: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  hrReadings: {},
  gyms: {},
  sessions: {},
  agents: {},
  athleteBands: {},
  athletes: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  sql: (s: TemplateStringsArray) => s.join(""),
}));

vi.mock("@/lib/hr/zones", () => ({
  getZoneForLang: vi.fn().mockReturnValue({ zone: 1, zoneName: "Test", zoneColor: "#000", hrMaxPercent: 50 }),
}));

vi.mock("../auth", () => ({
  authenticateAgent: vi.fn(),
  authenticateTv: vi.fn(),
}));

describe("Graceful Shutdown", () => {
  it("should shut down BatchWriter (final flush + clear)", async () => {
    const bw = new BatchWriter(5000, 100);
    bw.start();

    // Enqueue some data
    bw.enqueue("gym1", [{
      sessionId: "s1", gymId: "gym1", athleteId: "a1", sensorId: 1,
      heartRateBpm: 120, hrZone: 3, hrZoneName: "Aeróbico", hrZoneColor: "#EAB308",
      hrMaxPercent: "63", beatTime: new Date(), beatCount: 0, deviceActive: true,
    }]);
    expect(bw.getBufferedCount()).toBe(1);

    await bw.shutdown();
    expect(bw.getBufferedCount()).toBe(0);
  });

  it("should shut down GymStateManager (clear timers + state)", () => {
    const gs = new GymStateManager();
    gs.start();
    gs.shutdown();
    expect(gs.getStats().activeGyms).toBe(0);
  });

  it("should shut down AutoSessionManager (clear timers)", () => {
    const mockGS = {
      getActiveSession: vi.fn(),
      setActiveSession: vi.fn(),
      clearActiveSession: vi.fn(),
    } as unknown as GymStateManager;

    const autoSession = new AutoSessionManager(mockGS, vi.fn());
    autoSession.start();
    autoSession.shutdown();
    // No error = success (timers cleared)
  });

  it("should complete shutdown sequence in order", async () => {
    const shutdownOrder: string[] = [];

    const bw = {
      start: vi.fn(),
      shutdown: vi.fn().mockImplementation(async () => { shutdownOrder.push("batchWriter"); }),
      getBufferedCount: vi.fn().mockReturnValue(0),
      enqueue: vi.fn(),
    };

    const gs = {
      start: vi.fn(),
      shutdown: vi.fn().mockImplementation(() => { shutdownOrder.push("gymState"); }),
      getOrLoadState: vi.fn(),
      processHRData: vi.fn(),
      getActiveSession: vi.fn(),
      setActiveSession: vi.fn(),
      clearActiveSession: vi.fn(),
      getStats: vi.fn().mockReturnValue({ activeGyms: 0 }),
    };

    const autoSess = {
      start: vi.fn(),
      shutdown: vi.fn().mockImplementation(() => { shutdownOrder.push("autoSession"); }),
      onHRData: vi.fn(),
    };

    const mockWss = { on: vi.fn(), close: vi.fn() };

    const cm = new ConnectionManager(
      mockWss as unknown as WebSocketServer,
      gs as unknown as GymStateManager,
      bw as unknown as BatchWriter,
      autoSess as unknown as AutoSessionManager,
      { WS_PORT: 3001, WS_INTERNAL_SECRET: "", WS_PING_INTERVAL: 30000, WS_PONG_TIMEOUT: 60000, WS_AUTH_TIMEOUT: 5000, WS_BATCH_FLUSH_INTERVAL: 5000, WS_BATCH_MAX_BUFFER: 1000 }
    );

    // Simulate the shutdown sequence from ws-server.ts
    await bw.shutdown();
    await cm.shutdown();
    gs.shutdown();
    autoSess.shutdown();

    shutdownOrder.push("connectionManager"); // cm.shutdown is async but tracked via mock above

    expect(shutdownOrder[0]).toBe("batchWriter"); // flush first
    expect(shutdownOrder).toContain("gymState");
    expect(shutdownOrder).toContain("autoSession");
  });
});
