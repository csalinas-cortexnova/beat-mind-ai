// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SendWhatsAppSchema } from "../report";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";
const validUuid2 = "660e8400-e29b-41d4-a716-446655440000";

describe("SendWhatsAppSchema", () => {
  it("should accept empty object", () => {
    const result = SendWhatsAppSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should accept with athleteIds array", () => {
    const result = SendWhatsAppSchema.safeParse({
      athleteIds: [validUuid, validUuid2],
    });
    expect(result.success).toBe(true);
  });

  it("should accept with empty athleteIds array", () => {
    const result = SendWhatsAppSchema.safeParse({ athleteIds: [] });
    expect(result.success).toBe(true);
  });

  it("should reject invalid UUID in athleteIds", () => {
    const result = SendWhatsAppSchema.safeParse({
      athleteIds: [validUuid, "not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });

  it("should accept single athleteId", () => {
    const result = SendWhatsAppSchema.safeParse({
      athleteIds: [validUuid],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.athleteIds).toHaveLength(1);
    }
  });

  it("should accept without athleteIds (optional)", () => {
    const result = SendWhatsAppSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.athleteIds).toBeUndefined();
    }
  });

  it("should reject non-array athleteIds", () => {
    const result = SendWhatsAppSchema.safeParse({
      athleteIds: validUuid,
    });
    expect(result.success).toBe(false);
  });
});
