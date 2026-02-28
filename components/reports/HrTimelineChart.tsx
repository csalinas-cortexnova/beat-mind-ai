"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { ZONES } from "@/lib/hr/zones";

interface HrTimelineChartProps {
  data: Array<{ recordedAt: string; heartRateBpm: number }>;
  startedAt: string;
}

export function HrTimelineChart({ data, startedAt }: HrTimelineChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-4">
        Sin datos de frecuencia cardiaca
      </p>
    );
  }

  const startTime = new Date(startedAt).getTime();

  // Convert to elapsed minutes for X-axis
  const chartData = data.map((d) => ({
    elapsed: (new Date(d.recordedAt).getTime() - startTime) / 60000,
    bpm: d.heartRateBpm,
  }));

  // Y-axis bounds with padding
  const bpmValues = chartData.map((d) => d.bpm).filter((b) => b > 0);
  const yMin = Math.max(0, Math.min(...bpmValues) - 10);
  const yMax = Math.max(...bpmValues) + 10;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart
        data={chartData}
        margin={{ left: 5, right: 5, top: 5, bottom: 5 }}
      >
        {/* Zone background bands (use approximate BPM values for maxHr=190 default) */}
        {ZONES.map((zone, i) => (
          <ReferenceArea
            key={i}
            y1={zone.minPct * 190}
            y2={zone.maxPct * 190}
            fill={zone.color}
            fillOpacity={0.08}
          />
        ))}
        <XAxis
          dataKey="elapsed"
          tick={{ fontSize: 10 }}
          tickFormatter={(v: number) => `${Math.floor(v)}'`}
        />
        <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10 }} width={35} />
        <Line
          type="monotone"
          dataKey="bpm"
          stroke="#EF4444"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
