// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const {
  mockDbInsert,
  mockDbInsertValues,
  mockDbInsertOnConflict,
  mockDbUpdate,
  mockDbUpdateSet,
  mockDbUpdateSetWhereReturning,
  mockDbSelect,
  mockDbSelectWhere,
} = vi.hoisted(() => {
  const mockDbInsertOnConflict = vi.fn().mockResolvedValue(undefined);
  const mockDbInsertValues = vi.fn(() => ({
    onConflictDoNothing: mockDbInsertOnConflict,
  }));
  const mockDbInsert = vi.fn(() => ({ values: mockDbInsertValues }));

  const mockDbUpdateSetWhereReturning = vi.fn();
  const mockDbUpdateSetWhere = vi.fn(() => ({
    returning: mockDbUpdateSetWhereReturning,
  }));
  const mockDbUpdateSet = vi.fn(() => ({ where: mockDbUpdateSetWhere }));
  const mockDbUpdate = vi.fn(() => ({ set: mockDbUpdateSet }));

  const mockDbSelectWhere = vi.fn();
  const mockDbSelectFrom = vi.fn(() => ({ where: mockDbSelectWhere }));
  const mockDbSelect = vi.fn(() => ({ from: mockDbSelectFrom }));

  return {
    mockDbInsert,
    mockDbInsertValues,
    mockDbInsertOnConflict,
    mockDbUpdate,
    mockDbUpdateSet,
    mockDbUpdateSetWhere,
    mockDbUpdateSetWhereReturning,
    mockDbSelect,
    mockDbSelectFrom,
    mockDbSelectWhere,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", clerkUserId: "clerk_user_id", email: "email", name: "name", isSuperadmin: "is_superadmin" },
  gyms: { id: "id", clerkOrgId: "clerk_org_id" },
  gymMemberships: { id: "id", userId: "user_id", gymId: "gym_id", role: "role", isActive: "is_active" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
}));

import {
  handleUserCreated,
  handleUserUpdated,
  handleUserDeleted,
  handleOrganizationCreated,
  handleMembershipCreated,
  handleMembershipUpdated,
  handleMembershipDeleted,
} from "../clerk-handlers";
import type {
  ClerkUserEventData,
  ClerkUserDeletedEventData,
  ClerkOrganizationEventData,
  ClerkOrgMembershipEventData,
} from "../types";

// --- Test data ---
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const GYM_ID = "660e8400-e29b-41d4-a716-446655440001";

function makeUserData(overrides: Partial<ClerkUserEventData> = {}): ClerkUserEventData {
  return {
    id: "user_clerk_123",
    email_addresses: [{ email_address: "test@example.com", id: "email_1" }],
    first_name: "John",
    last_name: "Doe",
    public_metadata: {},
    ...overrides,
  };
}

function makeMembershipData(overrides: Partial<ClerkOrgMembershipEventData> = {}): ClerkOrgMembershipEventData {
  return {
    id: "mem_123",
    organization: { id: "org_clerk_456" },
    public_user_data: { user_id: "user_clerk_123" },
    role: "org:admin",
    ...overrides,
  };
}

// =========================================================
// handleUserCreated
// =========================================================

describe("handleUserCreated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should insert user with correct fields", async () => {
    const data = makeUserData();
    await handleUserCreated(data);

    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockDbInsertValues).toHaveBeenCalledWith({
      clerkUserId: "user_clerk_123",
      email: "test@example.com",
      name: "John Doe",
      isSuperadmin: false,
    });
    expect(mockDbInsertOnConflict).toHaveBeenCalled();
  });

  it("should set isSuperadmin when public_metadata has flag", async () => {
    const data = makeUserData({
      public_metadata: { is_superadmin: true },
    });
    await handleUserCreated(data);

    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ isSuperadmin: true })
    );
  });

  it("should build name from first_name only when last_name is null", async () => {
    const data = makeUserData({ first_name: "Jane", last_name: null });
    await handleUserCreated(data);

    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Jane" })
    );
  });

  it("should build name from last_name only when first_name is null", async () => {
    const data = makeUserData({ first_name: null, last_name: "Smith" });
    await handleUserCreated(data);

    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Smith" })
    );
  });

  it("should use email as name when both names are null", async () => {
    const data = makeUserData({ first_name: null, last_name: null });
    await handleUserCreated(data);

    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ name: "test@example.com" })
    );
  });

  it("should use first email address", async () => {
    const data = makeUserData({
      email_addresses: [
        { email_address: "primary@example.com", id: "e1" },
        { email_address: "secondary@example.com", id: "e2" },
      ],
    });
    await handleUserCreated(data);

    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ email: "primary@example.com" })
    );
  });

  it("should use onConflictDoNothing for idempotency", async () => {
    const data = makeUserData();
    await handleUserCreated(data);

    expect(mockDbInsertOnConflict).toHaveBeenCalled();
  });
});

