// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

const mockUpdateWhere = vi.fn().mockResolvedValue([]);
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockDbUpdate = vi.fn(() => ({ set: mockUpdateSet }));

vi.mock("@/lib/db", () => ({
  db: {
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  agents: {
    id: "id",
    gymId: "gym_id",
    status: "status",
    softwareVersion: "software_version",
    ipAddress: "ip_address",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

const mockVerifyAgentAuth = vi.fn();
vi.mock("@/lib/auth/agent-auth", () => ({
  verifyAgentAuth: (...args: unknown[]) => mockVerifyAgentAuth(...args),
  isAuthError: (result: Record<string, unknown>) =>
    "error" in result && "status" in result,
}));

import { POST } from "../../agent/status/route";

// Test fixtures
const AGENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";

function createRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/agent/status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Id": AGENT_ID,
      "X-Agent-Secret": "test-secret",
    },
    body: JSON.stringify(body),
  });
}

function validBody(overrides = {}) {
  return {
    agentId: AGENT_ID,
    gymId: GYM_ID,
    status: "online",
    softwareVersion: "1.2.3",
    uptime: 3600,
    connectedSensors: 5,
    ipAddress: "192.168.1.100",
    ...overrides,
  };
}

describe("POST /api/agent/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Auth ---
  it("should return 401 when auth fails", async () => {
    mockVerifyAgentAuth.mockResolvedValue({
      error: "Missing agent credentials",
      status: 401,
    });
    const req = createRequest(validBody());
    const res = await POST(req);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("UNAUTHORIZED");
  });

  // --- Validation ---
  it("should return 422 for invalid body", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });
    const req = createRequest({ invalid: true });
    const res = await POST(req);

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  it("should return 422 for invalid semver", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });
    const req = createRequest(validBody({ softwareVersion: "not-semver" }));
    const res = await POST(req);

    expect(res.status).toBe(422);
  });

  it("should return 422 for invalid IP address", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });
    const req = createRequest(validBody({ ipAddress: "not-an-ip" }));
    const res = await POST(req);

    expect(res.status).toBe(422);
  });

  // --- Gym mismatch ---
  it("should return 422 for gym mismatch", async () => {
    mockVerifyAgentAuth.mockResolvedValue({
      agentId: AGENT_ID,
      gymId: "different-gym-id",
    });
    const req = createRequest(validBody());
    const res = await POST(req);

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("GYM_MISMATCH");
  });

  // --- Happy path ---
  it("should return 200 for valid status report", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });
    const req = createRequest(validBody());
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("should update agent record with software version and IP", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });
    const req = createRequest(validBody());
    await POST(req);

    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        softwareVersion: "1.2.3",
        ipAddress: "192.168.1.100",
      })
    );
  });

  // --- Status values ---
  it("should accept 'online' status", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });
    const req = createRequest(validBody({ status: "online" }));
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("should accept 'degraded' status", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });
    const req = createRequest(validBody({ status: "degraded" }));
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("should accept 'error' status", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });
    const req = createRequest(validBody({ status: "error" }));
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  // --- JSON parse error ---
  it("should return 422 for non-JSON body", async () => {
    mockVerifyAgentAuth.mockResolvedValue({ agentId: AGENT_ID, gymId: GYM_ID });
    const req = new Request("http://localhost:3000/api/agent/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Id": AGENT_ID,
        "X-Agent-Secret": "test-secret",
      },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });
});
