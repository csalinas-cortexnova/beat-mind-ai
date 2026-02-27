// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const { mockAuth, mockRedirect, mockDbSelect, mockDbSelectWhere } =
  vi.hoisted(() => {
    const mockDbSelectWhere = vi.fn();
    const mockDbSelectFrom = vi.fn(() => ({ where: mockDbSelectWhere }));
    const mockDbSelect = vi.fn(() => ({ from: mockDbSelectFrom }));
    return {
      mockAuth: vi.fn(),
      mockRedirect: vi.fn((url: string) => {
        const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
        error.digest = `NEXT_REDIRECT;replace;${url};303`;
        throw error;
      }),
      mockDbSelect: mockDbSelect,
      mockDbSelectFrom: mockDbSelectFrom,
      mockDbSelectWhere: mockDbSelectWhere,
    };
  });

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", isSuperadmin: "is_superadmin" },
  gymMemberships: { id: "id", userId: "user_id", gymId: "gym_id", role: "role", isActive: "is_active" },
  gyms: { id: "id", clerkOrgId: "clerk_org_id" },
  athletes: { id: "id", userId: "user_id", gymId: "gym_id", isActive: "is_active" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
}));

import {
  requireSuperAdmin,
  requireGymAccess,
  requireGymOwner,
  requireTrainer,
  requireAthlete,
  requireSuperAdminApi,
  requireGymAccessApi,
  requireGymOwnerApi,
  isAuthError,
} from "../guards";

// --- Helpers ---
const DB_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";
const ORG_ID = "org_123";
const ATHLETE_ID = "770e8400-e29b-41d4-a716-446655440002";

async function getRedirectUrl(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    throw new Error("Expected redirect");
  } catch (error) {
    if (
      error instanceof Error &&
      (error as Error & { digest?: string }).digest?.startsWith("NEXT_REDIRECT")
    ) {
      return (error as Error & { digest: string }).digest.split(";")[2];
    }
    throw error;
  }
}

/** Setup sequential DB responses for chained select().from().where() calls */
function setupDbResponses(...responses: unknown[][]) {
  for (const response of responses) {
    mockDbSelectWhere.mockResolvedValueOnce(response);
  }
}

// =========================================================
// PAGE GUARDS
// =========================================================

describe("requireSuperAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
      error.digest = `NEXT_REDIRECT;replace;${url};303`;
      throw error;
    });
  });

  it("should redirect to /sign-in when no user", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const url = await getRedirectUrl(() => requireSuperAdmin());
    expect(url).toBe("/sign-in");
  });

  it("should redirect to /unauthorized when user is not superadmin (no DB user)", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user_1" });
    setupDbResponses([]); // No DB user found
    const url = await getRedirectUrl(() => requireSuperAdmin());
    expect(url).toBe("/unauthorized");
  });

  it("should redirect to /unauthorized when user is not superadmin", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user_1" });
    setupDbResponses([
      { id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "user@test.com", isSuperadmin: false },
    ]);
    const url = await getRedirectUrl(() => requireSuperAdmin());
    expect(url).toBe("/unauthorized");
  });

  it("should return AuthenticatedUser when user is superadmin", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user_1" });
    setupDbResponses([
      { id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "admin@test.com", isSuperadmin: true },
    ]);
    const result = await requireSuperAdmin();
    expect(result).toEqual({
      clerkUserId: "clerk_user_1",
      dbUserId: DB_USER_ID,
      email: "admin@test.com",
      isSuperAdmin: true,
    });
  });
});

describe("requireGymAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
      error.digest = `NEXT_REDIRECT;replace;${url};303`;
      throw error;
    });
  });

  it("should redirect to /sign-in when no user", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const url = await getRedirectUrl(() => requireGymAccess());
    expect(url).toBe("/sign-in");
  });

  it("should redirect to /unauthorized when no orgId", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user_1", orgId: null });
    const url = await getRedirectUrl(() => requireGymAccess());
    expect(url).toBe("/unauthorized");
  });

  it("should redirect to /unauthorized when orgRole is athlete", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:athlete",
    });
    const url = await getRedirectUrl(() => requireGymAccess());
    expect(url).toBe("/unauthorized");
  });

  it("should redirect to /unauthorized when gym not found for org", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:admin",
    });
    setupDbResponses([]); // No gym found
    const url = await getRedirectUrl(() => requireGymAccess());
    expect(url).toBe("/unauthorized");
  });

  it("should redirect to /unauthorized when explicit gymId doesn't match", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:admin",
    });
    setupDbResponses([{ id: GYM_ID }]); // Gym found
    const url = await getRedirectUrl(() =>
      requireGymAccess("different-gym-id")
    );
    expect(url).toBe("/unauthorized");
  });

  it("should return GymContext for valid admin", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:admin",
    });
    setupDbResponses(
      [{ id: GYM_ID }], // Gym found
      [{ id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "admin@test.com", isSuperadmin: false }], // DB user
    );
    const result = await requireGymAccess();
    expect(result).toEqual({
      user: {
        clerkUserId: "clerk_user_1",
        dbUserId: DB_USER_ID,
        email: "admin@test.com",
        isSuperAdmin: false,
      },
      gymId: GYM_ID,
      orgId: ORG_ID,
      role: "owner",
    });
  });

  it("should return GymContext for valid trainer", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:trainer",
    });
    setupDbResponses(
      [{ id: GYM_ID }],
      [{ id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "trainer@test.com", isSuperadmin: false }],
    );
    const result = await requireGymAccess();
    expect(result).toEqual({
      user: {
        clerkUserId: "clerk_user_1",
        dbUserId: DB_USER_ID,
        email: "trainer@test.com",
        isSuperAdmin: false,
      },
      gymId: GYM_ID,
      orgId: ORG_ID,
      role: "trainer",
    });
  });
});

