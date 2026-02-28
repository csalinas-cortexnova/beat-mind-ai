import { describe, it, expect } from "vitest";
import { calculateTrend } from "../trend";

describe("calculateTrend", () => {
  it("should return 'stable' for empty array", () => {
    expect(calculateTrend([])).toBe("stable");
  });

  it("should return 'stable' for single value", () => {
    expect(calculateTrend([100])).toBe("stable");
  });

  it("should return 'improving' for increasing values", () => {
    expect(calculateTrend([100, 110, 120, 130])).toBe("improving");
  });

  it("should return 'declining' for decreasing values", () => {
    expect(calculateTrend([130, 120, 110, 100])).toBe("declining");
  });

  it("should return 'stable' for flat values", () => {
    expect(calculateTrend([100, 100, 100, 100])).toBe("stable");
  });

  it("should return 'stable' for minor fluctuations", () => {
    // Small variation should be considered stable
    expect(calculateTrend([100, 101, 99, 100])).toBe("stable");
  });

  it("should handle two values", () => {
    expect(calculateTrend([100, 120])).toBe("improving");
    expect(calculateTrend([120, 100])).toBe("declining");
  });
});
