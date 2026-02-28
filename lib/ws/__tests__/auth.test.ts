import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Mock dependencies
const mockVerifyAgentWsAuth = vi.hoisted(() => vi.fn());
const mockVerifyTvToken = vi.hoisted(() => vi.fn());
const mockDbSelect = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/agent-auth", () => ({
  verifyAgentWsAuth: mockVerifyAgentWsAuth,
}));

vi.mock("@/lib/auth/tv-auth", () => ({
  verifyTvToken: mockVerifyTvToken,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockDbSelect,
  },
}));

vi.mock("@/lib/db/schema", () => ({
  gyms: {
    id: "id",
    subscriptionStatus: "subscription_status",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ _type: "eq", a, b })),
}));

vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { authenticateAgent, authenticateTv } from "../auth";
import { WS_CLOSE_CODES } from "../types";
import type { WebSocket } from "ws";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";
const gymId = "660e8400-e29b-41d4-a716-446655440000";

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

describe("authenticateAgent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve with AgentContext on valid credentials", async () => {
    mockVerifyAgentWsAuth.mockResolvedValue({ agentId: validUuid, gymId });

    const ws = createMockWs();
    const promise = authenticateAgent(ws, 5000);

    ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "agent-auth",
          agentId: validUuid,
          secret: "valid-secret",
        })
      )
    );

    const ctx = await promise;
    expect(ctx).toEqual({ agentId: validUuid, gymId });
    expect(mockVerifyAgentWsAuth).toHaveBeenCalledWith(validUuid, "valid-secret");
  });

  it("should close with 4001 on invalid credentials", async () => {
    mockVerifyAgentWsAuth.mockResolvedValue(null);

    const ws = createMockWs();
    const promise = authenticateAgent(ws, 5000);

    ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "agent-auth",
          agentId: validUuid,
          secret: "wrong-secret",
        })
      )
    );

    await expect(promise).rejects.toThrow("Invalid credentials");
    expect(ws.close).toHaveBeenCalledWith(
      WS_CLOSE_CODES.AUTH_FAILED,
      "Invalid credentials"
    );
  });

  it("should close with 4002 on auth timeout", async () => {
    const ws = createMockWs();
    const promise = authenticateAgent(ws, 5000);

    vi.advanceTimersByTime(5001);

    await expect(promise).rejects.toThrow("Authentication timeout");
    expect(ws.close).toHaveBeenCalledWith(
      WS_CLOSE_CODES.AUTH_TIMEOUT,
      "Authentication timeout"
    );
  });

  it("should close with 4001 on invalid auth message schema", async () => {
    const ws = createMockWs();
    const promise = authenticateAgent(ws, 5000);

    ws.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "agent-auth" }))
    );

    await expect(promise).rejects.toThrow("Invalid auth message");
    expect(ws.close).toHaveBeenCalledWith(
      WS_CLOSE_CODES.AUTH_FAILED,
      "Invalid auth message"
    );
  });

  it("should close with 4001 on malformed JSON", async () => {
    const ws = createMockWs();
    const promise = authenticateAgent(ws, 5000);

    ws.emit("message", Buffer.from("not json"));

    await expect(promise).rejects.toThrow("Authentication failed");
    expect(ws.close).toHaveBeenCalledWith(
      WS_CLOSE_CODES.AUTH_FAILED,
      "Authentication failed"
    );
  });

  it("should reject if connection closes before auth", async () => {
    const ws = createMockWs();
    const promise = authenticateAgent(ws, 5000);

    ws.emit("close");

    await expect(promise).rejects.toThrow(
      "Connection closed before authentication"
    );
  });

  it("should handle string message data", async () => {
    mockVerifyAgentWsAuth.mockResolvedValue({ agentId: validUuid, gymId });

    const ws = createMockWs();
    const promise = authenticateAgent(ws, 5000);

    ws.emit(
      "message",
      JSON.stringify({
        type: "agent-auth",
        agentId: validUuid,
        secret: "valid-secret",
      })
    );

    const ctx = await promise;
    expect(ctx).toEqual({ agentId: validUuid, gymId });
  });
});

describe("authenticateTv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return TvContext for valid token with active subscription", async () => {
    mockVerifyTvToken.mockResolvedValue({ gymId });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ subscriptionStatus: "active" }]),
      }),
    });

    const result = await authenticateTv(gymId, "valid-token");
    expect(result).toEqual({ gymId });
    expect(mockVerifyTvToken).toHaveBeenCalledWith(gymId, "valid-token");
  });

  it("should return TvContext for trial subscription", async () => {
    mockVerifyTvToken.mockResolvedValue({ gymId });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ subscriptionStatus: "trial" }]),
      }),
    });

    const result = await authenticateTv(gymId, "valid-token");
    expect(result).toEqual({ gymId });
  });

  it("should return null for invalid TV token", async () => {
    mockVerifyTvToken.mockResolvedValue(null);

    const result = await authenticateTv(gymId, "invalid-token");
    expect(result).toBeNull();
  });

  it("should return null for suspended subscription", async () => {
    mockVerifyTvToken.mockResolvedValue({ gymId });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ subscriptionStatus: "suspended" }]),
      }),
    });

    const result = await authenticateTv(gymId, "valid-token");
    expect(result).toBeNull();
  });

  it("should return null for cancelled subscription", async () => {
    mockVerifyTvToken.mockResolvedValue({ gymId });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ subscriptionStatus: "cancelled" }]),
      }),
    });

    const result = await authenticateTv(gymId, "valid-token");
    expect(result).toBeNull();
  });

  it("should return null when gym not found in DB", async () => {
    mockVerifyTvToken.mockResolvedValue({ gymId });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await authenticateTv(gymId, "valid-token");
    expect(result).toBeNull();
  });
});
