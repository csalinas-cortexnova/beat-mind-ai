/**
 * AI Coaching Service (Coach Pulse) — Core engine.
 *
 * Manages analysis timers per session, queries HR data, calls OpenAI,
 * stores messages, and broadcasts to TV displays.
 */

import OpenAI from "openai";
import { db } from "@/lib/db";
import {
  hrReadings,
  athletes,
  sessions,
  gyms,
  aiCoachingMessages,
} from "@/lib/db/schema";
import { eq, and, gte, gt, desc } from "drizzle-orm";
import { log } from "@/lib/logger";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildPostSessionSystemPrompt,
  buildPostSessionUserPrompt,
} from "./prompts";
import type {
  CoachingConfig,
  AthleteSummary,
  PostSessionAthleteStats,
  SessionTimerState,
  CoachBroadcastFn,
} from "./types";
import type { TvCoachMessage } from "@/lib/ws/types";

// ─── OpenAI Client (singleton) ──────────────────────────────────────────────

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 10_000,
      maxRetries: 0,
    });
  }
  return openaiClient;
}

// ─── Active Timers ──────────────────────────────────────────────────────────

const activeTimers = new Map<string, SessionTimerState>();

// ─── Config Builder ─────────────────────────────────────────────────────────

/**
 * Build coaching config from env vars and gym settings.
 */
export function getCoachingConfig(gym: {
  language: string;
  classType?: string | null;
}): CoachingConfig {
  const rawLang = gym.language || "es";
  const language: "es" | "pt" = rawLang.startsWith("pt") ? "pt" : "es";

  return {
    enabled: !!process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    intervalMs: parseInt(process.env.AI_ANALYSIS_INTERVAL_MS || "60000", 10),
    warmupPeriodMs: parseInt(process.env.AI_WARMUP_MS || "60000", 10),
    analysisMinutes: parseInt(process.env.AI_ANALYSIS_MINUTES || "10", 10),
    language,
    classType: gym.classType ?? null,
  };
}

// ─── Timer Management ───────────────────────────────────────────────────────

/**
 * Start a coaching analysis timer for a session.
 */
