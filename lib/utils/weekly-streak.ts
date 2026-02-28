/**
 * Calculate consecutive weekly streak from an array of week-start date strings.
 * Weeks are identified by their Monday date (ISO week start).
 * Returns the number of consecutive weeks ending at the most recent week.
 */
export function calculateWeeklyStreak(weekStarts: string[]): number {
  if (weekStarts.length === 0) return 0;

  // Deduplicate and sort descending
  const unique = [...new Set(weekStarts)].sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  );

  let streak = 1;
  for (let i = 1; i < unique.length; i++) {
    const current = new Date(unique[i - 1]).getTime();
    const previous = new Date(unique[i]).getTime();
    const diffDays = (current - previous) / (1000 * 60 * 60 * 24);

    if (Math.abs(diffDays - 7) < 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}
