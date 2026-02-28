// @vitest-environment node
import { describe, it, expect } from "vitest";
import { calculateZoneTimes } from "../zones";

describe("calculateZoneTimes", () => {
  const MAX_HR = 200;

  it("should calculate zone times from consecutive readings", () => {
    const readings = [
      { heartRateBpm: 110, recordedAt: new Date("2026-01-01T10:00:00Z") }, // Zone 1 (55%)
      { heartRateBpm: 130, recordedAt: new Date("2026-01-01T10:00:10Z") }, // Zone 2 (65%)
      { heartRateBpm: 150, recordedAt: new Date("2026-01-01T10:00:20Z") }, // Zone 3 (75%)
      { heartRateBpm: 170, recordedAt: new Date("2026-01-01T10:00:30Z") }, // Zone 4 (85%)
    ];

    const result = calculateZoneTimes(readings, MAX_HR);

    // Reading 0 → 1: 10s in zone 1
    // Reading 1 → 2: 10s in zone 2
    // Reading 2 → 3: 10s in zone 3
    expect(result.zone1Seconds).toBe(10);
    expect(result.zone2Seconds).toBe(10);
    expect(result.zone3Seconds).toBe(10);
    expect(result.zone4Seconds).toBe(0); // Last reading has no next
    expect(result.zone5Seconds).toBe(0);
  });

  it("should cap delta at 30 seconds for sensor dropouts", () => {
    const readings = [
      { heartRateBpm: 150, recordedAt: new Date("2026-01-01T10:00:00Z") }, // Zone 3
      { heartRateBpm: 150, recordedAt: new Date("2026-01-01T10:02:00Z") }, // 120s gap → capped to 30s
    ];

    const result = calculateZoneTimes(readings, MAX_HR);

    expect(result.zone3Seconds).toBe(30); // Capped, not 120
  });

  it("should return all zeros for empty readings", () => {
    const result = calculateZoneTimes([], MAX_HR);

    expect(result.zone1Seconds).toBe(0);
    expect(result.zone2Seconds).toBe(0);
    expect(result.zone3Seconds).toBe(0);
    expect(result.zone4Seconds).toBe(0);
    expect(result.zone5Seconds).toBe(0);
  });

  it("should return all zeros for single reading", () => {
    const readings = [
      { heartRateBpm: 150, recordedAt: new Date("2026-01-01T10:00:00Z") },
    ];

    const result = calculateZoneTimes(readings, MAX_HR);

    expect(result.zone1Seconds).toBe(0);
    expect(result.zone2Seconds).toBe(0);
    expect(result.zone3Seconds).toBe(0);
    expect(result.zone4Seconds).toBe(0);
    expect(result.zone5Seconds).toBe(0);
  });

  it("should accumulate time in same zone across multiple readings", () => {
    const readings = [
      { heartRateBpm: 150, recordedAt: new Date("2026-01-01T10:00:00Z") }, // Zone 3
      { heartRateBpm: 155, recordedAt: new Date("2026-01-01T10:00:05Z") }, // Zone 3
      { heartRateBpm: 148, recordedAt: new Date("2026-01-01T10:00:10Z") }, // Zone 3
      { heartRateBpm: 152, recordedAt: new Date("2026-01-01T10:00:15Z") }, // Zone 3
    ];

    const result = calculateZoneTimes(readings, MAX_HR);

    expect(result.zone3Seconds).toBe(15); // 5 + 5 + 5
    expect(result.zone1Seconds).toBe(0);
    expect(result.zone2Seconds).toBe(0);
  });

  it("should handle zone 5 (peak) readings", () => {
    const readings = [
      { heartRateBpm: 185, recordedAt: new Date("2026-01-01T10:00:00Z") }, // Zone 5 (92.5%)
      { heartRateBpm: 190, recordedAt: new Date("2026-01-01T10:00:10Z") }, // Zone 5
    ];

    const result = calculateZoneTimes(readings, MAX_HR);

    expect(result.zone5Seconds).toBe(10);
  });
});
