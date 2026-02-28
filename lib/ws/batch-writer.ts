/**
 * BatchWriter - buffers HR readings per gym and batch-inserts to DB.
 * Flushes on interval (default 5s). On DB error, retains readings for retry.
 * Buffer overflow drops oldest 50% to prevent memory exhaustion.
 */

import { db } from "@/lib/db";
import { hrReadings } from "@/lib/db/schema";
import { log } from "@/lib/logger";
import type { HRReadingInsert } from "./types";

export class BatchWriter {
  private buffers: Map<string, HRReadingInsert[]> = new Map();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isShutdown = false;

  constructor(
    private flushIntervalMs: number = 5000,
    private maxBufferPerGym: number = 1000
  ) {}

  start(): void {
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  enqueue(gymId: string, readings: HRReadingInsert[]): void {
    if (this.isShutdown) {
      log.warn("BatchWriter: enqueue after shutdown", {
        module: "batch-writer",
      });
      return;
    }
    if (readings.length === 0) return;

    const buffer = this.buffers.get(gymId) || [];
    buffer.push(...readings);

    // Overflow: drop oldest 50%
    if (buffer.length > this.maxBufferPerGym) {
      const dropCount = Math.floor(buffer.length / 2);
      buffer.splice(0, dropCount);
      log.warn("BatchWriter: buffer overflow, dropped oldest readings", {
        module: "batch-writer",
        gymId,
        dropped: dropCount,
      });
    }

    this.buffers.set(gymId, buffer);
  }

  async flush(): Promise<void> {
    for (const [gymId, readings] of this.buffers.entries()) {
      if (readings.length === 0) continue;

      try {
        await db.insert(hrReadings).values(readings);
        this.buffers.set(gymId, []);
      } catch (err) {
        log.error("BatchWriter: flush failed, retaining buffer", {
          module: "batch-writer",
          gymId,
          count: readings.length,
          error: err instanceof Error ? err.message : String(err),
        });
        // Readings stay in buffer for next cycle
      }
    }
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    this.buffers.clear();
  }

  getBufferedCount(): number {
    let total = 0;
    for (const readings of this.buffers.values()) {
      total += readings.length;
    }
    return total;
  }
}
