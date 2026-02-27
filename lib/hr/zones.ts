/**
 * HR Zone computation utility.
 * Ported from burnapp/src/hr-zones.js with TypeScript + i18n (es/pt).
 */

export interface ZoneDefinition {
  zone: number;
  names: { es: string; pt: string };
  color: string;
  minPct: number;
  maxPct: number;
}

export interface ZoneResult {
  zone: number;
  zoneName: string;
  zoneColor: string;
  hrMaxPercent: number;
}

const zoneNames = {
  0: { es: "Reposo", pt: "Repouso" },
  1: { es: "Calentamiento", pt: "Aquecimento" },
  2: { es: "Quema de grasa", pt: "Queima de gordura" },
  3: { es: "Aeróbico", pt: "Aeróbico" },
  4: { es: "Umbral anaeróbico", pt: "Limiar anaeróbico" },
  5: { es: "Máximo esfuerzo", pt: "Esforço máximo" },
} as const;

export const REST_ZONE: ZoneDefinition = {
  zone: 0,
  names: zoneNames[0],
  color: "#64748B",
  minPct: 0,
  maxPct: 0.5,
};

export const ZONES: ZoneDefinition[] = [
  { zone: 1, names: zoneNames[1], color: "#3B82F6", minPct: 0.5, maxPct: 0.6 },
  { zone: 2, names: zoneNames[2], color: "#22C55E", minPct: 0.6, maxPct: 0.7 },
  { zone: 3, names: zoneNames[3], color: "#EAB308", minPct: 0.7, maxPct: 0.8 },
  { zone: 4, names: zoneNames[4], color: "#F97316", minPct: 0.8, maxPct: 0.9 },
  { zone: 5, names: zoneNames[5], color: "#EF4444", minPct: 0.9, maxPct: 1.0 },
];

/**
 * Determine HR zone for a given BPM and maxHr.
 * Returns Spanish zone names by default.
 */
export function getZone(bpm: number, maxHr: number): ZoneResult {
  return getZoneForLang(bpm, maxHr, "es");
}

/**
 * Determine HR zone with localized zone name.
 */
export function getZoneForLang(
  bpm: number,
  maxHr: number,
  lang: string
): ZoneResult {
  if (maxHr <= 0 || bpm <= 0) {
    return {
      zone: 0,
      zoneName: getName(REST_ZONE, lang),
      zoneColor: REST_ZONE.color,
      hrMaxPercent: 0,
    };
  }

  const pct = bpm / maxHr;
  const hrMaxPercent = Math.round(pct * 100);

  // Search from highest zone down
  for (let i = ZONES.length - 1; i >= 0; i--) {
    if (pct >= ZONES[i].minPct) {
      return {
        zone: ZONES[i].zone,
        zoneName: getName(ZONES[i], lang),
        zoneColor: ZONES[i].color,
        hrMaxPercent,
      };
    }
  }

  // Below zone 1 → rest
  return {
    zone: REST_ZONE.zone,
    zoneName: getName(REST_ZONE, lang),
    zoneColor: REST_ZONE.color,
    hrMaxPercent,
  };
}

/**
 * Return all zone definitions (rest + 5 training zones).
 */
export function getAllZones(): ZoneDefinition[] {
  return [REST_ZONE, ...ZONES];
}

function getName(zone: ZoneDefinition, lang: string): string {
  if (lang === "pt") return zone.names.pt;
  return zone.names.es; // default to Spanish
}
