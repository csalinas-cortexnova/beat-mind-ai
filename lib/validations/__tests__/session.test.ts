// @vitest-environment node
import { describe, it, expect } from "vitest";
import { EndSessionSchema } from "../session";

describe("EndSessionSchema", () => {
  it("should accept empty object", () => {
    const result = EndSessionSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should accept with classType", () => {
    const result = EndSessionSchema.safeParse({ classType: "HIIT" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.classType).toBe("HIIT");
    }
  });

  it("should accept classType of exactly 100 characters", () => {
    const result = EndSessionSchema.safeParse({
      classType: "A".repeat(100),
    });
    expect(result.success).toBe(true);
  });

  it("should reject classType over 100 characters", () => {
    const result = EndSessionSchema.safeParse({
      classType: "A".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("should accept without classType (optional)", () => {
    const result = EndSessionSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.classType).toBeUndefined();
    }
  });
});
