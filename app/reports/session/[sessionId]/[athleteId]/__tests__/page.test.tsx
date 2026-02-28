import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// --- Mock setup ---
const mockValidateReportToken = vi.hoisted(() => vi.fn());
const mockDownsampleHrData = vi.hoisted(() => vi.fn());
const mockDbQuery = vi.hoisted(() => ({
  sessions: { findFirst: vi.fn() },
  gyms: { findFirst: vi.fn() },
  sessionAthletes: { findFirst: vi.fn() },
  athletes: { findFirst: vi.fn() },
}));
const mockDbSelect = vi.hoisted(() => vi.fn());

vi.mock("@/lib/reports/token", () => ({
  validateReportToken: mockValidateReportToken,
}));

vi.mock("@/lib/utils/downsample", () => ({
  downsampleHrData: mockDownsampleHrData,
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: mockDbQuery,
    select: mockDbSelect,
  },
}));

vi.mock("@/lib/db/schema", () => ({
  sessions: {},
  sessionAthletes: {},
  athletes: {},
  gyms: {},
  hrReadings: {},
  users: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((col: unknown) => col),
}));

// Mock the ReportView client component to avoid Recharts rendering issues
vi.mock("../ReportView", () => ({
  default: (props: {
    gym: { name: string };
    session: { classType?: string | null; duration: string; aiSummary?: string | null };
    athlete: { name: string; avgHr: number; maxHr: number; minHr: number; calories: number };
    zoneData: Array<{ zone: number; name: string; color: string; seconds: number }>;
    hrData: Array<{ recordedAt: string; heartRateBpm: number }>;
  }) => (
    <div data-testid="report-view">
      <span data-testid="athlete-name">{props.athlete.name}</span>
      <span data-testid="gym-name">{props.gym.name}</span>
      <span data-testid="avg-hr">{props.athlete.avgHr}</span>
      <span data-testid="max-hr">{props.athlete.maxHr}</span>
      <span data-testid="calories">{props.athlete.calories}</span>
      <span data-testid="duration">{props.session.duration}</span>
      <span data-testid="class-type">{props.session.classType}</span>
      {props.session.aiSummary && (
        <span data-testid="ai-summary">{props.session.aiSummary}</span>
      )}
    </div>
  ),
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

import ReportPage from "../page";

describe("ReportPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const sessionId = "550e8400-e29b-41d4-a716-446655440001";
  const athleteId = "550e8400-e29b-41d4-a716-446655440002";
  const gymId = "550e8400-e29b-41d4-a716-446655440003";
  const token = "valid.token.signature";

  function setupValidMocks() {
    mockValidateReportToken.mockReturnValue({ sessionId, athleteId, gymId });

    mockDbQuery.sessions.findFirst.mockResolvedValue({
      id: sessionId,
      classType: "HIIT",
      status: "completed",
      startedAt: new Date("2026-02-27T10:00:00Z"),
      endedAt: new Date("2026-02-27T10:45:00Z"),
      durationSeconds: 2700,
      athleteCount: 5,
      aiSummary: "Great session! Athletes pushed hard.",
    });

    mockDbQuery.gyms.findFirst.mockResolvedValue({
      id: gymId,
      name: "PowerFit Gym",
      logoUrl: "https://example.com/logo.png",
      primaryColor: "#FF5500",
      secondaryColor: "#1A1A2E",
    });

    mockDbQuery.sessionAthletes.findFirst.mockResolvedValue({
      avgHr: 145,
      maxHr: 178,
      minHr: 95,
      calories: 380,
      timeZone1S: 120,
      timeZone2S: 300,
      timeZone3S: 600,
      timeZone4S: 240,
      timeZone5S: 60,
    });

    mockDbQuery.athletes.findFirst.mockResolvedValue({
      id: athleteId,
      name: "Maria Lopez",
    });

    // Mock db.select() chain for HR readings
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([
        { heartRateBpm: 120, recordedAt: new Date("2026-02-27T10:01:00Z") },
        { heartRateBpm: 145, recordedAt: new Date("2026-02-27T10:02:00Z") },
        { heartRateBpm: 160, recordedAt: new Date("2026-02-27T10:03:00Z") },
      ]),
    };
    mockDbSelect.mockReturnValue(selectChain);

    mockDownsampleHrData.mockReturnValue([
      { recordedAt: "2026-02-27T10:01:00.000Z", heartRateBpm: 120 },
      { recordedAt: "2026-02-27T10:02:00.000Z", heartRateBpm: 145 },
      { recordedAt: "2026-02-27T10:03:00.000Z", heartRateBpm: 160 },
    ]);
  }

  it("should render report with athlete name and stats for valid token", async () => {
    setupValidMocks();

    const result = await ReportPage({
      params: Promise.resolve({ sessionId, athleteId }),
      searchParams: Promise.resolve({ token }),
    });

    render(result);

    expect(screen.getByTestId("report-view")).toBeDefined();
    expect(screen.getByTestId("athlete-name").textContent).toBe("Maria Lopez");
    expect(screen.getByTestId("gym-name").textContent).toBe("PowerFit Gym");
    expect(screen.getByTestId("avg-hr").textContent).toBe("145");
    expect(screen.getByTestId("max-hr").textContent).toBe("178");
    expect(screen.getByTestId("calories").textContent).toBe("380");
    expect(screen.getByTestId("duration").textContent).toBe("45:00");
    expect(screen.getByTestId("class-type").textContent).toBe("HIIT");
    expect(screen.getByTestId("ai-summary").textContent).toBe("Great session! Athletes pushed hard.");
  });

  it("should show error when token is missing", async () => {
    const result = await ReportPage({
      params: Promise.resolve({ sessionId, athleteId }),
      searchParams: Promise.resolve({}),
    });

    render(result);

    expect(screen.getByText("Reporte no disponible")).toBeDefined();
    expect(screen.getByText("Token de acceso no proporcionado.")).toBeDefined();
    expect(screen.queryByTestId("report-view")).toBeNull();
  });

  it("should show error when token is invalid (validateReportToken returns null)", async () => {
    mockValidateReportToken.mockReturnValue(null);

    const result = await ReportPage({
      params: Promise.resolve({ sessionId, athleteId }),
      searchParams: Promise.resolve({ token: "expired.token.sig" }),
    });

    render(result);

    expect(screen.getByText("Reporte no disponible")).toBeDefined();
    expect(
      screen.getByText("Este reporte ya no esta disponible. Contacta a tu gimnasio para un nuevo enlace.")
    ).toBeDefined();
    expect(screen.queryByTestId("report-view")).toBeNull();
  });

  it("should show error when token does not match URL params", async () => {
    mockValidateReportToken.mockReturnValue({
      sessionId: "550e8400-e29b-41d4-a716-446655440099",
      athleteId: "550e8400-e29b-41d4-a716-446655440098",
      gymId,
    });

    const result = await ReportPage({
      params: Promise.resolve({ sessionId, athleteId }),
      searchParams: Promise.resolve({ token }),
    });

    render(result);

    expect(screen.getByText("Reporte no disponible")).toBeDefined();
    expect(screen.getByText("Token no valido para este reporte.")).toBeDefined();
    expect(screen.queryByTestId("report-view")).toBeNull();
  });
});
