"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ResponsiveContainer,
  LabelList,
} from "recharts";

interface ZoneDistributionChartProps {
  data: Array<{ zone: number; name: string; color: string; seconds: number }>;
}

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function ZoneDistributionChart({ data }: ZoneDistributionChartProps) {
  if (data.every((d) => d.seconds === 0)) {
    return (
      <p className="text-sm text-gray-400 text-center py-4">
        Sin datos de zonas
      </p>
    );
  }

  const chartData = data.map((d) => ({
    name: `Z${d.zone}`,
    seconds: d.seconds,
    color: d.color,
    label: formatSeconds(d.seconds),
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ left: 30, right: 50, top: 5, bottom: 5 }}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 12 }}
          width={30}
        />
        <Bar dataKey="seconds" radius={[0, 4, 4, 0]}>
          {chartData.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
          <LabelList
            dataKey="label"
            position="right"
            style={{ fontSize: 11, fill: "#6B7280" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
