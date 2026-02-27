// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

// Mock @/lib/db
const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockUpdateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) }));
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  agents: { id: "id", gymId: "gym_id", agentSecret: "agent_secret", status: "status", lastHeartbeat: "last_heartbeat" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

import { verifyAgentAuth, verifyAgentWsAuth, isAuthError } from "../agent-auth";

// Test fixtures
const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_GYM_ID = "660e8400-e29b-41d4-a716-446655440001";
const PLAIN_SECRET = "my-super-secret-agent-key";
const HASHED_SECRET = bcrypt.hashSync(PLAIN_SECRET, 10);

function createMockRequest(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/agent/heartbeat", {
    method: "POST",
    headers,
  });
}

describe("verifyAgentAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return error when X-Agent-Id header is missing", async () => {
    const req = createMockRequest({ "X-Agent-Secret": PLAIN_SECRET });
    const result = await verifyAgentAuth(req);

    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.error).toBe("Missing agent credentials");
      expect(result.status).toBe(401);
    }
  });

  it("should return error when X-Agent-Secret header is missing", async () => {
    const req = createMockRequest({ "X-Agent-Id": VALID_UUID });
    const result = await verifyAgentAuth(req);

    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.error).toBe("Missing agent credentials");
      expect(result.status).toBe(401);
    }
  });

  it("should return error when agentId has invalid UUID format", async () => {
    const req = createMockRequest({
      "X-Agent-Id": "not-a-valid-uuid",
      "X-Agent-Secret": PLAIN_SECRET,
    });
    const result = await verifyAgentAuth(req);

    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.error).toBe("Invalid agent ID format");
      expect(result.status).toBe(401);
    }
  });

  it("should return error when agent is not found in DB", async () => {
    mockWhere.mockResolvedValueOnce([]);

    const req = createMockRequest({
      "X-Agent-Id": VALID_UUID,
      "X-Agent-Secret": PLAIN_SECRET,
    });
    const result = await verifyAgentAuth(req);

    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.error).toBe("Invalid agent credentials");
      expect(result.status).toBe(401);
    }
  });

  it("should return error when secret does not match", async () => {
    mockWhere.mockResolvedValueOnce([
      { id: VALID_UUID, gymId: VALID_GYM_ID, agentSecret: HASHED_SECRET },
    ]);

    const req = createMockRequest({
      "X-Agent-Id": VALID_UUID,
      "X-Agent-Secret": "wrong-secret",
    });
    const result = await verifyAgentAuth(req);

    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.error).toBe("Invalid agent credentials");
      expect(result.status).toBe(401);
    }
  });

  it("should return AgentContext and update status on valid credentials", async () => {
    mockWhere.mockResolvedValueOnce([
      { id: VALID_UUID, gymId: VALID_GYM_ID, agentSecret: HASHED_SECRET },
    ]);

    const req = createMockRequest({
      "X-Agent-Id": VALID_UUID,
      "X-Agent-Secret": PLAIN_SECRET,
    });
    const result = await verifyAgentAuth(req);

    expect(isAuthError(result)).toBe(false);
    expect(result).toEqual({ agentId: VALID_UUID, gymId: VALID_GYM_ID });

    // Should have called db.update to set status online and heartbeat
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "online",
        lastHeartbeat: expect.any(Date),
      })
    );
  });
});

describe("verifyAgentWsAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null for invalid UUID format", async () => {
    const result = await verifyAgentWsAuth("not-a-uuid", PLAIN_SECRET);
    expect(result).toBeNull();
  });

  it("should return null when agent is not found", async () => {
    mockWhere.mockResolvedValueOnce([]);

    const result = await verifyAgentWsAuth(VALID_UUID, PLAIN_SECRET);
    expect(result).toBeNull();
  });

  it("should return null when secret does not match", async () => {
    mockWhere.mockResolvedValueOnce([
      { id: VALID_UUID, gymId: VALID_GYM_ID, agentSecret: HASHED_SECRET },
    ]);

    const result = await verifyAgentWsAuth(VALID_UUID, "wrong-secret");
    expect(result).toBeNull();
  });

  it("should return AgentContext and update status on valid credentials", async () => {
    mockWhere.mockResolvedValueOnce([
      { id: VALID_UUID, gymId: VALID_GYM_ID, agentSecret: HASHED_SECRET },
    ]);

    const result = await verifyAgentWsAuth(VALID_UUID, PLAIN_SECRET);

    expect(result).toEqual({ agentId: VALID_UUID, gymId: VALID_GYM_ID });

    // Should have called db.update to set status online and heartbeat
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "online",
        lastHeartbeat: expect.any(Date),
      })
    );
  });
});

describe("isAuthError", () => {
  it("should return true for AuthError objects", () => {
    expect(isAuthError({ error: "test", status: 401 })).toBe(true);
    expect(isAuthError({ error: "test", status: 403 })).toBe(true);
  });

  it("should return false for AgentContext objects", () => {
    expect(isAuthError({ agentId: "x", gymId: "y" })).toBe(false);
  });
});
