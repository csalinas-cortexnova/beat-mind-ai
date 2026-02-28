/**
 * AI Coaching System (Coach Pulse) — TypeScript types.
 *
 * Used by prompts.ts and coach.ts for type safety across the coaching pipeline.
 */

import type { TvCoachMessage } from "@/lib/ws/types";

// ─── Coaching Config ────────────────────────────────────────────────────────

export interface CoachingConfig {
  /** Whether coaching is enabled (OPENAI_API_KEY present) */
  enabled: boolean;
  /** OpenAI model to use (default: gpt-4o-mini) */
  model: string;
  /** Interval between analysis cycles in ms (default: 60000) */
  intervalMs: number;
  /** Warmup period before first analysis in ms (default: 60000) */
  warmupPeriodMs: number;
  /** Minutes of HR data to analyze per cycle (default: 10) */
  analysisMinutes: number;
  /** Normalized language: "es" | "pt" */
  language: "es" | "pt";
  /** Gym class type (e.g., "spinning", "auto") */
  classType: string | null;
}

// ─── Athlete Summary (per-cycle analysis input) ─────────────────────────────

export interface AthleteSummary {
  athleteId: string;
  athleteName: string;
  avgBpm: number;
  maxBpm: number;
  minBpm: number;
  currentZoneName: string;
  readingsCount: number;
  timeByZone: Record<string, string>;
  trend: "rising" | "falling" | "stable";
}

// ─── Analysis Result ────────────────────────────────────────────────────────

export interface AnalysisResult {
  message: string;
  summaries: AthleteSummary[];
  model: string;
  timestamp: string;
}

// ─── Post-Session Types ─────────────────────────────────────────────────────

export interface PostSessionAthleteStats {
  athleteId: string;
  athleteName: string;
  avgHr: number;
  maxHr: number;
  minHr: number;
  readingsCount: number;
  timeByZone: Record<string, string>;
}

// ─── Timer State ────────────────────────────────────────────────────────────

export interface SessionTimerState {
  sessionId: string;
  gymId: string;
  config: CoachingConfig;
  timer: ReturnType<typeof setInterval>;
  startedAt: number;
  broadcastFn: (gymId: string, msg: TvCoachMessage) => void;
}

// ─── Broadcast function type ────────────────────────────────────────────────

export type CoachBroadcastFn = (gymId: string, msg: TvCoachMessage) => void;
