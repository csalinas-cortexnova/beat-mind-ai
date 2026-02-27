// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const {
  mockAuth,
  mockQueryResults,
  mockClerkClient,
} = vi.hoisted(() => {
  const mockQueryResults: unknown[][] = [];

  return {
    mockAuth: vi.fn(),
    mockQueryResults,
    mockClerkClient: {
      organizations: {
        createOrganizationInvitation: vi.fn(),
      },
    },
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
  clerkClient: vi.fn(() => Promise.resolve(mockClerkClient)),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => createChain()),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", name: "name", isSuperadmin: "is_superadmin" },
  gyms: { id: "id", clerkOrgId: "clerk_org_id" },
  gymMemberships: {
    id: "id", userId: "user_id", gymId: "gym_id", role: "role", isActive: "is_active",
    createdAt: "created_at", updatedAt: "updated_at",
  },
  athletes: { id: "id", userId: "user_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
    { join: (...args: unknown[]) => ({ join: args }) }
  ),
}));

import { GET, POST } from "../route";

const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";

function createGetRequest(): Request {
  return new Request("http://localhost:3000/api/v1/gym/trainers", { method: "GET" });
}

function createPostRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/v1/gym/trainers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupOwnerAccess() {
  mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: "org_123", orgRole: "org:admin" });
  // findGymByOrg
  queueResults([{ id: GYM_ID }]);
  // findDbUser
  queueResults([
    { id: DB_USER_ID, clerkUserId: "clerk_user", email: "owner@test.com", isSuperadmin: false },
  ]);
}

// =========================================================
// GET /api/v1/gym/trainers
// =========================================================
describe("GET /api/v1/gym/trainers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await GET(createGetRequest());
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("UNAUTHORIZED");
  });

  it("should return 403 for trainer role", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user",
      orgId: "org_123",
      orgRole: "org:trainer",
    });
    const res = await GET(createGetRequest());
    expect(res.status).toBe(403);
  });

  it("should return 200 with empty trainers list", async () => {
    setupOwnerAccess();
    // trainers query
    queueResults([]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(0);
  });

  it("should return 200 with trainers list", async () => {
    setupOwnerAccess();
    const trainer = {
      membershipId: "mem-1",
      userId: "user-1",
      email: "trainer@test.com",
      name: "John Trainer",
      role: "trainer",
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    queueResults([trainer]);

    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(1);
    expect(data.data[0].email).toBe("trainer@test.com");
    expect(data.data[0].name).toBe("John Trainer");
  });
});

// =========================================================
// POST /api/v1/gym/trainers
// =========================================================
describe("POST /api/v1/gym/trainers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  const validBody = {
    email: "newtrainer@test.com",
    name: "New Trainer",
  };

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await POST(createPostRequest(validBody));
    expect(res.status).toBe(401);
  });

  it("should return 403 for trainer role", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user",
      orgId: "org_123",
      orgRole: "org:trainer",
    });
    const res = await POST(createPostRequest(validBody));
    expect(res.status).toBe(403);
  });

  it("should return 422 for invalid body", async () => {
    setupOwnerAccess();
    const res = await POST(createPostRequest({ email: "not-an-email" }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  it("should return 422 for non-JSON body", async () => {
    setupOwnerAccess();
    const req = new Request("http://localhost:3000/api/v1/gym/trainers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("should return 409 when email is already a member", async () => {
    setupOwnerAccess();
    // existing member check
    queueResults([{ id: "existing-membership" }]);

    const res = await POST(createPostRequest(validBody));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("ALREADY_MEMBER");
  });

  it("should return 201 when invitation is successful", async () => {
    setupOwnerAccess();
    // existing member check
    queueResults([]);

    mockClerkClient.organizations.createOrganizationInvitation.mockResolvedValue({
      id: "inv_123",
      emailAddress: "newtrainer@test.com",
    });

    const res = await POST(createPostRequest(validBody));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.email).toBe("newtrainer@test.com");
    expect(data.status).toBe("invited");
    expect(mockClerkClient.organizations.createOrganizationInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_123",
        emailAddress: "newtrainer@test.com",
        role: "org:trainer",
      })
    );
  });

  it("should return 502 when Clerk invitation fails", async () => {
    setupOwnerAccess();
    // existing member check
    queueResults([]);

    mockClerkClient.organizations.createOrganizationInvitation.mockRejectedValue(
      new Error("Clerk API error")
    );

    const res = await POST(createPostRequest(validBody));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.code).toBe("CLERK_ERROR");
  });
});
