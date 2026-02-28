/**
 * Calorie estimation from heart rate data.
 * Primary: Keytel et al. (2005) formula (gender-specific).
 * Fallback: simplified MET-based estimation when data is incomplete.
 */

export interface CalorieInput {
  avgHr: number;
  durationSeconds: number;
  age?: number | null;
  weightKg?: number | null;
  gender?: "male" | "female" | null;
}

/**
 * Estimate calories burned during a session.
 * Uses Keytel formula when age, weight, and gender are available.
 * Falls back to simplified (avgHR / 100) * minutes * 4.5 otherwise.
 */
export function estimateCalories(input: CalorieInput): number {
  const { avgHr, durationSeconds, age, weightKg, gender } = input;
  const durationHours = durationSeconds / 3600;
  const durationMinutes = durationSeconds / 60;

  // Use primary formula if all data is available
  if (age != null && weightKg != null && gender != null) {
    let rawKcal: number;
    if (gender === "male") {
      rawKcal =
        ((-55.0969 + 0.6309 * avgHr + 0.1988 * weightKg + 0.2017 * age) /
          4.184) *
        durationHours;
    } else {
      rawKcal =
        ((-20.4022 + 0.4472 * avgHr + 0.1263 * weightKg + 0.074 * age) /
          4.184) *
        durationHours;
    }
    return Math.max(0, Math.round(rawKcal));
  }

  // Fallback: simplified estimation
  const fallbackKcal = (avgHr / 100) * durationMinutes * 4.5;
  return Math.max(0, Math.round(fallbackKcal));
}
