import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Mock all external dependencies
const mockAuthenticateAgent = vi.hoisted(() => vi.fn());
const mockAuthenticateTv = vi.hoisted(() => vi.fn());
const mockBuildInitMessage = vi.hoisted(() => vi.fn());
const mockSetupTvPing = vi.hoisted(() => vi.fn());
const mockHandleAgentMessage = vi.hoisted(() => vi.fn());

vi.mock("../auth", () => ({
  authenticateAgent: mockAuthenticateAgent,
  authenticateTv: mockAuthenticateTv,
}));

vi.mock("../tv-handler", () => ({
  buildInitMessage: mockBuildInitMessage,
  setupTvPing: mockSetupTvPing,
}));

vi.mock("../agent-handler", () => ({
  handleAgentMessage: mockHandleAgentMessage,
}));

vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ConnectionManager } from "../manager";
import { WS_CLOSE_CODES } from "../types";
import type { GymStateManager } from "../gym-state";
import type { BatchWriter } from "../batch-writer";
import type { AutoSessionManager } from "../auto-session";
import type { WebSocket, WebSocketServer } from "ws";
import type { WsConfig } from "../types";

const gymId = "550e8400-e29b-41d4-a716-446655440000";
const agentId = "660e8400-e29b-41d4-a716-446655440000";

function createMockWs(): WebSocket & EventEmitter {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    close: vi.fn(),
    send: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
    readyState: 1,
  }) as unknown as WebSocket & EventEmitter;
}

function createMockWss(): WebSocketServer & EventEmitter {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    close: vi.fn(),
  }) as unknown as WebSocketServer & EventEmitter;
}

const defaultConfig: WsConfig = {
  WS_PORT: 3001,
  WS_INTERNAL_SECRET: "test-secret",
  WS_PING_INTERVAL: 30000,
  WS_PONG_TIMEOUT: 60000,
  WS_AUTH_TIMEOUT: 5000,
  WS_BATCH_FLUSH_INTERVAL: 5000,
  WS_BATCH_MAX_BUFFER: 1000,
};

function createMockGymState() {
  return {
    getOrLoadState: vi.fn(),
    processHRData: vi.fn(),
    getActiveSession: vi.fn(),
    setActiveSession: vi.fn(),
    clearActiveSession: vi.fn(),
    invalidateCache: vi.fn(),
    getStats: vi.fn().mockReturnValue({ activeGyms: 0 }),
    shutdown: vi.fn(),
  };
}

