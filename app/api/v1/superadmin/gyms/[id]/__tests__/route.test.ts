// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const {
  mockAuth,
  mockQueryResults,
  mockDbUpdateWhere,
  mockDbUpdateSet,
  mockClerkClient,
} = vi.hoisted(() => {
  const mockQueryResults: unknown[][] = [];
  const mockDbUpdateReturning = vi.fn();
  const mockDbUpdateWhere = vi.fn(() => ({ returning: mockDbUpdateReturning }));
  const mockDbUpdateSet = vi.fn(() => ({ where: mockDbUpdateWhere }));

  return {
    mockAuth: vi.fn(),
    mockQueryResults,
    mockDbUpdateSet,
    mockDbUpdateWhere,
    mockDbUpdateReturning,
    mockClerkClient: vi.fn(),
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
  for (const method of ["from", "where", "orderBy", "limit", "offset", "groupBy"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    resolve().then(onFulfilled, onRejected);
  return chain;
}

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  clerkClient: mockClerkClient,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => createChain()),
    update: vi.fn(() => ({ set: mockDbUpdateSet })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", isSuperadmin: "is_superadmin" },
  gyms: {
    id: "id", name: "name", slug: "slug", address: "address", clerkOrgId: "clerk_org_id",
    subscriptionStatus: "subscription_status", subscriptionPlan: "subscription_plan",
    maxAthletes: "max_athletes", timezone: "timezone", language: "language",
    updatedAt: "updated_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
}));

import { PATCH } from "../../[id]/route";

// Test fixtures
const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";

function createPatchRequest(body: unknown): Request {
  return new Request(`http://localhost:3000/api/v1/superadmin/gyms/${GYM_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validParams = Promise.resolve({ id: GYM_ID });

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

describe("PATCH /api/v1/superadmin/gyms/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await PATCH(createPatchRequest({ name: "New Name" }), { params: validParams });
    expect(res.status).toBe(401);
  });

  it("should return 403 when not superadmin", async () => {
    setupNonAdmin();
    const res = await PATCH(createPatchRequest({ name: "New Name" }), { params: validParams });
    expect(res.status).toBe(403);
  });

  it("should return 422 for invalid UUID param", async () => {
    setupSuperAdmin();
    const res = await PATCH(createPatchRequest({ name: "New Name" }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(422);
  });

  it("should return 422 for invalid body", async () => {
    setupSuperAdmin();
    const res = await PATCH(createPatchRequest({ maxAthletes: -1 }), { params: validParams });
    expect(res.status).toBe(422);
  });

  it("should return 422 for empty body (no fields)", async () => {
    setupSuperAdmin();
    const res = await PATCH(createPatchRequest({}), { params: validParams });
    expect(res.status).toBe(422);
  });

  it("should return 422 for non-JSON body", async () => {
    setupSuperAdmin();
    const req = new Request(`http://localhost:3000/api/v1/superadmin/gyms/${GYM_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await PATCH(req, { params: validParams });
    expect(res.status).toBe(422);
  });

  it("should return 404 when gym not found", async () => {
    setupSuperAdmin();
    // Gym lookup returns empty
    queueResults([]);
    const res = await PATCH(createPatchRequest({ name: "New Name" }), { params: validParams });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("GYM_NOT_FOUND");
  });

  it("should return 200 with updated gym on success", async () => {
    setupSuperAdmin();
    // Gym lookup
    queueResults([{ id: GYM_ID, clerkOrgId: "org_123", subscriptionStatus: "active" }]);
    // Update returns updated gym
    mockDbUpdateWhere.mockReturnValueOnce({
      returning: vi.fn().mockResolvedValue([{
        id: GYM_ID, name: "New Name", subscriptionStatus: "active",
      }]),
    });

    const res = await PATCH(createPatchRequest({ name: "New Name" }), { params: validParams });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(GYM_ID);
  });

  it("should sync Clerk metadata when suspending", async () => {
    setupSuperAdmin();
    // Gym lookup
    queueResults([{ id: GYM_ID, clerkOrgId: "org_123", subscriptionStatus: "active" }]);
    // Mock Clerk
    const mockUpdateMetadata = vi.fn().mockResolvedValue({});
    mockClerkClient.mockResolvedValue({
      organizations: { updateOrganizationMetadata: mockUpdateMetadata },
    });
    // Update returns updated gym
    mockDbUpdateWhere.mockReturnValueOnce({
      returning: vi.fn().mockResolvedValue([{
        id: GYM_ID, name: "Test", subscriptionStatus: "suspended",
      }]),
    });

    const res = await PATCH(
      createPatchRequest({ subscriptionStatus: "suspended" }),
      { params: validParams },
    );
    expect(res.status).toBe(200);
    expect(mockUpdateMetadata).toHaveBeenCalledWith("org_123", {
      publicMetadata: { suspended: true },
    });
  });

  it("should sync Clerk metadata when reactivating", async () => {
    setupSuperAdmin();
    // Gym was suspended
    queueResults([{ id: GYM_ID, clerkOrgId: "org_123", subscriptionStatus: "suspended" }]);
    const mockUpdateMetadata = vi.fn().mockResolvedValue({});
    mockClerkClient.mockResolvedValue({
      organizations: { updateOrganizationMetadata: mockUpdateMetadata },
    });
    mockDbUpdateWhere.mockReturnValueOnce({
      returning: vi.fn().mockResolvedValue([{
        id: GYM_ID, name: "Test", subscriptionStatus: "active",
      }]),
    });

    const res = await PATCH(
      createPatchRequest({ subscriptionStatus: "active" }),
      { params: validParams },
    );
    expect(res.status).toBe(200);
    expect(mockUpdateMetadata).toHaveBeenCalledWith("org_123", {
      publicMetadata: { suspended: false },
    });
  });
});
