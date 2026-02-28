/**
 * Agent message handler — parses, validates, and routes agent WS messages.
 * Handles: hr-data, heartbeat. Rate limits at 2 msg/s per agent.
 */

import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { AgentHRDataSchema, AgentWsHeartbeatSchema } from "./schemas";
import { log } from "@/lib/logger";
import type { GymStateManager } from "./gym-state";
import type { BatchWriter } from "./batch-writer";
import type { AutoSessionManager } from "./auto-session";
import type { TvHRUpdateMessage } from "./types";

const RATE_LIMIT_WINDOW = 1000; // 1 second
const RATE_LIMIT_MAX = 2; // 2 messages per second

interface RateLimitState {
  count: number;
  windowStart: number;
}

const rateLimits = new Map<string, RateLimitState>();

function isRateLimited(agentId: string): boolean {
  const now = Date.now();
  const state = rateLimits.get(agentId);

  if (!state || now - state.windowStart > RATE_LIMIT_WINDOW) {
    rateLimits.set(agentId, { count: 1, windowStart: now });
    return false;
  }

  state.count++;
  return state.count > RATE_LIMIT_MAX;
}

export interface AgentHandlerDeps {
  gymState: GymStateManager;
  batchWriter: BatchWriter;
  autoSession: AutoSessionManager;
  broadcastToGym: (gymId: string, msg: TvHRUpdateMessage) => void;
}

export async function handleAgentMessage(
  raw: Buffer | string,
  agentId: string,
  gymId: string,
  deps: AgentHandlerDeps
): Promise<void> {
  // Rate limit
  if (isRateLimited(agentId)) {
    log.debug("Agent rate limited", { module: "agent-handler", agentId });
    return;
  }

  let parsed: unknown;
  try {
    const str = typeof raw === "string" ? raw : raw.toString();
    parsed = JSON.parse(str);
  } catch {
    log.warn("Agent: malformed JSON", { module: "agent-handler", agentId });
    return;
  }

  const obj = parsed as Record<string, unknown>;
  const msgType = obj?.type;

  if (msgType === "hr-data") {
    const result = AgentHRDataSchema.safeParse(parsed);
    if (!result.success) {
      log.warn("Agent: invalid hr-data", {
        module: "agent-handler",
        agentId,
      });
      return;
    }

    const state = await deps.gymState.getOrLoadState(gymId);
    const { enriched, readings } = deps.gymState.processHRData(
      state,
      result.data.devices,
      result.data.timestamp
    );

    // Broadcast to TV clients
    deps.broadcastToGym(gymId, {
      type: "hr-update",
      athletes: enriched,
      timestamp: result.data.timestamp,
    });

    // Enqueue readings for batch insert
    if (readings.length > 0) {
      deps.batchWriter.enqueue(gymId, readings);
    }

    // Auto-session tracking
    await deps.autoSession.onHRData(gymId, result.data.devices);
  } else if (msgType === "heartbeat") {
    const result = AgentWsHeartbeatSchema.safeParse(parsed);
    if (!result.success) return;

    try {
      await db
        .update(agents)
        .set({ lastHeartbeat: new Date() })
        .where(eq(agents.id, agentId));
    } catch (err) {
      log.error("Agent: heartbeat DB update failed", {
        module: "agent-handler",
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    log.warn("Agent: unknown message type", {
      module: "agent-handler",
      agentId,
      type: String(msgType),
    });
  }
}

/** For testing: clear rate limit state */
export function _clearRateLimits(): void {
  rateLimits.clear();
}
