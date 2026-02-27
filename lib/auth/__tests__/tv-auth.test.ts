// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("@/lib/db", () => {
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

  return {
    db: {
      select: mockSelect,
      update: mockUpdate,
      _mocks: { mockSelect, mockFrom, mockWhere, mockUpdate, mockSet, mockUpdateWhere },
    },
  };
});

import { db } from "@/lib/db";
import { verifyTvToken, regenerateTvToken } from "../tv-auth";

const mocks = (db as unknown as { _mocks: Record<string, ReturnType<typeof vi.fn>> })._mocks;

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_TOKEN = "f0e1d2c3-b4a5-6789-0abc-def123456789";

describe("verifyTvToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockWhere.mockResolvedValue([]);
  });

  it("should return null for invalid UUID gymId", async () => {
    const result = await verifyTvToken("not-a-uuid", VALID_TOKEN);
    expect(result).toBeNull();
    expect(mocks.mockSelect).not.toHaveBeenCalled();
  });

  it("should return null for invalid UUID token", async () => {
    const result = await verifyTvToken(VALID_UUID, "bad-token");
    expect(result).toBeNull();
    expect(mocks.mockSelect).not.toHaveBeenCalled();
  });

  it("should return null when gym is not found", async () => {
    mocks.mockWhere.mockResolvedValue([]);
    const result = await verifyTvToken(VALID_UUID, VALID_TOKEN);
    expect(result).toBeNull();
  });

  it("should return null when token does not match", async () => {
    mocks.mockWhere.mockResolvedValue([]);
    const result = await verifyTvToken(VALID_UUID, VALID_TOKEN);
    expect(result).toBeNull();
  });

  it("should return TvContext when gymId and token are valid", async () => {
    mocks.mockWhere.mockResolvedValue([{ id: VALID_UUID }]);
    const result = await verifyTvToken(VALID_UUID, VALID_TOKEN);
    expect(result).toEqual({ gymId: VALID_UUID });
  });
});

describe("regenerateTvToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return a new UUID string", async () => {
    const token = await regenerateTvToken(VALID_UUID);
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("should call db.update on gyms table with the new token", async () => {
    const token = await regenerateTvToken(VALID_UUID);
    expect(mocks.mockUpdate).toHaveBeenCalled();
    expect(mocks.mockSet).toHaveBeenCalledWith({ tvAccessToken: token });
    expect(mocks.mockUpdateWhere).toHaveBeenCalled();
  });
});
