/**
 * AutoSessionManager — tracks sustained HR data per gym to auto-create/end sessions.
 * Auto-start: 30 consecutive HR ticks with any bpm > 0 → create session.
 * Auto-end: 2 minutes of no active sensors → end session.
 */

import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { log } from "@/lib/logger";
import type { GymStateManager } from "./gym-state";
import type { TvSessionStartMessage, TvSessionEndMessage } from "./types";

export interface SessionLifecycleCallbacks {
  onSessionStart?: (sessionId: string, gymId: string) => Promise<void>;
  onSessionEnd?: (sessionId: string, gymId: string) => Promise<void>;
}

const AUTO_START_THRESHOLD = 30; // consecutive ticks with active sensors
const AUTO_END_TIMEOUT = 120_000; // 2 minutes
const AUTO_END_CHECK_INTERVAL = 10_000; // check every 10s

export class AutoSessionManager {
  private hrCounters: Map<string, number> = new Map();
  private lastActiveTime: Map<string, number> = new Map();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks: SessionLifecycleCallbacks;

  constructor(
    private gymState: GymStateManager,
    private broadcastFn: (gymId: string, msg: TvSessionStartMessage | TvSessionEndMessage) => void,
    callbacks?: SessionLifecycleCallbacks
  ) {
    this.callbacks = callbacks || {};
  }

  start(): void {
    this.checkTimer = setInterval(() => this.checkAutoEnd(), AUTO_END_CHECK_INTERVAL);
  }

  async onHRData(
    gymId: string,
    devices: Record<string, { bpm: number; deviceActive: boolean }>
  ): Promise<void> {
    const hasActiveSensor = Object.values(devices).some((d) => d.bpm > 0);

    if (hasActiveSensor) {
      this.lastActiveTime.set(gymId, Date.now());

      const count = (this.hrCounters.get(gymId) || 0) + 1;
      this.hrCounters.set(gymId, count);

      if (count >= AUTO_START_THRESHOLD) {
        await this.tryAutoStart(gymId);
      }
    } else {
      this.hrCounters.set(gymId, 0);
    }
  }

  private async tryAutoStart(gymId: string): Promise<void> {
    // Skip if session already exists (manual or auto)
    const existing = this.gymState.getActiveSession(gymId);
    if (existing) {
      this.hrCounters.set(gymId, 0);
      return;
    }

    try {
      const [created] = await db
        .insert(sessions)
        .values({
          gymId,
          classType: "auto",
          status: "active",
        })
        .returning({ id: sessions.id, startedAt: sessions.startedAt });

      const startedAt =
        created.startedAt instanceof Date
          ? created.startedAt.toISOString()
          : String(created.startedAt);

      this.gymState.setActiveSession(gymId, {
        id: created.id,
        classType: "auto",
        startedAt,
      });

      this.broadcastFn(gymId, {
        type: "session-start",
        sessionId: created.id,
        classType: "auto",
        startedAt,
      });

      log.info("AutoSession: auto-started session", {
        module: "auto-session",
        gymId,
        sessionId: created.id,
      });

      // Fire lifecycle callback (non-blocking — errors logged, not propagated)
      if (this.callbacks.onSessionStart) {
        this.callbacks.onSessionStart(created.id, gymId).catch((err) => {
          log.error("AutoSession: onSessionStart callback failed", {
            module: "auto-session",
            gymId,
            sessionId: created.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (err) {
      log.error("AutoSession: failed to auto-start", {
        module: "auto-session",
        gymId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.hrCounters.set(gymId, 0);
  }

  private async checkAutoEnd(): Promise<void> {
    const now = Date.now();
    for (const [gymId, lastActive] of this.lastActiveTime.entries()) {
      if (now - lastActive <= AUTO_END_TIMEOUT) continue;

      const session = this.gymState.getActiveSession(gymId);
      if (!session) continue;

      await this.endSession(gymId, session.id, session.startedAt);
    }
  }

  private async endSession(
    gymId: string,
    sessionId: string,
    startedAt: string
  ): Promise<void> {
    try {
      const durationSeconds = Math.round(
        (Date.now() - new Date(startedAt).getTime()) / 1000
      );

      await db
        .update(sessions)
        .set({
          status: "completed",
          endedAt: new Date(),
          durationSeconds,
        })
        .where(and(eq(sessions.id, sessionId), eq(sessions.status, "active")));

      // Fire lifecycle callback before clearing state
      if (this.callbacks.onSessionEnd) {
        try {
          await this.callbacks.onSessionEnd(sessionId, gymId);
        } catch (err) {
          log.error("AutoSession: onSessionEnd callback failed", {
            module: "auto-session",
            gymId,
            sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.gymState.clearActiveSession(gymId);
      this.lastActiveTime.delete(gymId);
      this.hrCounters.delete(gymId);

      this.broadcastFn(gymId, {
        type: "session-end",
        sessionId,
        durationSeconds,
      });

      log.info("AutoSession: auto-ended session", {
        module: "auto-session",
        gymId,
        sessionId,
        durationSeconds,
      });
    } catch (err) {
      log.error("AutoSession: failed to auto-end", {
        module: "auto-session",
        gymId,
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  shutdown(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    this.hrCounters.clear();
    this.lastActiveTime.clear();
  }
}