export function startCoachingTimer(
  sessionId: string,
  gymId: string,
  config: CoachingConfig,
  broadcastFn: CoachBroadcastFn
): void {
  if (!config.enabled) {
    log.debug("Coaching disabled, skipping timer", {
      module: "ai-coach",
      sessionId,
    });
    return;
  }

  if (activeTimers.has(sessionId)) {
    log.warn("Coaching timer already active for session", {
      module: "ai-coach",
      sessionId,
    });
    return;
  }

  const timer = setInterval(
    () =>
      runAnalysisCycle(sessionId, gymId, config, broadcastFn).catch((err) => {
        log.error("Analysis cycle uncaught error", {
          module: "ai-coach",
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }),
    config.intervalMs
  );

  activeTimers.set(sessionId, {
    sessionId,
    gymId,
    config,
    timer,
    startedAt: Date.now(),
    broadcastFn,
  });

  log.info("Coaching timer started", {
    module: "ai-coach",
    sessionId,
    gymId,
    intervalMs: config.intervalMs,
    warmupPeriodMs: config.warmupPeriodMs,
  });
}

/**
 * Stop coaching timer for a session.
 */
export function stopCoachingTimer(sessionId: string): void {
  const state = activeTimers.get(sessionId);
  if (!state) return;

  clearInterval(state.timer);
  activeTimers.delete(sessionId);

  log.info("Coaching timer stopped", {
    module: "ai-coach",
    sessionId,
  });
}

/**
 * Stop all active coaching timers (used during shutdown).
 */
export function stopAllTimers(): void {
  for (const [sessionId, state] of activeTimers) {
    clearInterval(state.timer);
    log.debug("Stopped coaching timer", { module: "ai-coach", sessionId });
  }
  activeTimers.clear();
}

/**
 * Get count of active timers (for testing/monitoring).
 */
export function getActiveTimerCount(): number {
  return activeTimers.size;
}

// ─── Analysis Cycle ─────────────────────────────────────────────────────────

/**
 * Run a single analysis cycle for a session.
 * Exported for testing.
 */
export async function runAnalysisCycle(
  sessionId: string,
  gymId: string,
  config: CoachingConfig,
  broadcastFn: CoachBroadcastFn
): Promise<void> {
  const timerState = activeTimers.get(sessionId);

  // Check warmup period
  if (timerState && Date.now() - timerState.startedAt < config.warmupPeriodMs) {
    log.debug("Warmup period active, skipping analysis", {
      module: "ai-coach",
      sessionId,
    });
    return;
  }

  try {
    // Fetch and summarize HR data
    const summaries = await fetchAndSummarize(sessionId, gymId, config);
    if (summaries.length === 0) {
      log.debug("No HR data for analysis, skipping", {
        module: "ai-coach",
        sessionId,
      });
      return;
    }

    // Build prompts
    const systemPrompt = buildSystemPrompt(config.language);
    const userPrompt = buildUserPrompt(summaries, config.classType);

    // Call OpenAI
    const message = await callOpenAI(config, systemPrompt, userPrompt, 200);
    if (!message) return;

    // Store in database
    await db.insert(aiCoachingMessages).values({
      sessionId,
      gymId,
      message,
      model: config.model,
      athleteSummaries: summaries,
    });

    // Broadcast to TV
    const tvMsg: TvCoachMessage = {
      type: "coach-message",
      message,
    };
    broadcastFn(gymId, tvMsg);

    log.info("Coaching message generated and broadcast", {
      module: "ai-coach",
      sessionId,
      gymId,
      messageLength: message.length,
    });
  } catch (err) {
    log.error("Analysis cycle failed", {
      module: "ai-coach",
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Data Fetching ──────────────────────────────────────────────────────────

/**
 * Query hr_readings for the analysis window and compute per-athlete summaries.
 * Exported for testing.
 */
export async function fetchAndSummarize(
  sessionId: string,
  gymId: string,
  config: CoachingConfig
): Promise<AthleteSummary[]> {
  const windowStart = new Date(
    Date.now() - config.analysisMinutes * 60 * 1000
  );

  const rows = await db
    .select({
      athleteId: hrReadings.athleteId,
      athleteName: athletes.name,
      heartRateBpm: hrReadings.heartRateBpm,
      hrZone: hrReadings.hrZone,
      hrZoneName: hrReadings.hrZoneName,
      recordedAt: hrReadings.recordedAt,
    })
    .from(hrReadings)
    .innerJoin(athletes, eq(hrReadings.athleteId, athletes.id))
    .where(
      and(
        eq(hrReadings.sessionId, sessionId),
        eq(hrReadings.gymId, gymId),
        gte(hrReadings.recordedAt, windowStart),
        gt(hrReadings.heartRateBpm, 0)
      )
    )
    .orderBy(desc(hrReadings.recordedAt));

  if (rows.length === 0) return [];

  // Group by athlete
  const byAthlete = new Map<
    string,
    {
      athleteId: string;
      athleteName: string;
      readings: { bpm: number; zone: number; zoneName: string }[];
    }
  >();

  for (const row of rows) {
    const existing = byAthlete.get(row.athleteId);
    if (existing) {
      existing.readings.push({
        bpm: row.heartRateBpm,
        zone: row.hrZone,
        zoneName: row.hrZoneName,
      });
    } else {
      byAthlete.set(row.athleteId, {
        athleteId: row.athleteId,
        athleteName: row.athleteName,
        readings: [
          {
            bpm: row.heartRateBpm,
            zone: row.hrZone,
            zoneName: row.hrZoneName,
          },
        ],
      });
    }
  }

  // Build summaries
  const summaries: AthleteSummary[] = [];

  for (const [, data] of byAthlete) {
    const bpms = data.readings.map((r) => r.bpm);
    const avgBpm = Math.round(
      bpms.reduce((a, b) => a + b, 0) / bpms.length
    );
    const maxBpm = Math.max(...bpms);
    const minBpm = Math.min(...bpms);

    // Current zone (most recent reading — first in DESC order)
    const currentZoneName = data.readings[0].zoneName;

    // Time by zone (approximate: each reading ~5s batch interval)
    const zoneCounts: Record<number, { count: number; name: string }> = {};
    for (const r of data.readings) {
      if (!zoneCounts[r.zone]) {
        zoneCounts[r.zone] = { count: 0, name: r.zoneName };
      }
      zoneCounts[r.zone].count++;
    }
    const timeByZone: Record<string, string> = {};
    for (const [zone, info] of Object.entries(zoneCounts)) {
      timeByZone[`Z${zone} ${info.name}`] = `${Math.round((info.count * 5) / 60)}min`;
    }

    // Trend calculation: split readings in half, compare averages
    const trend = computeTrend(bpms);

    summaries.push({
      athleteId: data.athleteId,
      athleteName: data.athleteName,
      avgBpm,
      maxBpm,
      minBpm,
      currentZoneName,
      readingsCount: data.readings.length,
      timeByZone,
      trend,
    });
  }

  return summaries;
}

/**
 * Compute trend from BPM readings.
 * Readings come in DESC order (most recent first).
 */
function computeTrend(bpms: number[]): "rising" | "falling" | "stable" {
  if (bpms.length < 4) return "stable";

  const mid = Math.floor(bpms.length / 2);
  const recentBpms = bpms.slice(0, mid);
  const olderBpms = bpms.slice(mid);

  const recentAvg =
    recentBpms.reduce((a, b) => a + b, 0) / recentBpms.length;
  const olderAvg = olderBpms.reduce((a, b) => a + b, 0) / olderBpms.length;

  const diff = recentAvg - olderAvg;
  if (diff > 5) return "rising";
  if (diff < -5) return "falling";
  return "stable";
}

// ─── OpenAI Caller ──────────────────────────────────────────────────────────

/**
 * Call OpenAI API with the given prompts.
 * Returns the message string, or null on any failure.
 * Exported for testing.
 */
export async function callOpenAI(
  config: CoachingConfig,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string | null> {
  const client = getOpenAIClient();
  if (!client) {
    log.debug("OpenAI client not available (no API key)", {
      module: "ai-coach",
    });
    return null;
  }

  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.8,
    });

    const content = response.choices?.[0]?.message?.content?.trim();
    if (!content) {
      log.warn("OpenAI returned empty response", { module: "ai-coach" });
      return null;
    }

    return content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      err && typeof err === "object" && "status" in err
        ? (err as { status: number }).status
        : undefined;

    log.error("OpenAI API call failed", {
      module: "ai-coach",
      error: message,
      status,
    });
    return null;
  }
}

// ─── Post-Session Summary ───────────────────────────────────────────────────

/**
 * Generate a post-session AI summary and store it in sessions.aiSummary.
 */
export async function generatePostSessionSummary(
  sessionId: string,
  gymId: string
): Promise<string | null> {
  try {
    // Get gym config for language
    const gym = await db.query.gyms.findFirst({
      where: eq(gyms.id, gymId),
      columns: { language: true },
    });
    if (!gym) {
      log.warn("Gym not found for post-session summary", {
        module: "ai-coach",
        gymId,
      });
      return null;
    }

    const language: "es" | "pt" = gym.language.startsWith("pt") ? "pt" : "es";

    // Get session info
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      columns: { classType: true, durationSeconds: true },
    });
    if (!session) return null;

    const durationSeconds = session.durationSeconds || 0;

    // Get per-athlete stats from hr_readings (NOT session_athletes — zone times are 0 there)
    const rows = await db
      .select({
        athleteId: hrReadings.athleteId,
        athleteName: athletes.name,
        heartRateBpm: hrReadings.heartRateBpm,
        hrZone: hrReadings.hrZone,
        hrZoneName: hrReadings.hrZoneName,
      })
      .from(hrReadings)
      .innerJoin(athletes, eq(hrReadings.athleteId, athletes.id))
      .where(
        and(
          eq(hrReadings.sessionId, sessionId),
          gt(hrReadings.heartRateBpm, 0)
        )
      );

    if (rows.length === 0) {
      log.debug("No HR data for post-session summary", {
        module: "ai-coach",
        sessionId,
      });
      return null;
    }

    // Aggregate per athlete
    const byAthlete = new Map<
      string,
      {
        athleteName: string;
        bpms: number[];
        zoneCounts: Record<number, { count: number; name: string }>;
      }
    >();

    for (const row of rows) {
      const existing = byAthlete.get(row.athleteId);
      if (existing) {
        existing.bpms.push(row.heartRateBpm);
        if (!existing.zoneCounts[row.hrZone]) {
          existing.zoneCounts[row.hrZone] = { count: 0, name: row.hrZoneName };
        }
        existing.zoneCounts[row.hrZone].count++;
      } else {
        byAthlete.set(row.athleteId, {
          athleteName: row.athleteName,
          bpms: [row.heartRateBpm],
          zoneCounts: {
            [row.hrZone]: { count: 1, name: row.hrZoneName },
          },
        });
      }
    }

    const athleteStats: PostSessionAthleteStats[] = [];
    for (const [athleteId, data] of byAthlete) {
      const avgHr = Math.round(
        data.bpms.reduce((a, b) => a + b, 0) / data.bpms.length
      );
      const timeByZone: Record<string, string> = {};
      for (const [zone, info] of Object.entries(data.zoneCounts)) {
        timeByZone[`Z${zone} ${info.name}`] = `${Math.round((info.count * 5) / 60)}min`;
      }

      athleteStats.push({
        athleteId,
        athleteName: data.athleteName,
        avgHr,
        maxHr: Math.max(...data.bpms),
        minHr: Math.min(...data.bpms),
        readingsCount: data.bpms.length,
        timeByZone,
      });
    }

    // Build prompts and call OpenAI
    const config = getCoachingConfig({ language: gym.language });
    const systemPrompt = buildPostSessionSystemPrompt(language);
    const userPrompt = buildPostSessionUserPrompt(
      durationSeconds,
      athleteStats.length,
      athleteStats
    );

    const summary = await callOpenAI(config, systemPrompt, userPrompt, 400);
    if (!summary) return null;

    // Store in sessions.aiSummary
    await db
      .update(sessions)
      .set({ aiSummary: summary })
      .where(eq(sessions.id, sessionId));

    log.info("Post-session summary generated", {
      module: "ai-coach",
      sessionId,
      gymId,
      summaryLength: summary.length,
    });

    return summary;
  } catch (err) {
    log.error("Post-session summary failed", {
      module: "ai-coach",
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Test Helpers (exported for testing internal functions) ──────────────────

export const _testing = {
  getActiveTimers: () => activeTimers,
  resetClient: () => {
    openaiClient = null;
  },
};
