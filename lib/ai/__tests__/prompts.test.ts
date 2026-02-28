import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildPostSessionSystemPrompt,
  buildPostSessionUserPrompt,
} from "../prompts";
import type { AthleteSummary, PostSessionAthleteStats } from "../types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockAthlete: AthleteSummary = {
  athleteId: "550e8400-e29b-41d4-a716-446655440001",
  athleteName: "Carlos López",
  avgBpm: 145,
  maxBpm: 172,
  minBpm: 98,
  currentZoneName: "Aeróbico",
  readingsCount: 60,
  timeByZone: { "Z3 Aeróbico": "5min", "Z4 Umbral anaeróbico": "3min" },
  trend: "rising",
};

const mockAthlete2: AthleteSummary = {
  athleteId: "550e8400-e29b-41d4-a716-446655440002",
  athleteName: "Maria Silva",
  avgBpm: 128,
  maxBpm: 155,
  minBpm: 85,
  currentZoneName: "Quema de grasa",
  readingsCount: 45,
  timeByZone: { "Z2 Quema de grasa": "7min" },
  trend: "stable",
};

const mockPostSessionAthlete: PostSessionAthleteStats = {
  athleteId: "550e8400-e29b-41d4-a716-446655440001",
  athleteName: "Carlos López",
  avgHr: 142,
  maxHr: 172,
  minHr: 95,
  readingsCount: 360,
  timeByZone: {
    "Z2 Quema de grasa": "10min",
    "Z3 Aeróbico": "15min",
    "Z4 Umbral anaeróbico": "5min",
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  it("includes Spanish directive for es language", () => {
    const prompt = buildSystemPrompt("es");
    expect(prompt).toContain("Responde en español");
    expect(prompt).toContain("motivador");
    expect(prompt).toContain("2-3 oraciones");
  });

  it("includes Portuguese directive for pt language", () => {
    const prompt = buildSystemPrompt("pt");
    expect(prompt).toContain("Responda em português");
    expect(prompt).toContain("motivador");
    expect(prompt).toContain("2-3 frases");
  });

  it("includes Coach Pulse identity and rules", () => {
    const prompt = buildSystemPrompt("es");
    expect(prompt).toContain("Coach Pulse");
    expect(prompt).toContain("avgBpm");
    expect(prompt).toContain("NUNCA un BPM puntual");
    expect(prompt).toContain("zona actual");
    expect(prompt).toContain("tendencia");
  });
});

describe("buildUserPrompt", () => {
  it("includes class type label when provided", () => {
    const prompt = buildUserPrompt([mockAthlete], "spinning");
    expect(prompt).toContain("Tipo de clase: spinning");
  });

  it("omits class type label when null", () => {
    const prompt = buildUserPrompt([mockAthlete], null);
    expect(prompt).not.toContain("Tipo de clase");
  });

  it("formats athlete data as JSON", () => {
    const prompt = buildUserPrompt([mockAthlete], null);
    expect(prompt).toContain('"athleteName": "Carlos López"');
    expect(prompt).toContain('"avgBpm": 145');
    expect(prompt).toContain('"trend": "rising"');
  });

  it("includes all athletes when multiple provided", () => {
    const prompt = buildUserPrompt([mockAthlete, mockAthlete2], "spinning");
    expect(prompt).toContain("Carlos López");
    expect(prompt).toContain("Maria Silva");
    expect(prompt).toContain('"avgBpm": 128');
  });
});

describe("buildPostSessionSystemPrompt", () => {
  it("includes Spanish directive for es language", () => {
    const prompt = buildPostSessionSystemPrompt("es");
    expect(prompt).toContain("Responde en español");
    expect(prompt).toContain("profesional y motivador");
  });

  it("includes Portuguese directive for pt language", () => {
    const prompt = buildPostSessionSystemPrompt("pt");
    expect(prompt).toContain("Responda em português");
    expect(prompt).toContain("profissional e motivador");
  });
});

describe("buildPostSessionUserPrompt", () => {
  it("includes duration in minutes and athlete count", () => {
    const prompt = buildPostSessionUserPrompt(1800, 5, [
      mockPostSessionAthlete,
    ]);
    expect(prompt).toContain("30 minutos");
    expect(prompt).toContain("5");
  });

  it("formats athlete stats as JSON", () => {
    const prompt = buildPostSessionUserPrompt(1800, 1, [
      mockPostSessionAthlete,
    ]);
    expect(prompt).toContain('"athleteName": "Carlos López"');
    expect(prompt).toContain('"avgHr": 142');
    expect(prompt).toContain('"maxHr": 172');
    expect(prompt).toContain("Z3 Aeróbico");
  });
});
