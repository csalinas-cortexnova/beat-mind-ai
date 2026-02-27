// @vitest-environment node
import { describe, it, expect } from "vitest";
import { AssignBandSchema } from "../band";

describe("AssignBandSchema", () => {
  it("should accept valid sensorId", () => {
    const result = AssignBandSchema.safeParse({ sensorId: 1 });
    expect(result.success).toBe(true);
  });

  it("should accept sensorId with bandLabel", () => {
    const result = AssignBandSchema.safeParse({
      sensorId: 12345,
      bandLabel: "Blue Band #3",
    });
    expect(result.success).toBe(true);
  });

  it("should reject sensorId of 0", () => {
    const result = AssignBandSchema.safeParse({ sensorId: 0 });
    expect(result.success).toBe(false);
  });

  it("should reject negative sensorId", () => {
    const result = AssignBandSchema.safeParse({ sensorId: -1 });
    expect(result.success).toBe(false);
  });

  it("should reject float sensorId", () => {
    const result = AssignBandSchema.safeParse({ sensorId: 1.5 });
    expect(result.success).toBe(false);
  });

  it("should reject bandLabel over 100 characters", () => {
    const result = AssignBandSchema.safeParse({
      sensorId: 1,
      bandLabel: "A".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("should accept bandLabel of exactly 100 characters", () => {
    const result = AssignBandSchema.safeParse({
      sensorId: 1,
      bandLabel: "A".repeat(100),
    });
    expect(result.success).toBe(true);
  });

  it("should accept without bandLabel (optional)", () => {
    const result = AssignBandSchema.safeParse({ sensorId: 5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bandLabel).toBeUndefined();
    }
  });

  it("should reject missing sensorId", () => {
    const result = AssignBandSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
