// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/db/schema", () => ({
  hrReadings: {
    sessionId: "sessionId",
    gymId: "gymId",
    athleteId: "athleteId",
    heartRateBpm: "heartRateBpm",
    hrZone: "hrZone",
    recordedAt: "recordedAt",
    hrMaxPercent: "hrMaxPercent",
  },
  athletes: {
    id: "id",
    name: "name",
    age: "age",
    weightKg: "weightKg",
    gender: "gender",
    maxHr: "maxHr",
  },
  sessions: {
    id: "id",
    durationSeconds: "durationSeconds",
  },
}));

import { calculateAthleteSessionStats } from "../stats";

describe("calculateAthleteSessionStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupMockQuery(rows: unknown[]) {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    });
  }

  const sessionId = "550e8400-e29b-41d4-a716-446655440001";

  it("should calculate stats for a single athlete", () => {
    const baseTime = new Date("2026-01-01T10:00:00Z");
    const rows = [
      {
        athleteId: "a1",
        athleteName: "Maria",
        age: 28,
        weightKg: "65.00",
        gender: "female",
        maxHr: 192,
        heartRateBpm: 140,
        hrZone: 3,
        recordedAt: new Date(baseTime.getTime()),
      },
      {
        athleteId: "a1",
        athleteName: "Maria",
        age: 28,
        weightKg: "65.00",
        gender: "female",
        maxHr: 192,
        heartRateBpm: 160,
        hrZone: 4,
        recordedAt: new Date(baseTime.getTime() + 10_000),
      },
      {
        athleteId: "a1",
        athleteName: "Maria",
        age: 28,
        weightKg: "65.00",
        gender: "female",
        maxHr: 192,
        heartRateBpm: 130,
        hrZone: 2,
        recordedAt: new Date(baseTime.getTime() + 20_000),
      },
    ];

    setupMockQuery(rows);

    return calculateAthleteSessionStats(sessionId, 1800).then((result) => {
      expect(result).toHaveLength(1);
      const athlete = result[0];
      expect(athlete.athleteId).toBe("a1");
      expect(athlete.athleteName).toBe("Maria");
      expect(athlete.avgHr).toBe(143); // (140+160+130)/3 ≈ 143.33 → 143
      expect(athlete.maxHr).toBe(160);
      expect(athlete.minHr).toBe(130);
      expect(typeof athlete.calories).toBe("number");
      expect(athlete.calories).toBeGreaterThanOrEqual(0);
      // Zone times check — readings at 10s intervals
      expect(athlete.zoneTimes.zone3Seconds).toBe(10); // First reading zone 3 → 10s
      expect(athlete.zoneTimes.zone4Seconds).toBe(10); // Second reading zone 4 → 10s
    });
  });

  it("should calculate stats for multiple athletes", () => {
    const baseTime = new Date("2026-01-01T10:00:00Z");
    const rows = [
      {
        athleteId: "a1",
        athleteName: "Maria",
        age: 28,
        weightKg: "65.00",
        gender: "female",
        maxHr: 192,
        heartRateBpm: 140,
        hrZone: 3,
        recordedAt: new Date(baseTime.getTime()),
      },
      {
        athleteId: "a2",
        athleteName: "Carlos",
        age: 35,
        weightKg: "80.00",
        gender: "male",
        maxHr: 185,
        heartRateBpm: 155,
        hrZone: 4,
        recordedAt: new Date(baseTime.getTime()),
      },
      {
        athleteId: "a1",
        athleteName: "Maria",
        age: 28,
        weightKg: "65.00",
        gender: "female",
        maxHr: 192,
        heartRateBpm: 150,
        hrZone: 3,
        recordedAt: new Date(baseTime.getTime() + 10_000),
      },
      {
        athleteId: "a2",
        athleteName: "Carlos",
        age: 35,
        weightKg: "80.00",
        gender: "male",
        maxHr: 185,
        heartRateBpm: 160,
        hrZone: 4,
        recordedAt: new Date(baseTime.getTime() + 10_000),
      },
    ];

    setupMockQuery(rows);

    return calculateAthleteSessionStats(sessionId, 1800).then((result) => {
      expect(result).toHaveLength(2);
      expect(result.map((a) => a.athleteId).sort()).toEqual(["a1", "a2"]);
    });
  });

  it("should return empty array when no readings exist", () => {
    setupMockQuery([]);

    return calculateAthleteSessionStats(sessionId, 1800).then((result) => {
      expect(result).toEqual([]);
    });
  });

  it("should use fallback calorie formula when athlete data is incomplete", () => {
    const baseTime = new Date("2026-01-01T10:00:00Z");
    const rows = [
      {
        athleteId: "a1",
        athleteName: "Unknown",
        age: null,
        weightKg: null,
        gender: null,
        maxHr: 190,
        heartRateBpm: 140,
        hrZone: 3,
        recordedAt: new Date(baseTime.getTime()),
      },
      {
        athleteId: "a1",
        athleteName: "Unknown",
        age: null,
        weightKg: null,
        gender: null,
        maxHr: 190,
        heartRateBpm: 150,
        hrZone: 3,
        recordedAt: new Date(baseTime.getTime() + 10_000),
      },
    ];

    setupMockQuery(rows);

    return calculateAthleteSessionStats(sessionId, 1800).then((result) => {
      expect(result).toHaveLength(1);
      // Fallback formula used — calories should still be a number
      expect(typeof result[0].calories).toBe("number");
      expect(result[0].calories).toBeGreaterThanOrEqual(0);
    });
  });

  it("should correctly aggregate zone times from readings", () => {
    const baseTime = new Date("2026-01-01T10:00:00Z");
    // All readings for a single athlete, 5s intervals, same zone
    const rows = Array.from({ length: 6 }, (_, i) => ({
      athleteId: "a1",
      athleteName: "Ana",
      age: 25,
      weightKg: "60.00",
      gender: "female",
      maxHr: 200,
      heartRateBpm: 150, // Zone 3 (75%)
      hrZone: 3,
      recordedAt: new Date(baseTime.getTime() + i * 5_000),
    }));

    setupMockQuery(rows);

    return calculateAthleteSessionStats(sessionId, 1800).then((result) => {
      expect(result).toHaveLength(1);
      // 5 intervals of 5s = 25s all in zone 3
      expect(result[0].zoneTimes.zone3Seconds).toBe(25);
      expect(result[0].zoneTimes.zone1Seconds).toBe(0);
      expect(result[0].zoneTimes.zone2Seconds).toBe(0);
    });
  });
});
