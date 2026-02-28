import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: () => ({ where: mockDbUpdate }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  agents: { id: "id", lastHeartbeat: "last_heartbeat" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ _type: "eq", a, b })),
}));

vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { handleAgentMessage, _clearRateLimits } from "../agent-handler";
import type { AgentHandlerDeps } from "../agent-handler";

const agentId = "550e8400-e29b-41d4-a716-446655440000";
const gymId = "660e8400-e29b-41d4-a716-446655440000";

function createMockDeps(): AgentHandlerDeps {
  return {
    gymState: {
      getOrLoadState: vi.fn().mockResolvedValue({
        gymId,
        config: { language: "pt-BR" },
        sensorAthleteMap: new Map(),
        activeSession: null,
        lastActivity: Date.now(),
        lastRefresh: Date.now(),
        deviceLastSeen: new Map(),
      }),
      processHRData: vi.fn().mockReturnValue({ enriched: [], readings: [] }),
    } as unknown as AgentHandlerDeps["gymState"],
    batchWriter: {
      enqueue: vi.fn(),
    } as unknown as AgentHandlerDeps["batchWriter"],
    autoSession: {
      onHRData: vi.fn().mockResolvedValue(undefined),
    } as unknown as AgentHandlerDeps["autoSession"],
    broadcastToGym: vi.fn(),
  };
}

describe("handleAgentMessage", () => {
  let deps: AgentHandlerDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    _clearRateLimits();
    deps = createMockDeps();
    mockDbUpdate.mockResolvedValue(undefined);
  });

  it("should process valid hr-data message", async () => {
    const msg = JSON.stringify({
      type: "hr-data",
      devices: { "101": { bpm: 120, deviceActive: true } },
      timestamp: new Date().toISOString(),
    });

    await handleAgentMessage(Buffer.from(msg), agentId, gymId, deps);

    expect(deps.gymState.getOrLoadState).toHaveBeenCalledWith(gymId);
    expect(deps.gymState.processHRData).toHaveBeenCalled();
    expect(deps.broadcastToGym).toHaveBeenCalledWith(
      gymId,
      expect.objectContaining({ type: "hr-update" })
    );
    expect(deps.autoSession.onHRData).toHaveBeenCalled();
  });

  it("should handle heartbeat and update DB", async () => {
    const msg = JSON.stringify({ type: "heartbeat" });
    await handleAgentMessage(Buffer.from(msg), agentId, gymId, deps);
    expect(mockDbUpdate).toHaveBeenCalled();
  });

  it("should ignore malformed JSON", async () => {
    await handleAgentMessage(Buffer.from("not json"), agentId, gymId, deps);
    expect(deps.gymState.getOrLoadState).not.toHaveBeenCalled();
  });

  it("should ignore unknown message type", async () => {
    const msg = JSON.stringify({ type: "unknown-type" });
    await handleAgentMessage(Buffer.from(msg), agentId, gymId, deps);
    expect(deps.gymState.getOrLoadState).not.toHaveBeenCalled();
  });

  it("should ignore hr-data with missing required fields", async () => {
    const msg = JSON.stringify({ type: "hr-data" });
    await handleAgentMessage(Buffer.from(msg), agentId, gymId, deps);
    expect(deps.gymState.processHRData).not.toHaveBeenCalled();
  });

  it("should rate limit excess messages (>2/s per agent)", async () => {
    const msg = JSON.stringify({ type: "heartbeat" });

    // Send 3 messages rapidly — 3rd should be dropped
    await handleAgentMessage(Buffer.from(msg), agentId, gymId, deps);
    await handleAgentMessage(Buffer.from(msg), agentId, gymId, deps);
    await handleAgentMessage(Buffer.from(msg), agentId, gymId, deps);

    // 2 allowed + 1 dropped
    expect(mockDbUpdate).toHaveBeenCalledTimes(2);
  });

  it("should handle string message data", async () => {
    const msg = JSON.stringify({ type: "heartbeat" });
    await handleAgentMessage(msg, agentId, gymId, deps);
    expect(mockDbUpdate).toHaveBeenCalled();
  });

  it("should enqueue readings when available", async () => {
    const readings = [{ sessionId: "s1", gymId, athleteId: "a1" }];
    (deps.gymState.processHRData as ReturnType<typeof vi.fn>).mockReturnValue({
      enriched: [],
      readings,
    });

    const msg = JSON.stringify({
      type: "hr-data",
      devices: { "101": { bpm: 120, deviceActive: true } },
      timestamp: new Date().toISOString(),
    });

    await handleAgentMessage(Buffer.from(msg), agentId, gymId, deps);
    expect(deps.batchWriter.enqueue).toHaveBeenCalledWith(gymId, readings);
  });
});
