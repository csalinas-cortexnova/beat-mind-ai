// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getZone, getZoneForLang, getAllZones, ZONES, REST_ZONE } from "../zones";

describe("HR Zone Constants", () => {
  it("should have 5 training zones plus rest zone", () => {
    expect(ZONES).toHaveLength(5);
    expect(REST_ZONE.zone).toBe(0);
  });

  it("should have zones numbered 1-5", () => {
    expect(ZONES.map((z) => z.zone)).toEqual([1, 2, 3, 4, 5]);
  });

  it("should have valid hex colors", () => {
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    for (const z of [REST_ZONE, ...ZONES]) {
      expect(z.color).toMatch(hexRegex);
    }
  });

  it("should have contiguous percentage ranges", () => {
    expect(REST_ZONE.maxPct).toBe(0.5);
    expect(ZONES[0].minPct).toBe(0.5);
    for (let i = 1; i < ZONES.length; i++) {
      expect(ZONES[i].minPct).toBe(ZONES[i - 1].maxPct);
    }
    expect(ZONES[ZONES.length - 1].maxPct).toBe(1.0);
  });
});

describe("getZone", () => {
  const MAX_HR = 200;

  // Zone boundary tests
  it("should return zone 0 (rest) for bpm below 50% of maxHr", () => {
    const result = getZone(99, MAX_HR); // 49.5%
    expect(result.zone).toBe(0);
    expect(result.zoneColor).toBe("#64748B");
  });

  it("should return zone 1 at exactly 50% of maxHr", () => {
    const result = getZone(100, MAX_HR); // 50%
    expect(result.zone).toBe(1);
    expect(result.zoneColor).toBe("#3B82F6");
  });

  it("should return zone 2 at exactly 60% of maxHr", () => {
    const result = getZone(120, MAX_HR); // 60%
    expect(result.zone).toBe(2);
    expect(result.zoneColor).toBe("#22C55E");
  });

  it("should return zone 3 at exactly 70% of maxHr", () => {
    const result = getZone(140, MAX_HR); // 70%
    expect(result.zone).toBe(3);
    expect(result.zoneColor).toBe("#EAB308");
  });

  it("should return zone 4 at exactly 80% of maxHr", () => {
    const result = getZone(160, MAX_HR); // 80%
    expect(result.zone).toBe(4);
    expect(result.zoneColor).toBe("#F97316");
  });

  it("should return zone 5 at exactly 90% of maxHr", () => {
    const result = getZone(180, MAX_HR); // 90%
    expect(result.zone).toBe(5);
    expect(result.zoneColor).toBe("#EF4444");
  });

  it("should return zone 5 at 100% of maxHr", () => {
    const result = getZone(200, MAX_HR); // 100%
    expect(result.zone).toBe(5);
    expect(result.zoneColor).toBe("#EF4444");
  });

  it("should still return zone 5 when bpm exceeds maxHr", () => {
    const result = getZone(220, MAX_HR); // 110%
    expect(result.zone).toBe(5);
    expect(result.hrMaxPercent).toBe(110);
  });

  // Percentage calculation
  it("should calculate hrMaxPercent correctly", () => {
    const result = getZone(150, MAX_HR); // 75%
    expect(result.hrMaxPercent).toBe(75);
  });

  it("should round hrMaxPercent to nearest integer", () => {
    const result = getZone(133, MAX_HR); // 66.5%
    expect(result.hrMaxPercent).toBe(67);
  });

  // Edge cases
  it("should return zone 0 with 0% for bpm=0", () => {
    const result = getZone(0, MAX_HR);
    expect(result.zone).toBe(0);
    expect(result.hrMaxPercent).toBe(0);
  });

  it("should return zone 0 with 0% for maxHr=0", () => {
    const result = getZone(100, 0);
    expect(result.zone).toBe(0);
    expect(result.hrMaxPercent).toBe(0);
  });

  it("should return zone 0 with 0% for negative bpm", () => {
    const result = getZone(-10, MAX_HR);
    expect(result.zone).toBe(0);
    expect(result.hrMaxPercent).toBe(0);
  });

  it("should return zone 0 with 0% for negative maxHr", () => {
    const result = getZone(100, -10);
    expect(result.zone).toBe(0);
    expect(result.hrMaxPercent).toBe(0);
  });

  // Default language is "es"
  it("should return Spanish zone names by default", () => {
    const result = getZone(100, MAX_HR);
    expect(result.zoneName).toBe("Calentamiento");
  });
});

describe("getZoneForLang", () => {
  const MAX_HR = 200;

  it("should return Spanish names for lang=es", () => {
    expect(getZoneForLang(99, MAX_HR, "es").zoneName).toBe("Reposo");
    expect(getZoneForLang(100, MAX_HR, "es").zoneName).toBe("Calentamiento");
    expect(getZoneForLang(120, MAX_HR, "es").zoneName).toBe("Quema de grasa");
    expect(getZoneForLang(140, MAX_HR, "es").zoneName).toBe("Aeróbico");
    expect(getZoneForLang(160, MAX_HR, "es").zoneName).toBe("Umbral anaeróbico");
    expect(getZoneForLang(180, MAX_HR, "es").zoneName).toBe("Máximo esfuerzo");
  });

  it("should return Portuguese names for lang=pt", () => {
    expect(getZoneForLang(99, MAX_HR, "pt").zoneName).toBe("Repouso");
    expect(getZoneForLang(100, MAX_HR, "pt").zoneName).toBe("Aquecimento");
    expect(getZoneForLang(120, MAX_HR, "pt").zoneName).toBe("Queima de gordura");
    expect(getZoneForLang(140, MAX_HR, "pt").zoneName).toBe("Aeróbico");
    expect(getZoneForLang(160, MAX_HR, "pt").zoneName).toBe("Limiar anaeróbico");
    expect(getZoneForLang(180, MAX_HR, "pt").zoneName).toBe("Esforço máximo");
  });

  it("should default to Spanish for unknown language", () => {
    const result = getZoneForLang(100, MAX_HR, "fr");
    expect(result.zoneName).toBe("Calentamiento");
  });
});

describe("getAllZones", () => {
  it("should return 6 zones (rest + 5 training)", () => {
    const zones = getAllZones();
    expect(zones).toHaveLength(6);
    expect(zones[0].zone).toBe(0);
    expect(zones[5].zone).toBe(5);
  });

  it("should include all required fields", () => {
    const zones = getAllZones();
    for (const z of zones) {
      expect(z).toHaveProperty("zone");
      expect(z).toHaveProperty("names");
      expect(z).toHaveProperty("color");
      expect(z).toHaveProperty("minPct");
      expect(z).toHaveProperty("maxPct");
      expect(z.names).toHaveProperty("es");
      expect(z.names).toHaveProperty("pt");
    }
  });
});
