// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const {
  mockAuth,
  mockQueryResults,
  mockDbUpdateSet,
  mockDbUpdateWhere,
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
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => createChain()),
    update: vi.fn(() => ({ set: mockDbUpdateSet })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", isSuperadmin: "is_superadmin" },
  gyms: { id: "id", clerkOrgId: "clerk_org_id" },
  athletes: {
    id: "id", gymId: "gym_id", name: "name", email: "email",
    isActive: "is_active", updatedAt: "updated_at",
  },
  athleteBands: {
    id: "id", athleteId: "athlete_id", gymId: "gym_id",
    isActive: "is_active",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
}));

import { PATCH } from "../../[id]/route";

// Test fixtures
const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";
const ATHLETE_ID = "770e8400-e29b-41d4-a716-446655440002";

function createPatchRequest(body: unknown): Request {
  return new Request(`http://localhost:3000/api/v1/gym/athletes/${ATHLETE_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validParams = Promise.resolve({ id: ATHLETE_ID });

function setupGymAccess() {
  mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: "org_123", orgRole: "org:admin" });
  // findGymByOrg
  queueResults([{ id: GYM_ID }]);
  // findDbUser
  queueResults([
    { id: DB_USER_ID, clerkUserId: "clerk_user", email: "owner@test.com", isSuperadmin: false },
  ]);
}

describe("PATCH /api/v1/gym/athletes/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await PATCH(createPatchRequest({ name: "New" }), { params: validParams });
    expect(res.status).toBe(401);
  });

  it("should return 403 when no org context", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: null });
    const res = await PATCH(createPatchRequest({ name: "New" }), { params: validParams });
    expect(res.status).toBe(403);
  });

  it("should return 422 for invalid UUID param", async () => {
    setupGymAccess();
    const res = await PATCH(createPatchRequest({ name: "New" }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(422);
  });

  it("should return 422 for invalid body", async () => {
    setupGymAccess();
    const res = await PATCH(createPatchRequest({ maxHr: 50 }), { params: validParams });
    expect(res.status).toBe(422);
  });

  it("should return 422 for empty body (no fields)", async () => {
    setupGymAccess();
    const res = await PATCH(createPatchRequest({}), { params: validParams });
    expect(res.status).toBe(422);
  });

  it("should return 422 for non-JSON body", async () => {
    setupGymAccess();
    const req = new Request(`http://localhost:3000/api/v1/gym/athletes/${ATHLETE_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await PATCH(req, { params: validParams });
    expect(res.status).toBe(422);
  });

  it("should return 404 when athlete not found in gym", async () => {
    setupGymAccess();
    // athlete lookup
    queueResults([]);
    const res = await PATCH(createPatchRequest({ name: "New" }), { params: validParams });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("ATHLETE_NOT_FOUND");
  });

  it("should return 409 when email already exists in gym", async () => {
    setupGymAccess();
    // athlete lookup
    queueResults([{ id: ATHLETE_ID, gymId: GYM_ID, email: "old@test.com" }]);
    // email uniqueness check
    queueResults([{ id: "other-athlete" }]);

    const res = await PATCH(
      createPatchRequest({ email: "taken@test.com" }),
      { params: validParams },
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("EMAIL_ALREADY_EXISTS");
  });

  it("should return 200 with updated athlete on success", async () => {
    setupGymAccess();
    // athlete lookup
    queueResults([{ id: ATHLETE_ID, gymId: GYM_ID, email: "old@test.com" }]);
    // update returns
    mockDbUpdateWhere.mockReturnValueOnce({
      returning: vi.fn().mockResolvedValue([{
        id: ATHLETE_ID, gymId: GYM_ID, name: "Updated Name", isActive: true,
      }]),
    });

    const res = await PATCH(createPatchRequest({ name: "Updated Name" }), { params: validParams });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Name");
  });

  it("should deactivate bands when setting isActive=false", async () => {
    setupGymAccess();
    // athlete lookup
    queueResults([{ id: ATHLETE_ID, gymId: GYM_ID, email: null }]);
    // band deactivation update — second db.update call
    const mockBandUpdateWhere = vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) }));
    const mockBandUpdateSet = vi.fn(() => ({ where: mockBandUpdateWhere }));
    // First update call: athlete, Second: bands
    mockDbUpdateSet
      .mockImplementationOnce(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{
            id: ATHLETE_ID, gymId: GYM_ID, name: "Test", isActive: false,
          }]),
        })),
      }))
      .mockImplementationOnce(mockBandUpdateSet);

    const res = await PATCH(
      createPatchRequest({ isActive: false }),
      { params: validParams },
    );
    expect(res.status).toBe(200);
    expect(mockBandUpdateSet).toHaveBeenCalled();
  });
});
