import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const mockDbExecute = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: { execute: mockDbExecute },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray) => strings.join(""),
}));

vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createHttpHandler, type HttpHandlerDeps } from "../http-handler";
import type { IncomingMessage, ServerResponse } from "http";

const gymId = "550e8400-e29b-41d4-a716-446655440000";
const sessionId = "660e8400-e29b-41d4-a716-446655440000";

function createMockReq(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: string
): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = headers;

  // Simulate body
  if (body !== undefined) {
    process.nextTick(() => {
      req.emit("data", Buffer.from(body));
      req.emit("end");
    });
  } else {
    process.nextTick(() => {
      req.emit("end");
    });
  }

  return req;
}

function createMockRes(): ServerResponse & { _status: number; _body: string } {
  const res = {
    _status: 0,
    _body: "",
    _headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string>) {
      this._status = status;
      if (headers) Object.assign(this._headers, headers);
      return this;
    },
    end(body?: string) {
      if (body) this._body = body;
    },
  } as unknown as ServerResponse & { _status: number; _body: string };
  return res;
}

function createDeps(overrides?: Partial<HttpHandlerDeps>): HttpHandlerDeps {
  return {
    manager: {
      getMetrics: vi.fn().mockReturnValue({
        uptime: 100,
        agentConnections: 2,
        tvConnections: 5,
        activeGyms: 2,
        batchWriterBuffered: 42,
      }),
      broadcastToGym: vi.fn(),
      shutdown: vi.fn(),
    } as unknown as HttpHandlerDeps["manager"],
    gymState: {
      setActiveSession: vi.fn(),
      clearActiveSession: vi.fn(),
    } as unknown as HttpHandlerDeps["gymState"],
    batchWriter: {
      getBufferedCount: vi.fn().mockReturnValue(42),
    } as unknown as HttpHandlerDeps["batchWriter"],
    internalSecret: "test-secret",
    startTime: Date.now() - 100_000,
    ...overrides,
  };
}

describe("HTTP Handler", () => {
  let deps: HttpHandlerDeps;
  let handler: ReturnType<typeof createHttpHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue(undefined);
    deps = createDeps();
    handler = createHttpHandler(deps);
  });

  describe("GET /health", () => {
    it("should return 200 with correct shape", async () => {
      const req = createMockReq("GET", "/health");
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.status).toBe("ok");
      expect(body.connections).toHaveProperty("agents");
      expect(body.connections).toHaveProperty("tvs");
      expect(body.activeGyms).toBe(2);
      expect(body.batchWriter).toHaveProperty("buffered");
      expect(body).toHaveProperty("dbLatency");
      expect(body).toHaveProperty("uptime");
    });

    it("should include connection counts", async () => {
      const req = createMockReq("GET", "/health");
      const res = createMockRes();

      await handler(req, res);

      const body = JSON.parse(res._body);
      expect(body.connections.agents).toBe(2);
      expect(body.connections.tvs).toBe(5);
    });

    it("should handle DB latency failure gracefully", async () => {
      mockDbExecute.mockRejectedValue(new Error("DB down"));
      const req = createMockReq("GET", "/health");
      const res = createMockRes();

      await handler(req, res);

      const body = JSON.parse(res._body);
      expect(body.status).toBe("ok");
      expect(body.dbLatency).toBe(-1);
    });
  });

  describe("POST /internal/broadcast", () => {
    it("should broadcast valid coach message", async () => {
      const body = JSON.stringify({
        gymId,
        type: "coach-message",
        message: "Keep pushing!",
      });
      const req = createMockReq("POST", "/internal/broadcast", {
        "x-internal-secret": "test-secret",
      }, body);
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(deps.manager.broadcastToGym).toHaveBeenCalledWith(
        gymId,
        expect.objectContaining({ type: "coach-message", message: "Keep pushing!" })
      );
    });

    it("should return 403 for invalid secret", async () => {
      const body = JSON.stringify({
        gymId,
        type: "coach-message",
        message: "Test",
      });
      const req = createMockReq("POST", "/internal/broadcast", {
        "x-internal-secret": "wrong-secret",
      }, body);
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(403);
    });

    it("should return 400 for invalid payload", async () => {
      const body = JSON.stringify({ invalid: true });
      const req = createMockReq("POST", "/internal/broadcast", {
        "x-internal-secret": "test-secret",
      }, body);
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(400);
    });
  });

  describe("POST /internal/session-event", () => {
    it("should process session start event", async () => {
      const body = JSON.stringify({
        gymId,
        event: "start",
        sessionId,
        classType: "HIIT",
      });
      const req = createMockReq("POST", "/internal/session-event", {
        "x-internal-secret": "test-secret",
      }, body);
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(deps.gymState.setActiveSession).toHaveBeenCalledWith(
        gymId,
        expect.objectContaining({ id: sessionId, classType: "HIIT" })
      );
      expect(deps.manager.broadcastToGym).toHaveBeenCalledWith(
        gymId,
        expect.objectContaining({ type: "session-start", sessionId })
      );
    });

    it("should process session end event", async () => {
      const body = JSON.stringify({
        gymId,
        event: "end",
        sessionId,
      });
      const req = createMockReq("POST", "/internal/session-event", {
        "x-internal-secret": "test-secret",
      }, body);
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(200);
      expect(deps.gymState.clearActiveSession).toHaveBeenCalledWith(gymId);
      expect(deps.manager.broadcastToGym).toHaveBeenCalledWith(
        gymId,
        expect.objectContaining({ type: "session-end", sessionId })
      );
    });

    it("should return 403 for invalid secret", async () => {
      const body = JSON.stringify({ gymId, event: "start", sessionId });
      const req = createMockReq("POST", "/internal/session-event", {
        "x-internal-secret": "wrong",
      }, body);
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(403);
    });
  });

  describe("Unknown routes", () => {
    it("should return 404 for unknown paths", async () => {
      const req = createMockReq("GET", "/unknown");
      const res = createMockRes();

      await handler(req, res);

      expect(res._status).toBe(404);
    });
  });
});
