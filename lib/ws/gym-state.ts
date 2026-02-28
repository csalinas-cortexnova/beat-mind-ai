/**
 * GymStateManager — in-memory cache of per-gym state.
 *
 * Loads gym config, athlete-band mappings, and active session from DB on first
 * access. Enriches incoming HR data with athlete profiles and HR zones.
 * Periodically refreshes athlete mappings and evicts idle gyms.
 */

import { db } from "@/lib/db";
import { gyms, athleteBands, athletes, sessions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getZoneForLang } from "@/lib/hr/zones";
import { log } from "@/lib/logger";
import type {
  GymState,
  GymConfig,
  AthleteProfile,
  ActiveSession,
  EnrichedDeviceData,
  HRReadingInsert,
  ProcessHRDataResult,
} from "./types";

export class GymStateManager {
  private states: Map<string, GymState> = new Map();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Start periodic refresh (5 min) and eviction (60s) timers.
   */
  start(): void {
    this.refreshTimer = setInterval(() => this.refreshAll(), 5 * 60 * 1000);
    this.evictionTimer = setInterval(() => this.evictIdle(), 60 * 1000);
  }

  /**
   * Return cached state or load from DB.
   */
  async getOrLoadState(gymId: string): Promise<GymState> {
    const existing = this.states.get(gymId);
    if (existing) return existing;
    return this.loadState(gymId);
  }

  // ─── Private: Load State From DB ──────────────────────────────────────────

  private async loadState(gymId: string): Promise<GymState> {
    // 1. Load gym config
    const gymRows = await db
      .select({
        name: gyms.name,
        language: gyms.language,
        timezone: gyms.timezone,
        logoUrl: gyms.logoUrl,
        primaryColor: gyms.primaryColor,
        secondaryColor: gyms.secondaryColor,
        subscriptionStatus: gyms.subscriptionStatus,
      })
      .from(gyms)
      .where(eq(gyms.id, gymId));

    if (gymRows.length === 0) {
      throw new Error(`Gym not found: ${gymId}`);
    }

    const row = gymRows[0];
    const config: GymConfig = {
      name: row.name,
      language: row.language,
      timezone: row.timezone,
      logoUrl: row.logoUrl,
      primaryColor: row.primaryColor || "#000000",
      secondaryColor: row.secondaryColor || "#FFFFFF",
      subscriptionStatus: row.subscriptionStatus,
    };

    // 2. Load athlete-band mappings
    const bandRows = await db
      .select({
        sensorId: athleteBands.sensorId,
        athleteId: athleteBands.athleteId,
        name: athletes.name,
        maxHr: athletes.maxHr,
        age: athletes.age,
      })
      .from(athleteBands)
      .innerJoin(athletes, eq(athleteBands.athleteId, athletes.id))
      .where(and(eq(athleteBands.gymId, gymId), eq(athleteBands.isActive, true)));

    const sensorAthleteMap = new Map<number, AthleteProfile>();
    for (const r of bandRows) {
      sensorAthleteMap.set(r.sensorId, {
        id: r.athleteId,
        name: r.name,
        maxHr: r.maxHr,
        age: r.age,
      });
    }

    // 3. Load active session
    const sessionRows = await db
      .select({
        id: sessions.id,
        classType: sessions.classType,
        startedAt: sessions.startedAt,
      })
      .from(sessions)
      .where(and(eq(sessions.gymId, gymId), eq(sessions.status, "active")));

    let activeSession: ActiveSession | null = null;
    if (sessionRows.length > 0) {
      const s = sessionRows[0];
      activeSession = {
        id: s.id,
        classType: s.classType,
        startedAt:
          s.startedAt instanceof Date
            ? s.startedAt.toISOString()
            : String(s.startedAt),
      };
    }

    const now = Date.now();
    const state: GymState = {
      gymId,
      config,
      sensorAthleteMap,
      activeSession,
      lastActivity: now,
      lastRefresh: now,
      deviceLastSeen: new Map(),
    };

    this.states.set(gymId, state);
    log.debug("GymStateManager: loaded state", {
      module: "gym-state",
      gymId,
      athletes: sensorAthleteMap.size,
      hasSession: activeSession !== null,
    });

    return state;
  }

  // ─── Language Normalization ───────────────────────────────────────────────

  /**
   * Normalize gym language for zone lookup.
   * getZoneForLang checks `lang === "pt"` literally, so "pt-BR" must become "pt".
   */
  private normalizeLang(lang: string): string {
    if (lang.startsWith("pt")) return "pt";
    if (lang.startsWith("es")) return "es";
    return "es"; // default to Spanish
  }

  // ─── HR Data Processing ───────────────────────────────────────────────────

