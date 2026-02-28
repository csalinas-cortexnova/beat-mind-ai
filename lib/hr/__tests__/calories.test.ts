// @vitest-environment node
import { describe, it, expect } from "vitest";
import { estimateCalories, type CalorieInput } from "../calories";

describe("estimateCalories", () => {
  describe("primary formula (Keytel)", () => {
    it("should calculate calories for male with full data", () => {
      const input: CalorieInput = {
        avgHr: 150,
        durationSeconds: 2700, // 45 minutes
        age: 30,
        weightKg: 80,
        gender: "male",
      };
      const result = estimateCalories(input);
      // (-55.0969 + 0.6309 * 150 + 0.1988 * 80 + 0.2017 * 30) / 4.184 * 0.75
      // = (-55.0969 + 94.635 + 15.904 + 6.051) / 4.184 * 0.75
      // = 61.4931 / 4.184 * 0.75
      // = 14.6988 * 0.75 ≈ 11.024 → 11
      expect(result).toBe(11);
      expect(Number.isInteger(result)).toBe(true);
    });

    it("should calculate calories for female with full data", () => {
      const input: CalorieInput = {
        avgHr: 140,
        durationSeconds: 3600, // 60 minutes
        age: 28,
        weightKg: 65,
        gender: "female",
      };
      const result = estimateCalories(input);
      // (-20.4022 + 0.4472 * 140 + 0.1263 * 65 + 0.074 * 28) / 4.184 * 1.0
      // = (-20.4022 + 62.608 + 8.2095 + 2.072) / 4.184
      // = 52.4873 / 4.184 ≈ 12.545 → 13
      expect(result).toBe(13);
      expect(Number.isInteger(result)).toBe(true);
    });

    it("should return higher calories for longer duration", () => {
      const base: CalorieInput = {
        avgHr: 150,
        durationSeconds: 1800,
        age: 30,
        weightKg: 80,
        gender: "male",
      };
      const longer: CalorieInput = { ...base, durationSeconds: 3600 };
      expect(estimateCalories(longer)).toBeGreaterThan(estimateCalories(base));
    });
  });

  describe("fallback formula", () => {
    it("should use fallback when gender is missing", () => {
      const input: CalorieInput = {
        avgHr: 140,
        durationSeconds: 2700,
        age: 30,
        weightKg: 80,
        gender: null,
      };
      const result = estimateCalories(input);
      // Fallback: (140/100) * (2700/60) * 4.5 ≈ 283 (IEEE 754 rounds down)
      expect(result).toBe(283);
    });

    it("should use fallback when age is missing", () => {
      const input: CalorieInput = {
        avgHr: 140,
        durationSeconds: 2700,
        age: null,
        weightKg: 80,
        gender: "male",
      };
      const result = estimateCalories(input);
      expect(result).toBe(283);
    });

    it("should use fallback when weightKg is missing", () => {
      const input: CalorieInput = {
        avgHr: 140,
        durationSeconds: 2700,
        age: 30,
        weightKg: null,
        gender: "male",
      };
      const result = estimateCalories(input);
      expect(result).toBe(283);
    });
  });

  describe("edge cases", () => {
    it("should return 0 for zero duration", () => {
      const input: CalorieInput = {
        avgHr: 150,
        durationSeconds: 0,
        age: 30,
        weightKg: 80,
        gender: "male",
      };
      expect(estimateCalories(input)).toBe(0);
    });

    it("should never return negative values", () => {
      // Very low HR + short duration could yield negative in Keytel formula
      const input: CalorieInput = {
        avgHr: 40,
        durationSeconds: 60,
        age: 20,
        weightKg: 50,
        gender: "male",
      };
      expect(estimateCalories(input)).toBeGreaterThanOrEqual(0);
    });

    it("should return integer (rounded)", () => {
      const input: CalorieInput = {
        avgHr: 133,
        durationSeconds: 1234,
        gender: null,
        age: null,
        weightKg: null,
      };
      const result = estimateCalories(input);
      expect(Number.isInteger(result)).toBe(true);
    });
  });
});
