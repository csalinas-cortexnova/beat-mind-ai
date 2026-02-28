export type TrendDirection = "improving" | "stable" | "declining";

/**
 * Calculate trend direction from a numeric series using
 * simple linear regression slope comparison.
 * Returns "improving", "stable", or "declining".
 */
export function calculateTrend(values: number[]): TrendDirection {
  if (values.length <= 1) return "stable";

  // Simple linear regression slope
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // Normalize slope by average value to determine significance
  const avg = sumY / n;
  if (avg === 0) return "stable";

  const normalizedSlope = slope / avg;

  // Threshold: ~5% change per period
  if (normalizedSlope > 0.03) return "improving";
  if (normalizedSlope < -0.03) return "declining";
  return "stable";
}
