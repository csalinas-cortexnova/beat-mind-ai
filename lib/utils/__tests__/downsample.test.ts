import { describe, it, expect } from "vitest";
import { downsampleHrData } from "../downsample";

describe("downsampleHrData", () => {
  it("should return empty array for empty input", () => {
    expect(downsampleHrData([])).toEqual([]);
  });

  it("should return data unchanged when below maxPoints", () => {
    const data = [
      { recordedAt: "2026-01-01T00:00:00Z", heartRateBpm: 120 },
      { recordedAt: "2026-01-01T00:00:05Z", heartRateBpm: 125 },
      { recordedAt: "2026-01-01T00:00:10Z", heartRateBpm: 130 },
    ];
    expect(downsampleHrData(data, 720)).toEqual(data);
  });

  it("should downsample data to maxPoints using 10-second buckets", () => {
    // Create 1500 data points (1 per second for 25 minutes)
    const data = Array.from({ length: 1500 }, (_, i) => ({
      recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      heartRateBpm: 100 + (i % 40),
    }));

    const result = downsampleHrData(data, 720);
    expect(result.length).toBeLessThanOrEqual(720);
    expect(result.length).toBeGreaterThan(0);
  });

  it("should average heartRateBpm within each bucket", () => {
    // 3 readings in the same 10-second bucket
    const data = [
      { recordedAt: "2026-01-01T00:00:00Z", heartRateBpm: 100 },
      { recordedAt: "2026-01-01T00:00:03Z", heartRateBpm: 110 },
      { recordedAt: "2026-01-01T00:00:07Z", heartRateBpm: 120 },
      // Next bucket
      { recordedAt: "2026-01-01T00:00:10Z", heartRateBpm: 130 },
    ];
    const result = downsampleHrData(data, 2);
    expect(result).toHaveLength(2);
    expect(result[0].heartRateBpm).toBe(110); // avg of 100,110,120
    expect(result[1].heartRateBpm).toBe(130);
  });

  it("should use default maxPoints of 720", () => {
    const data = Array.from({ length: 1000 }, (_, i) => ({
      recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      heartRateBpm: 120,
    }));
    const result = downsampleHrData(data);
    expect(result.length).toBeLessThanOrEqual(720);
  });
});
