/**
 * Per-athlete session statistics calculator.
 * Queries hr_readings, computes avg/max/min HR, calories, and zone times.
 */

import { db } from "@/lib/db";
import { hrReadings, athletes } from "@/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { estimateCalories } from "@/lib/hr/calories";
import { calculateZoneTimes } from "@/lib/hr/zones";

export interface AthleteSessionStats {
  athleteId: string;
  athleteName: string;
  avgHr: number;
  maxHr: number;
  minHr: number;
  calories: number;
  zoneTimes: {
    zone1Seconds: number;
    zone2Seconds: number;
    zone3Seconds: number;
    zone4Seconds: number;
    zone5Seconds: number;
  };
}

/**
 * Calculate per-athlete stats from hr_readings for a session.
 * Returns an array of stats, one per athlete.
 */
export async function calculateAthleteSessionStats(
  sessionId: string,
  durationSeconds: number
): Promise<AthleteSessionStats[]> {
  // Fetch all HR readings for the session with athlete data
  const rows = await db
    .select({
      athleteId: hrReadings.athleteId,
      athleteName: athletes.name,
      age: athletes.age,
      weightKg: athletes.weightKg,
      gender: athletes.gender,
      maxHr: athletes.maxHr,
      heartRateBpm: hrReadings.heartRateBpm,
      hrZone: hrReadings.hrZone,
      recordedAt: hrReadings.recordedAt,
    })
    .from(hrReadings)
    .innerJoin(athletes, eq(hrReadings.athleteId, athletes.id))
    .where(
      and(eq(hrReadings.sessionId, sessionId), gt(hrReadings.heartRateBpm, 0))
    )
    .orderBy(hrReadings.recordedAt);

  if (rows.length === 0) return [];

  // Group by athlete
  const byAthlete = new Map<
    string,
    {
      athleteName: string;
      age: number | null;
      weightKg: string | null; // Decimal column returns string
      gender: string | null;
      maxHr: number;
      readings: {
        heartRateBpm: number;
        hrZone: number;
        recordedAt: Date;
      }[];
    }
  >();

  for (const row of rows) {
    const existing = byAthlete.get(row.athleteId);
    if (existing) {
      existing.readings.push({
        heartRateBpm: row.heartRateBpm,
        hrZone: row.hrZone,
        recordedAt: row.recordedAt,
      });
    } else {
      byAthlete.set(row.athleteId, {
        athleteName: row.athleteName,
        age: row.age,
        weightKg: row.weightKg,
        gender: row.gender,
        maxHr: row.maxHr,
        readings: [
          {
            heartRateBpm: row.heartRateBpm,
            hrZone: row.hrZone,
            recordedAt: row.recordedAt,
          },
        ],
      });
    }
  }

  // Build stats per athlete
  const results: AthleteSessionStats[] = [];

  for (const [athleteId, data] of byAthlete) {
    const bpms = data.readings.map((r) => r.heartRateBpm);
    const avgHr = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
    const maxHr = Math.max(...bpms);
    const minHr = Math.min(...bpms);

    // Zone times from ordered readings
    const zoneTimes = calculateZoneTimes(
      data.readings.map((r) => ({
        heartRateBpm: r.heartRateBpm,
        recordedAt: r.recordedAt,
      })),
      data.maxHr
    );

    // Calorie estimation
    const weightKg = data.weightKg ? Number(data.weightKg) : null;
    const gender =
      data.gender === "male" || data.gender === "female"
        ? data.gender
        : null;
    const calories = estimateCalories({
      avgHr,
      durationSeconds,
      age: data.age,
      weightKg,
      gender,
    });

    results.push({
      athleteId,
      athleteName: data.athleteName,
      avgHr,
      maxHr,
      minHr,
      calories,
      zoneTimes,
    });
  }

  return results;
}
