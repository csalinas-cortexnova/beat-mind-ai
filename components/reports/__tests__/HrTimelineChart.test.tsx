import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ReferenceArea: () => null,
}));

vi.mock("@/lib/hr/zones", () => ({
  ZONES: [
    { zone: 1, names: { es: "Calentamiento", pt: "Aquecimento" }, color: "#3B82F6", minPct: 0.5, maxPct: 0.6 },
    { zone: 2, names: { es: "Quema de grasa", pt: "Queima de gordura" }, color: "#22C55E", minPct: 0.6, maxPct: 0.7 },
    { zone: 3, names: { es: "Aerobico", pt: "Aerobico" }, color: "#EAB308", minPct: 0.7, maxPct: 0.8 },
    { zone: 4, names: { es: "Umbral anaerobico", pt: "Limiar anaerobico" }, color: "#F97316", minPct: 0.8, maxPct: 0.9 },
    { zone: 5, names: { es: "Maximo esfuerzo", pt: "Esforco maximo" }, color: "#EF4444", minPct: 0.9, maxPct: 1.0 },
  ],
}));

import { HrTimelineChart } from "../HrTimelineChart";

describe("HrTimelineChart", () => {
  afterEach(cleanup);

  it("should render chart container when data is provided", () => {
    const data = [
      { recordedAt: "2026-02-27T10:00:00.000Z", heartRateBpm: 120 },
      { recordedAt: "2026-02-27T10:01:00.000Z", heartRateBpm: 135 },
      { recordedAt: "2026-02-27T10:02:00.000Z", heartRateBpm: 150 },
    ];

    render(<HrTimelineChart data={data} startedAt="2026-02-27T10:00:00.000Z" />);
    expect(screen.getByTestId("chart-container")).toBeDefined();
    expect(screen.getByTestId("line-chart")).toBeDefined();
  });

  it('should show "Sin datos" message when data is empty', () => {
    render(<HrTimelineChart data={[]} startedAt="2026-02-27T10:00:00.000Z" />);
    expect(screen.getByText("Sin datos de frecuencia cardiaca")).toBeDefined();
    expect(screen.queryByTestId("chart-container")).toBeNull();
  });
});