// =========================================================
// handleUserUpdated
// =========================================================

describe("handleUserUpdated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should update user email, name, and superadmin flag", async () => {
    const data = makeUserData({
      first_name: "Updated",
      last_name: "Name",
      public_metadata: { is_superadmin: true },
    });
    mockDbUpdateSetWhereReturning.mockResolvedValue([{ id: USER_ID }]);

    await handleUserUpdated(data);

    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      email: "test@example.com",
      name: "Updated Name",
      isSuperadmin: true,
    });
  });

  it("should handle user not found gracefully", async () => {
    const data = makeUserData();
    mockDbUpdateSetWhereReturning.mockResolvedValue([]);

    await expect(handleUserUpdated(data)).resolves.not.toThrow();
  });
});

// =========================================================
// handleUserDeleted
// =========================================================

describe("handleUserDeleted", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should deactivate all memberships for the user", async () => {
    const data: ClerkUserDeletedEventData = { id: "user_clerk_123", deleted: true };

    // First select: find user
    mockDbSelectWhere.mockResolvedValueOnce([{ id: USER_ID }]);
    // Then update memberships
    mockDbUpdateSetWhereReturning.mockResolvedValue([]);

    await handleUserDeleted(data);

    expect(mockDbSelect).toHaveBeenCalled();
    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockDbUpdateSet).toHaveBeenCalledWith({ isActive: false });
  });

  it("should handle user not found gracefully", async () => {
    const data: ClerkUserDeletedEventData = { id: "user_clerk_unknown", deleted: true };
    mockDbSelectWhere.mockResolvedValueOnce([]);

    await expect(handleUserDeleted(data)).resolves.not.toThrow();
  });
});

// =========================================================
// handleOrganizationCreated
// =========================================================

describe("handleOrganizationCreated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should log organization creation without mutations", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const data: ClerkOrganizationEventData = {
      id: "org_clerk_456",
      name: "Test Gym",
      slug: "test-gym",
    };

    await handleOrganizationCreated(data);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("org_clerk_456")
    );
    // Should NOT insert/update anything
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// =========================================================
// handleMembershipCreated
// =========================================================

