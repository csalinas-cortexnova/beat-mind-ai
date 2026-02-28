interface HrDataPoint {
  recordedAt: string;
  heartRateBpm: number;
}

/**
 * Downsample HR data using 10-second bucket averaging.
 * Returns at most `maxPoints` data points.
 */
export function downsampleHrData(
  data: HrDataPoint[],
  maxPoints = 720
): HrDataPoint[] {
  if (data.length <= maxPoints) return data;

  // Group into 10-second buckets
  const buckets = new Map<number, HrDataPoint[]>();

  for (const point of data) {
    const ts = new Date(point.recordedAt).getTime();
    const bucketKey = Math.floor(ts / 10000) * 10000; // 10-second bucket
    const bucket = buckets.get(bucketKey);
    if (bucket) {
      bucket.push(point);
    } else {
      buckets.set(bucketKey, [point]);
    }
  }

  // Average each bucket
  const result: HrDataPoint[] = [];
  const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);

  for (const key of sortedKeys) {
    const points = buckets.get(key)!;
    const avgBpm = Math.round(
      points.reduce((sum, p) => sum + p.heartRateBpm, 0) / points.length
    );
    result.push({
      recordedAt: new Date(key).toISOString(),
      heartRateBpm: avgBpm,
    });
  }

  return result;
}
