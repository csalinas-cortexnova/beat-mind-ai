import { describe, it, expect } from "vitest";
import { calculateWeeklyStreak } from "../weekly-streak";

describe("calculateWeeklyStreak", () => {
  it("should return 0 for empty array", () => {
    expect(calculateWeeklyStreak([])).toBe(0);
  });

  it("should return 1 for a single week", () => {
    expect(calculateWeeklyStreak(["2026-02-23"])).toBe(1);
  });

  it("should return streak for consecutive weeks", () => {
    // 3 consecutive Mondays
    expect(
      calculateWeeklyStreak(["2026-02-09", "2026-02-16", "2026-02-23"])
    ).toBe(3);
  });

  it("should break streak on gap", () => {
    // Missing week in the middle — only last 2 are consecutive
    expect(
      calculateWeeklyStreak(["2026-02-02", "2026-02-16", "2026-02-23"])
    ).toBe(2);
  });

  it("should handle unsorted input", () => {
    expect(
      calculateWeeklyStreak(["2026-02-23", "2026-02-09", "2026-02-16"])
    ).toBe(3);
  });

  it("should handle duplicates gracefully", () => {
    expect(
      calculateWeeklyStreak(["2026-02-16", "2026-02-16", "2026-02-23"])
    ).toBe(2);
  });

  it("should return 1 when only one distinct week exists", () => {
    expect(
      calculateWeeklyStreak(["2026-02-23", "2026-02-23"])
    ).toBe(1);
  });
});
