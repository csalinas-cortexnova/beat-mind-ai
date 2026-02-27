// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const {
  mockAuth,
  mockQueryResults,
  mockDbInsertReturning,
  mockDbUpdateSet,
  mockDbDeleteWhere,
} = vi.hoisted(() => {
  const mockQueryResults: unknown[][] = [];
  const mockDbInsertReturning = vi.fn();
  const mockDbUpdateWhere = vi.fn(() => Promise.resolve());
  const mockDbUpdateSet = vi.fn(() => ({ where: mockDbUpdateWhere }));
  const mockDbDeleteWhere = vi.fn(() => Promise.resolve());

  return {
    mockAuth: vi.fn(),
    mockQueryResults,
    mockDbInsertReturning,
    mockDbUpdateSet,
    mockDbUpdateWhere,
    mockDbDeleteWhere,
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
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockDbInsertReturning,
      })),
    })),
    update: vi.fn(() => ({ set: mockDbUpdateSet })),
    delete: vi.fn(() => ({ where: mockDbDeleteWhere })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", isSuperadmin: "is_superadmin" },
  gyms: { id: "id", clerkOrgId: "clerk_org_id" },
  athletes: {
    id: "id", gymId: "gym_id", isActive: "is_active",
  },
  athleteBands: {
    id: "id", athleteId: "athlete_id", gymId: "gym_id",
    sensorId: "sensor_id", bandLabel: "band_label",
    isActive: "is_active", createdAt: "created_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  ne: (col: unknown, val: unknown) => ({ ne: [col, val] }),
}));

import { POST, DELETE } from "../../bands/route";

// Test fixtures
const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";
const ATHLETE_ID = "770e8400-e29b-41d4-a716-446655440002";

function createPostRequest(body: unknown): Request {
  return new Request(`http://localhost:3000/api/v1/gym/athletes/${ATHLETE_ID}/bands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createDeleteRequest(): Request {
  return new Request(`http://localhost:3000/api/v1/gym/athletes/${ATHLETE_ID}/bands`, {
    method: "DELETE",
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

// =========================================================
// POST /api/v1/gym/athletes/[id]/bands
// =========================================================
describe("POST /api/v1/gym/athletes/[id]/bands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  const validBody = { sensorId: 12345 };

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await POST(createPostRequest(validBody), { params: validParams });
    expect(res.status).toBe(401);
  });

  it("should return 403 when no org context", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user", orgId: null });
    const res = await POST(createPostRequest(validBody), { params: validParams });
    expect(res.status).toBe(403);
  });

  it("should return 422 for invalid UUID param", async () => {
    setupGymAccess();
    const res = await POST(createPostRequest(validBody), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(422);
  });

  it("should return 422 for invalid body", async () => {
    setupGymAccess();
    const res = await POST(createPostRequest({ sensorId: -1 }), { params: validParams });
    expect(res.status).toBe(422);
  });

  it("should return 404 when athlete not found", async () => {
    setupGymAccess();
    // athlete lookup
    queueResults([]);
    const res = await POST(createPostRequest(validBody), { params: validParams });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("ATHLETE_NOT_FOUND");
  });

  it("should return 400 when athlete is inactive", async () => {
    setupGymAccess();
    // athlete lookup
    queueResults([{ id: ATHLETE_ID, gymId: GYM_ID, isActive: false }]);
    const res = await POST(createPostRequest(validBody), { params: validParams });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("ATHLETE_INACTIVE");
  });

  it("should return 409 when sensor already assigned to another athlete", async () => {
    setupGymAccess();
    // athlete lookup
    queueResults([{ id: ATHLETE_ID, gymId: GYM_ID, isActive: true }]);
    // sensor conflict check — active on a different athlete
    queueResults([{ id: "band-1", athleteId: "other-athlete" }]);

    const res = await POST(createPostRequest(validBody), { params: validParams });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("SENSOR_ALREADY_ASSIGNED");
  });

  it("should return 201 with new band assignment", async () => {
    setupGymAccess();
    // athlete lookup
    queueResults([{ id: ATHLETE_ID, gymId: GYM_ID, isActive: true }]);
    // sensor conflict check — no active conflict
    queueResults([]);
    // delete stale row (no-op)
    mockDbDeleteWhere.mockResolvedValueOnce(undefined);
    // deactivate previous band (update)
    mockDbUpdateSet.mockReturnValueOnce({ where: vi.fn(() => Promise.resolve()) });
    // insert new band
    const newBand = {
      id: "band-new", athleteId: ATHLETE_ID, gymId: GYM_ID,
      sensorId: 12345, bandLabel: null, isActive: true,
      createdAt: new Date().toISOString(),
    };
    mockDbInsertReturning.mockResolvedValue([newBand]);

    const res = await POST(createPostRequest(validBody), { params: validParams });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.sensorId).toBe(12345);
    expect(data.isActive).toBe(true);
  });

  it("should return 201 with band replacement (same athlete, new sensor)", async () => {
    setupGymAccess();
    // athlete lookup
    queueResults([{ id: ATHLETE_ID, gymId: GYM_ID, isActive: true }]);
    // sensor conflict check — no active conflict
    queueResults([]);
    // delete stale row
    mockDbDeleteWhere.mockResolvedValueOnce(undefined);
    // deactivate previous band
    mockDbUpdateSet.mockReturnValueOnce({ where: vi.fn(() => Promise.resolve()) });
    // insert new band
    const newBand = {
      id: "band-new", athleteId: ATHLETE_ID, gymId: GYM_ID,
      sensorId: 99999, bandLabel: "Band B", isActive: true,
      createdAt: new Date().toISOString(),
    };
    mockDbInsertReturning.mockResolvedValue([newBand]);

    const res = await POST(
      createPostRequest({ sensorId: 99999, bandLabel: "Band B" }),
      { params: validParams },
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.sensorId).toBe(99999);
    expect(data.bandLabel).toBe("Band B");
  });
});

// =========================================================
// DELETE /api/v1/gym/athletes/[id]/bands
// =========================================================
describe("DELETE /api/v1/gym/athletes/[id]/bands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResults.length = 0;
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await DELETE(createDeleteRequest(), { params: validParams });
    expect(res.status).toBe(401);
  });

  it("should return 422 for invalid UUID param", async () => {
    setupGymAccess();
    const res = await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(422);
  });

  it("should return 404 when athlete not found", async () => {
    setupGymAccess();
    // athlete lookup
    queueResults([]);
    const res = await DELETE(createDeleteRequest(), { params: validParams });
    expect(res.status).toBe(404);
  });

  it("should return 200 on successful band removal", async () => {
    setupGymAccess();
    // athlete lookup
    queueResults([{ id: ATHLETE_ID, gymId: GYM_ID }]);
    // deactivate bands
    mockDbUpdateSet.mockReturnValueOnce({ where: vi.fn(() => Promise.resolve()) });

    const res = await DELETE(createDeleteRequest(), { params: validParams });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBeDefined();
  });

  it("should return 200 idempotently (no active bands)", async () => {
    setupGymAccess();
    // athlete lookup
    queueResults([{ id: ATHLETE_ID, gymId: GYM_ID }]);
    // deactivate bands (no-op)
    mockDbUpdateSet.mockReturnValueOnce({ where: vi.fn(() => Promise.resolve()) });

    const res = await DELETE(createDeleteRequest(), { params: validParams });
    expect(res.status).toBe(200);
  });
});