function createMockBatchWriter() {
  return {
    enqueue: vi.fn(),
    getBufferedCount: vi.fn().mockReturnValue(0),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAutoSession() {
  return {
    onHRData: vi.fn(),
    shutdown: vi.fn(),
  };
}

describe("ConnectionManager", () => {
  let wss: WebSocketServer & EventEmitter;
  let manager: ConnectionManager;
  let mockGymState: ReturnType<typeof createMockGymState>;
  let mockBatchWriter: ReturnType<typeof createMockBatchWriter>;
  let mockAutoSession: ReturnType<typeof createMockAutoSession>;

  beforeEach(() => {
    vi.clearAllMocks();
    wss = createMockWss();
    mockGymState = createMockGymState();
    mockBatchWriter = createMockBatchWriter();
    mockAutoSession = createMockAutoSession();

    manager = new ConnectionManager(
      wss as unknown as WebSocketServer,
      mockGymState as unknown as GymStateManager,
      mockBatchWriter as unknown as BatchWriter,
      mockAutoSession as unknown as AutoSessionManager,
      defaultConfig
    );
    manager.start();

    mockSetupTvPing.mockReturnValue(vi.fn());
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  describe("URL routing", () => {
    it("should close with 4000 for unknown path", () => {
      const ws = createMockWs();
      wss.emit("connection", ws, { url: "/ws/unknown" });

      expect(ws.close).toHaveBeenCalledWith(
        WS_CLOSE_CODES.UNKNOWN_ENDPOINT,
        "Unknown endpoint"
      );
    });

    it("should route /ws/agent to agent handler", async () => {
      mockAuthenticateAgent.mockResolvedValue({ agentId, gymId });
      const ws = createMockWs();
      wss.emit("connection", ws, { url: "/ws/agent" });

      // Allow async auth to complete
      await vi.waitFor(() => {
        expect(ws.send).toHaveBeenCalledWith(
          expect.stringContaining("auth-ok")
        );
      });
    });

    it("should route /ws/tv/{gymId} to TV handler", async () => {
      mockAuthenticateTv.mockResolvedValue({ gymId });
      mockBuildInitMessage.mockResolvedValue({
        type: "init",
        gym: { id: gymId },
        athletes: [],
        session: null,
      });

      const ws = createMockWs();
      wss.emit("connection", ws, {
        url: `/ws/tv/${gymId}?token=valid-token`,
      });

      await vi.waitFor(() => {
        expect(ws.send).toHaveBeenCalled();
      });
    });
  });

  describe("Agent connections", () => {
    it("should send auth-ok on successful agent auth", async () => {
      mockAuthenticateAgent.mockResolvedValue({ agentId, gymId });
      const ws = createMockWs();
      wss.emit("connection", ws, { url: "/ws/agent" });

      await vi.waitFor(() => {
        expect(ws.send).toHaveBeenCalledWith(
          JSON.stringify({ type: "auth-ok", gymId })
        );
      });
    });

    it("should replace old agent with 4003 (REPLACED)", async () => {
      mockAuthenticateAgent.mockResolvedValue({ agentId, gymId });

      const ws1 = createMockWs();
      wss.emit("connection", ws1, { url: "/ws/agent" });
      await vi.waitFor(() => expect(ws1.send).toHaveBeenCalled());

      const ws2 = createMockWs();
      wss.emit("connection", ws2, { url: "/ws/agent" });
      await vi.waitFor(() => expect(ws2.send).toHaveBeenCalled());

      expect(ws1.close).toHaveBeenCalledWith(
        WS_CLOSE_CODES.REPLACED,
        "Replaced by new connection"
      );
    });

    it("should track metrics for agent connections", async () => {
      mockAuthenticateAgent.mockResolvedValue({ agentId, gymId });
      const ws = createMockWs();
      wss.emit("connection", ws, { url: "/ws/agent" });

      await vi.waitFor(() => expect(ws.send).toHaveBeenCalled());

      const metrics = manager.getMetrics();
      expect(metrics.agentConnections).toBe(1);
    });
  });

  describe("TV connections", () => {
    it("should close with 4001 when TV auth fails", async () => {
      mockAuthenticateTv.mockResolvedValue(null);
      const ws = createMockWs();
      wss.emit("connection", ws, {
        url: `/ws/tv/${gymId}?token=bad-token`,
      });

      await vi.waitFor(() => {
        expect(ws.close).toHaveBeenCalledWith(
          WS_CLOSE_CODES.AUTH_FAILED,
          "Invalid TV credentials"
        );
      });
    });

    it("should send init message to TV on connect", async () => {
      mockAuthenticateTv.mockResolvedValue({ gymId });
      mockBuildInitMessage.mockResolvedValue({
        type: "init",
        gym: { id: gymId },
        athletes: [],
        session: null,
      });

      const ws = createMockWs();
      wss.emit("connection", ws, {
        url: `/ws/tv/${gymId}?token=valid-token`,
      });

      await vi.waitFor(() => {
        expect(ws.send).toHaveBeenCalledWith(
          expect.stringContaining('"type":"init"')
        );
      });
    });

    it("should close with 4001 when missing token", async () => {
      const ws = createMockWs();
      wss.emit("connection", ws, { url: `/ws/tv/${gymId}` });

      await vi.waitFor(() => {
        expect(ws.close).toHaveBeenCalledWith(
          WS_CLOSE_CODES.AUTH_FAILED,
          "Missing gymId or token"
        );
      });
    });
  });

  describe("broadcastToGym", () => {
    it("should send message to all TV clients for a gym", async () => {
      mockAuthenticateTv.mockResolvedValue({ gymId });
      mockBuildInitMessage.mockResolvedValue({
        type: "init",
        gym: { id: gymId },
        athletes: [],
        session: null,
      });

      const ws1 = createMockWs();
      const ws2 = createMockWs();

      wss.emit("connection", ws1, {
        url: `/ws/tv/${gymId}?token=valid-token`,
      });
      wss.emit("connection", ws2, {
        url: `/ws/tv/${gymId}?token=valid-token`,
      });

      await vi.waitFor(() => expect(ws2.send).toHaveBeenCalled());

      // Clear init sends
      ws1.send.mockClear();
      ws2.send.mockClear();

      manager.broadcastToGym(gymId, {
        type: "hr-update",
        athletes: [],
        timestamp: new Date().toISOString(),
      });

      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);
    });

    it("should skip non-OPEN connections", async () => {
      mockAuthenticateTv.mockResolvedValue({ gymId });
      mockBuildInitMessage.mockResolvedValue({
        type: "init",
        gym: { id: gymId },
        athletes: [],
        session: null,
      });

      const ws = createMockWs();
      wss.emit("connection", ws, {
        url: `/ws/tv/${gymId}?token=valid-token`,
      });

      await vi.waitFor(() => expect(ws.send).toHaveBeenCalled());
      ws.send.mockClear();

      // Change readyState to CLOSING (2)
      Object.defineProperty(ws, "readyState", { value: 2 });

      manager.broadcastToGym(gymId, {
        type: "hr-update",
        athletes: [],
        timestamp: new Date().toISOString(),
      });

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("shutdown", () => {
    it("should close all connections with GOING_AWAY", async () => {
      mockAuthenticateAgent.mockResolvedValue({ agentId, gymId });
      mockAuthenticateTv.mockResolvedValue({ gymId });
      mockBuildInitMessage.mockResolvedValue({
        type: "init",
        gym: { id: gymId },
        athletes: [],
        session: null,
      });

      const agentWs = createMockWs();
      const tvWs = createMockWs();

      wss.emit("connection", agentWs, { url: "/ws/agent" });
      wss.emit("connection", tvWs, {
        url: `/ws/tv/${gymId}?token=valid-token`,
      });

      await vi.waitFor(() => expect(agentWs.send).toHaveBeenCalled());
      await vi.waitFor(() => expect(tvWs.send).toHaveBeenCalled());

      await manager.shutdown();

      expect(agentWs.close).toHaveBeenCalledWith(
        WS_CLOSE_CODES.GOING_AWAY,
        "Server shutting down"
      );
      expect(tvWs.close).toHaveBeenCalledWith(
        WS_CLOSE_CODES.GOING_AWAY,
        "Server shutting down"
      );
    });
  });
});
