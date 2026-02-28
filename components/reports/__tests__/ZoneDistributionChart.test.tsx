import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Cell: () => null,
  LabelList: () => null,
}));

import { ZoneDistributionChart } from "../ZoneDistributionChart";

describe("ZoneDistributionChart", () => {
  afterEach(cleanup);

  it("should render chart container when data has values", () => {
    const data = [
      { zone: 1, name: "Calentamiento", color: "#3B82F6", seconds: 120 },
      { zone: 2, name: "Quema de grasa", color: "#22C55E", seconds: 300 },
      { zone: 3, name: "Aerobico", color: "#EAB308", seconds: 240 },
      { zone: 4, name: "Umbral anaerobico", color: "#F97316", seconds: 60 },
      { zone: 5, name: "Maximo esfuerzo", color: "#EF4444", seconds: 30 },
    ];

    render(<ZoneDistributionChart data={data} />);
    expect(screen.getByTestId("chart-container")).toBeDefined();
    expect(screen.getByTestId("bar-chart")).toBeDefined();
  });

  it('should show "Sin datos" message when all values are 0', () => {
    const data = [
      { zone: 1, name: "Calentamiento", color: "#3B82F6", seconds: 0 },
      { zone: 2, name: "Quema de grasa", color: "#22C55E", seconds: 0 },
      { zone: 3, name: "Aerobico", color: "#EAB308", seconds: 0 },
      { zone: 4, name: "Umbral anaerobico", color: "#F97316", seconds: 0 },
      { zone: 5, name: "Maximo esfuerzo", color: "#EF4444", seconds: 0 },
    ];

    render(<ZoneDistributionChart data={data} />);
    expect(screen.getByText("Sin datos de zonas")).toBeDefined();
    expect(screen.queryByTestId("chart-container")).toBeNull();
  });
});