  /**
   * Enrich raw device data with athlete profiles, HR zones, and generate
   * DB-ready HR reading inserts.
   */
  processHRData(
    state: GymState,
    devices: Record<string, { bpm: number; deviceActive: boolean }>,
    timestamp: string
  ): ProcessHRDataResult {
    const enriched: EnrichedDeviceData[] = [];
    const readings: HRReadingInsert[] = [];
    const now = Date.now();
    const lang = this.normalizeLang(state.config.language);
    const beatTime = new Date(timestamp);

    for (const [sensorIdStr, device] of Object.entries(devices)) {
      const sensorId = Number(sensorIdStr);
      state.deviceLastSeen.set(sensorId, now);

      const athlete = state.sensorAthleteMap.get(sensorId);
      const zone = getZoneForLang(device.bpm, athlete?.maxHr ?? 190, lang);

      enriched.push({
        sensorId,
        athleteId: athlete?.id ?? null,
        athleteName: athlete?.name ?? null,
        bpm: device.bpm,
        zone: zone.zone,
        zoneName: zone.zoneName,
        zoneColor: zone.zoneColor,
        hrMaxPercent: zone.hrMaxPercent,
        deviceActive: device.deviceActive,
      });

      // Only create HR reading for mapped athletes with bpm > 0 and active session
      if (athlete && device.bpm > 0 && state.activeSession) {
        readings.push({
          sessionId: state.activeSession.id,
          gymId: state.gymId,
          athleteId: athlete.id,
          sensorId,
          heartRateBpm: device.bpm,
          hrZone: zone.zone,
          hrZoneName: zone.zoneName,
          hrZoneColor: zone.zoneColor,
          hrMaxPercent: String(zone.hrMaxPercent),
          beatTime,
          beatCount: 0,
          deviceActive: device.deviceActive,
        });
      }
    }

    // Mark absent devices (not in current payload, last seen > 5s ago)
    const ABSENT_THRESHOLD = 5000;
    for (const [seenSensorId, lastSeen] of state.deviceLastSeen.entries()) {
      if (
        !(String(seenSensorId) in devices) &&
        now - lastSeen > ABSENT_THRESHOLD
      ) {
        const athlete = state.sensorAthleteMap.get(seenSensorId);
        enriched.push({
          sensorId: seenSensorId,
          athleteId: athlete?.id ?? null,
          athleteName: athlete?.name ?? null,
          bpm: 0,
          zone: 0,
          zoneName: "",
          zoneColor: "",
          hrMaxPercent: 0,
          deviceActive: false,
        });
      }
    }

    state.lastActivity = now;
    return { enriched, readings };
  }

  // ─── Refresh ──────────────────────────────────────────────────────────────

  /**
   * Reload athlete-band mappings for a single gym.
   */
  async refreshMappings(gymId: string): Promise<void> {
    const state = this.states.get(gymId);
    if (!state) return;

    const bandRows = await db
      .select({
        sensorId: athleteBands.sensorId,
        athleteId: athleteBands.athleteId,
        name: athletes.name,
        maxHr: athletes.maxHr,
        age: athletes.age,
      })
      .from(athleteBands)
      .innerJoin(athletes, eq(athleteBands.athleteId, athletes.id))
      .where(
        and(eq(athleteBands.gymId, gymId), eq(athleteBands.isActive, true))
      );

    state.sensorAthleteMap.clear();
    for (const row of bandRows) {
      state.sensorAthleteMap.set(row.sensorId, {
        id: row.athleteId,
        name: row.name,
        maxHr: row.maxHr,
        age: row.age,
      });
    }
    state.lastRefresh = Date.now();
    log.debug("GymStateManager: refreshed mappings", {
      module: "gym-state",
      gymId,
      athletes: state.sensorAthleteMap.size,
    });
  }

  /**
   * Refresh all cached gyms (called by 5-minute timer).
   */
  private async refreshAll(): Promise<void> {
    for (const gymId of this.states.keys()) {
      try {
        await this.refreshMappings(gymId);
      } catch (err) {
        log.error("GymStateManager: refresh failed", {
          module: "gym-state",
          gymId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ─── Cache Management ─────────────────────────────────────────────────────

  /**
   * Remove cached state for a gym. Next getOrLoadState() will reload from DB.
   */
  invalidateCache(gymId: string): void {
    this.states.delete(gymId);
    log.debug("GymStateManager: cache invalidated", {
      module: "gym-state",
      gymId,
    });
  }

  /**
   * Evict gyms idle for more than 10 minutes.
   */
  evictIdle(): void {
    const IDLE_THRESHOLD = 10 * 60 * 1000; // 10 min
    const now = Date.now();
    for (const [gymId, state] of this.states.entries()) {
      if (now - state.lastActivity > IDLE_THRESHOLD) {
        this.states.delete(gymId);
        log.info("GymStateManager: evicted idle gym", {
          module: "gym-state",
          gymId,
        });
      }
    }
  }

  // ─── Session Accessors ────────────────────────────────────────────────────

  getActiveSession(gymId: string): ActiveSession | null {
    return this.states.get(gymId)?.activeSession ?? null;
  }

  setActiveSession(gymId: string, session: ActiveSession): void {
    const state = this.states.get(gymId);
    if (state) state.activeSession = session;
  }

  clearActiveSession(gymId: string): void {
    const state = this.states.get(gymId);
    if (state) state.activeSession = null;
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  getStats(): { activeGyms: number } {
    return { activeGyms: this.states.size };
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Stop timers and clear all state.
   */
  shutdown(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    this.refreshTimer = null;
    this.evictionTimer = null;
    this.states.clear();
    log.info("GymStateManager: shutdown complete", { module: "gym-state" });
  }
}
