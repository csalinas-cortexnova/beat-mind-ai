// @vitest-environment node
import { describe, it, expect } from "vitest";
import { InviteTrainerSchema } from "../trainer";

describe("InviteTrainerSchema", () => {
  const validInvite = {
    email: "trainer@example.com",
    name: "John Trainer",
  };

  it("should accept valid invite data", () => {
    const result = InviteTrainerSchema.safeParse(validInvite);
    expect(result.success).toBe(true);
  });

  it("should lowercase and trim email", () => {
    const result = InviteTrainerSchema.safeParse({
      ...validInvite,
      email: "  Trainer@EXAMPLE.com  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("trainer@example.com");
    }
  });

  it("should reject invalid email", () => {
    const result = InviteTrainerSchema.safeParse({
      ...validInvite,
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty name", () => {
    const result = InviteTrainerSchema.safeParse({
      ...validInvite,
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject name longer than 100 characters", () => {
    const result = InviteTrainerSchema.safeParse({
      ...validInvite,
      name: "A".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("should accept name of exactly 1 character", () => {
    const result = InviteTrainerSchema.safeParse({
      ...validInvite,
      name: "A",
    });
    expect(result.success).toBe(true);
  });

  it("should accept name of exactly 100 characters", () => {
    const result = InviteTrainerSchema.safeParse({
      ...validInvite,
      name: "A".repeat(100),
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing email", () => {
    const result = InviteTrainerSchema.safeParse({ name: "John" });
    expect(result.success).toBe(false);
  });

  it("should reject missing name", () => {
    const result = InviteTrainerSchema.safeParse({
      email: "trainer@example.com",
    });
    expect(result.success).toBe(false);
  });
});