describe("requireGymOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
      error.digest = `NEXT_REDIRECT;replace;${url};303`;
      throw error;
    });
  });

  it("should redirect trainer to /unauthorized", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:trainer",
    });
    const url = await getRedirectUrl(() => requireGymOwner());
    expect(url).toBe("/unauthorized");
  });

  it("should return GymContext for admin", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:admin",
    });
    setupDbResponses(
      [{ id: GYM_ID }],
      [{ id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "owner@test.com", isSuperadmin: false }],
    );
    const result = await requireGymOwner();
    expect(result).toEqual({
      user: {
        clerkUserId: "clerk_user_1",
        dbUserId: DB_USER_ID,
        email: "owner@test.com",
        isSuperAdmin: false,
      },
      gymId: GYM_ID,
      orgId: ORG_ID,
      role: "owner",
    });
  });
});

describe("requireTrainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
      error.digest = `NEXT_REDIRECT;replace;${url};303`;
      throw error;
    });
  });

  it("should return GymContext for admin", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:admin",
    });
    setupDbResponses(
      [{ id: GYM_ID }],
      [{ id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "admin@test.com", isSuperadmin: false }],
    );
    const result = await requireTrainer();
    expect(result).toEqual(
      expect.objectContaining({ gymId: GYM_ID, role: "owner" })
    );
  });

  it("should return GymContext for trainer", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:trainer",
    });
    setupDbResponses(
      [{ id: GYM_ID }],
      [{ id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "trainer@test.com", isSuperadmin: false }],
    );
    const result = await requireTrainer();
    expect(result).toEqual(
      expect.objectContaining({ gymId: GYM_ID, role: "trainer" })
    );
  });
});

describe("requireAthlete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      const error = new Error("NEXT_REDIRECT") as Error & { digest: string };
      error.digest = `NEXT_REDIRECT;replace;${url};303`;
      throw error;
    });
  });

  it("should redirect to /sign-in when no user", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const url = await getRedirectUrl(() => requireAthlete());
    expect(url).toBe("/sign-in");
  });

  it("should redirect to /unauthorized when role is not athlete", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:admin",
    });
    const url = await getRedirectUrl(() => requireAthlete());
    expect(url).toBe("/unauthorized");
  });

  it("should redirect to /unauthorized when no orgId", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: null,
      orgRole: null,
    });
    const url = await getRedirectUrl(() => requireAthlete());
    expect(url).toBe("/unauthorized");
  });

  it("should redirect to /unauthorized when gym not found", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:athlete",
    });
    setupDbResponses([]); // No gym
    const url = await getRedirectUrl(() => requireAthlete());
    expect(url).toBe("/unauthorized");
  });

  it("should redirect to /unauthorized when no DB user", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:athlete",
    });
    setupDbResponses(
      [{ id: GYM_ID }], // Gym found
      [], // No DB user
    );
    const url = await getRedirectUrl(() => requireAthlete());
    expect(url).toBe("/unauthorized");
  });

  it("should redirect to /unauthorized when no athlete record", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:athlete",
    });
    setupDbResponses(
      [{ id: GYM_ID }], // Gym found
      [{ id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "ath@test.com", isSuperadmin: false }], // DB user
      [], // No athlete
    );
    const url = await getRedirectUrl(() => requireAthlete());
    expect(url).toBe("/unauthorized");
  });

  it("should return AthleteContext for valid athlete", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:athlete",
    });
    setupDbResponses(
      [{ id: GYM_ID }], // Gym found
      [{ id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "ath@test.com", isSuperadmin: false }], // DB user
      [{ id: ATHLETE_ID }], // Athlete found
    );
    const result = await requireAthlete();
    expect(result).toEqual({
      user: {
        clerkUserId: "clerk_user_1",
        dbUserId: DB_USER_ID,
        email: "ath@test.com",
        isSuperAdmin: false,
      },
      gymId: GYM_ID,
      orgId: ORG_ID,
      athleteId: ATHLETE_ID,
    });
  });
});

