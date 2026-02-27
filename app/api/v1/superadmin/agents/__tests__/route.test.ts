// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const { mockAuth, mockQueryResults } = vi.hoisted(() => {
  const mockQueryResults: unknown[][] = [];
  return {
    mockAuth: vi.fn(),
    mockQueryResults,
  };
});

function queueResults(...results: unknown[][]) {
  mockQueryResults.push(...results);
}

function createChain(): unknown {
  const chain: Record<string, unknown> = {};
  const resolve = () => {
    const result = mockQueryResults.shift() ?? [];
    return Promise.resolve(result);
  };
  for (const method of ["from", "where", "orderBy", "limit", "offset", "groupBy", "leftJoin", "innerJoin"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    resolve().then(onFulfilled, onRejected);
  return chain;
}

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => createChain()),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", isSuperadmin: "is_superadmin" },
  gyms: { id: "id", name: "name" },
  agents: {
    id: "id", gymId: "gym_id", name: "name", status: "status",
    hardwareModel: "hardware_model", serialNumber: "serial_number",
    lastHeartbeat: "last_heartbeat", ipAddress: "ip_address",
    softwareVersion: "software_version", createdAt: "created_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
    { join: (...args: unknown[]) => ({ join: args }) }
  ),
  count: (col?: unknown) => ({ count: col }),
  desc: (col: unknown) => ({ desc: col }),
}));

import { GET } from "../route";

// Test fixtures
const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";
const AGENT_ID = "770e8400-e29b-41d4-a716-446655440002";

function createRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost:3000/api/v1/superadmin/agents");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Request(url.toString(), { method: "GET" });
}

function setupSuperAdmin() {
  mockAuth.mockResolvedValue({ userId: "clerk_admin" });
  queueResults([
    { id: DB_USER_ID, clerkUserId: "clerk_admin", email: "admin@test.com", isSuperadmin: true },
  ]);
}

function setupNonAdmin() {
  mockAuth.mockResolvedValue({ userId: "clerk_user" });
  queueResults([
    { id: DB_USER_ID, clerkUserId: "clerk_user", email: "user@test.com", isSuperadmin: false },
  ]);
}

describe("GET /api/v1/superadmin/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("UNAUTHORIZED");
  });

  it("should return 403 when not superadmin", async () => {
    setupNonAdmin();
    const res = await GET(createRequest());
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("FORBIDDEN");
  });

  it("should return 200 with agents and pagination (default limit=50)", async () => {
    setupSuperAdmin();
    const now = new Date();
    const agentRow = {
      id: AGENT_ID, gymId: GYM_ID, name: "Agent 1",
      status: "online", hardwareModel: "RPi4", serialNumber: "SN001",
      lastHeartbeat: now, ipAddress: "192.168.1.100",
      softwareVersion: "1.0.0", createdAt: now,
      gymName: "Test Gym",
    };
    queueResults(
      [agentRow],   // agents list
      [{ total: 1 }], // count
    );

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(1);
    expect(data.pagination.limit).toBe(50);
    expect(data.pagination.total).toBe(1);
  });

  it("should detect offline agents (lastHeartbeat > 90s ago)", async () => {
    setupSuperAdmin();
    const oldHeartbeat = new Date(Date.now() - 120_000); // 2 minutes ago
    const agentRow = {
      id: AGENT_ID, gymId: GYM_ID, name: "Agent 1",
      status: "online", hardwareModel: "RPi4", serialNumber: "SN001",
      lastHeartbeat: oldHeartbeat.toISOString(), ipAddress: "192.168.1.100",
      softwareVersion: "1.0.0", createdAt: new Date().toISOString(),
      gymName: "Test Gym",
    };
    queueResults([agentRow], [{ total: 1 }]);

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data[0].effectiveStatus).toBe("offline");
  });

  it("should keep online status when heartbeat is recent", async () => {
    setupSuperAdmin();
    const recentHeartbeat = new Date(Date.now() - 30_000); // 30s ago
    const agentRow = {
      id: AGENT_ID, gymId: GYM_ID, name: "Agent 1",
      status: "online", hardwareModel: "RPi4", serialNumber: "SN001",
      lastHeartbeat: recentHeartbeat.toISOString(), ipAddress: "192.168.1.100",
      softwareVersion: "1.0.0", createdAt: new Date().toISOString(),
      gymName: "Test Gym",
    };
    queueResults([agentRow], [{ total: 1 }]);

    const res = await GET(createRequest());
    const data = await res.json();
    expect(data.data[0].effectiveStatus).toBe("online");
  });

  it("should return 422 for invalid query params", async () => {
    setupSuperAdmin();
    const res = await GET(createRequest({ status: "invalid" }));
    expect(res.status).toBe(422);
  });

  it("should filter by status", async () => {
    setupSuperAdmin();
    queueResults([], [{ total: 0 }]);
    const res = await GET(createRequest({ status: "offline" }));
    expect(res.status).toBe(200);
  });

  it("should filter by gymId", async () => {
    setupSuperAdmin();
    queueResults([], [{ total: 0 }]);
    const res = await GET(createRequest({ gymId: GYM_ID }));
    expect(res.status).toBe(200);
  });

  it("should reject invalid gymId", async () => {
    setupSuperAdmin();
    const res = await GET(createRequest({ gymId: "not-a-uuid" }));
    expect(res.status).toBe(422);
  });

  it("should accept custom pagination", async () => {
    setupSuperAdmin();
    queueResults([], [{ total: 0 }]);
    const res = await GET(createRequest({ page: "2", limit: "25" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pagination.page).toBe(2);
    expect(data.pagination.limit).toBe(25);
  });

  it("should handle agents with null lastHeartbeat", async () => {
    setupSuperAdmin();
    const agentRow = {
      id: AGENT_ID, gymId: GYM_ID, name: "New Agent",
      status: "offline", hardwareModel: null, serialNumber: null,
      lastHeartbeat: null, ipAddress: null,
      softwareVersion: null, createdAt: new Date().toISOString(),
      gymName: "Test Gym",
    };
    queueResults([agentRow], [{ total: 1 }]);

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data[0].effectiveStatus).toBe("offline");
  });
});