describe("handleMembershipCreated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should create membership for valid user and gym", async () => {
    const data = makeMembershipData({ role: "org:admin" });
    // resolveUser
    mockDbSelectWhere.mockResolvedValueOnce([{ id: USER_ID }]);
    // resolveGym
    mockDbSelectWhere.mockResolvedValueOnce([{ id: GYM_ID }]);

    await handleMembershipCreated(data);

    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockDbInsertValues).toHaveBeenCalledWith({
      userId: USER_ID,
      gymId: GYM_ID,
      role: "owner",
      isActive: true,
    });
    expect(mockDbInsertOnConflict).toHaveBeenCalled();
  });

  it("should map org:trainer role to trainer", async () => {
    const data = makeMembershipData({ role: "org:trainer" });
    mockDbSelectWhere.mockResolvedValueOnce([{ id: USER_ID }]);
    mockDbSelectWhere.mockResolvedValueOnce([{ id: GYM_ID }]);

    await handleMembershipCreated(data);

    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ role: "trainer" })
    );
  });

  it("should map org:athlete role to athlete", async () => {
    const data = makeMembershipData({ role: "org:athlete" });
    mockDbSelectWhere.mockResolvedValueOnce([{ id: USER_ID }]);
    mockDbSelectWhere.mockResolvedValueOnce([{ id: GYM_ID }]);

    await handleMembershipCreated(data);

    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ role: "athlete" })
    );
  });

  it("should skip when user not found", async () => {
    const data = makeMembershipData();
    mockDbSelectWhere.mockResolvedValueOnce([]); // No user

    await handleMembershipCreated(data);

    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("should skip when gym not found", async () => {
    const data = makeMembershipData();
    mockDbSelectWhere.mockResolvedValueOnce([{ id: USER_ID }]); // User found
    mockDbSelectWhere.mockResolvedValueOnce([]); // No gym

    await handleMembershipCreated(data);

    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("should default to athlete for unknown roles", async () => {
    const data = makeMembershipData({ role: "org:unknown" });
    mockDbSelectWhere.mockResolvedValueOnce([{ id: USER_ID }]);
    mockDbSelectWhere.mockResolvedValueOnce([{ id: GYM_ID }]);

    await handleMembershipCreated(data);

    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ role: "athlete" })
    );
  });
});

// =========================================================
// handleMembershipUpdated
// =========================================================

describe("handleMembershipUpdated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should update role for existing membership", async () => {
    const data = makeMembershipData({ role: "org:trainer" });
    // resolveUser
    mockDbSelectWhere.mockResolvedValueOnce([{ id: USER_ID }]);
    // resolveGym
    mockDbSelectWhere.mockResolvedValueOnce([{ id: GYM_ID }]);
    // update result
    mockDbUpdateSetWhereReturning.mockResolvedValue([{ id: "mem_1" }]);

    await handleMembershipUpdated(data);

    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockDbUpdateSet).toHaveBeenCalledWith({ role: "trainer" });
  });

  it("should handle user not found gracefully", async () => {
    const data = makeMembershipData();
    mockDbSelectWhere.mockResolvedValueOnce([]); // No user

    await expect(handleMembershipUpdated(data)).resolves.not.toThrow();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("should handle gym not found gracefully", async () => {
    const data = makeMembershipData();
    mockDbSelectWhere.mockResolvedValueOnce([{ id: USER_ID }]);
    mockDbSelectWhere.mockResolvedValueOnce([]); // No gym

    await expect(handleMembershipUpdated(data)).resolves.not.toThrow();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});

// =========================================================
// handleMembershipDeleted
// =========================================================

describe("handleMembershipDeleted", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should set isActive to false", async () => {
    const data = makeMembershipData();
    // resolveUser
    mockDbSelectWhere.mockResolvedValueOnce([{ id: USER_ID }]);
    // resolveGym
    mockDbSelectWhere.mockResolvedValueOnce([{ id: GYM_ID }]);
    // update result
    mockDbUpdateSetWhereReturning.mockResolvedValue([{ id: "mem_1" }]);

    await handleMembershipDeleted(data);

    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockDbUpdateSet).toHaveBeenCalledWith({ isActive: false });
  });

  it("should handle user not found gracefully", async () => {
    const data = makeMembershipData();
    mockDbSelectWhere.mockResolvedValueOnce([]); // No user

    await expect(handleMembershipDeleted(data)).resolves.not.toThrow();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("should handle gym not found gracefully", async () => {
    const data = makeMembershipData();
    mockDbSelectWhere.mockResolvedValueOnce([{ id: USER_ID }]);
    mockDbSelectWhere.mockResolvedValueOnce([]); // No gym

    await expect(handleMembershipDeleted(data)).resolves.not.toThrow();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});