// =========================================================
// API GUARDS
// =========================================================

describe("requireSuperAdminApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 error when no user", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await requireSuperAdminApi();
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(401);
    }
  });

  it("should return 403 error when not superadmin", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user_1" });
    setupDbResponses([
      { id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "user@test.com", isSuperadmin: false },
    ]);
    const result = await requireSuperAdminApi();
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(403);
    }
  });

  it("should return 403 when no DB user", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user_1" });
    setupDbResponses([]);
    const result = await requireSuperAdminApi();
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(403);
    }
  });

  it("should return AuthenticatedUser when superadmin", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user_1" });
    setupDbResponses([
      { id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "admin@test.com", isSuperadmin: true },
    ]);
    const result = await requireSuperAdminApi();
    expect(isAuthError(result)).toBe(false);
    expect(result).toEqual({
      clerkUserId: "clerk_user_1",
      dbUserId: DB_USER_ID,
      email: "admin@test.com",
      isSuperAdmin: true,
    });
  });
});

describe("requireGymAccessApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 error when no user", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await requireGymAccessApi();
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(401);
    }
  });

  it("should return 403 error when no orgId", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user_1", orgId: null });
    const result = await requireGymAccessApi();
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(403);
    }
  });

  it("should return 403 when athlete role", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:athlete",
    });
    const result = await requireGymAccessApi();
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(403);
    }
  });

  it("should return GymContext for valid admin", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:admin",
    });
    setupDbResponses(
      [{ id: GYM_ID }],
      [{ id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "admin@test.com", isSuperadmin: false }],
    );
    const result = await requireGymAccessApi();
    expect(isAuthError(result)).toBe(false);
    expect(result).toEqual({
      user: {
        clerkUserId: "clerk_user_1",
        dbUserId: DB_USER_ID,
        email: "admin@test.com",
        isSuperAdmin: false,
      },
      gymId: GYM_ID,
      orgId: ORG_ID,
      role: "owner",
    });
  });
});

describe("requireGymOwnerApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 error when no user", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await requireGymOwnerApi();
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(401);
    }
  });

  it("should return 403 error when no orgId", async () => {
    mockAuth.mockResolvedValue({ userId: "clerk_user_1", orgId: null, orgRole: null });
    const result = await requireGymOwnerApi();
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(403);
    }
  });

  it("should return 403 when trainer role", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:trainer",
    });
    const result = await requireGymOwnerApi();
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(403);
    }
  });

  it("should return 403 when athlete role", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:athlete",
    });
    const result = await requireGymOwnerApi();
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(403);
    }
  });

  it("should return 403 when gym not found", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:admin",
    });
    setupDbResponses([]); // No gym
    const result = await requireGymOwnerApi();
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(403);
    }
  });

  it("should return 403 when no DB user", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:admin",
    });
    setupDbResponses(
      [{ id: GYM_ID }], // Gym found
      [], // No DB user
    );
    const result = await requireGymOwnerApi();
    expect(isAuthError(result)).toBe(true);
    if (isAuthError(result)) {
      expect(result.status).toBe(403);
    }
  });

  it("should return GymContext for valid admin", async () => {
    mockAuth.mockResolvedValue({
      userId: "clerk_user_1",
      orgId: ORG_ID,
      orgRole: "org:admin",
    });
    setupDbResponses(
      [{ id: GYM_ID }],
      [{ id: DB_USER_ID, clerkUserId: "clerk_user_1", email: "owner@test.com", isSuperadmin: false }],
    );
    const result = await requireGymOwnerApi();
    expect(isAuthError(result)).toBe(false);
    expect(result).toEqual({
      user: {
        clerkUserId: "clerk_user_1",
        dbUserId: DB_USER_ID,
        email: "owner@test.com",
        isSuperAdmin: false,
      },
      gymId: GYM_ID,
      orgId: ORG_ID,
      role: "owner",
    });
  });
});

describe("isAuthError", () => {
  it("should return true for AuthError", () => {
    expect(isAuthError({ error: "test", status: 401 })).toBe(true);
    expect(isAuthError({ error: "forbidden", status: 403 })).toBe(true);
  });

  it("should return false for non-AuthError", () => {
    expect(
      isAuthError({
        user: { clerkUserId: "x", dbUserId: "y", email: "z", isSuperAdmin: false },
        gymId: "g",
        orgId: "o",
        role: "owner",
      } as unknown)
    ).toBe(false);
  });
});
