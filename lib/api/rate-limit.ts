/**
 * In-memory rate limiter with sliding window.
 * Functional API matching codebase style (withGymScope, ok, error).
 *
 * Keys are namespaced: "ip:{ip}", "user:{userId}", "agent-hb:{agentId}", "agent-st:{agentId}"
 */

import { error } from "./response";
import { ApiErrorCode } from "./errors";
import { NextResponse } from "next/server";

// --- Types ---

export type RateLimitConfig = {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number; // timestamp ms
};

export type RateLimitResult =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; remaining: 0; resetAt: number; retryAfterS: number };

// --- Configs ---

export const RATE_LIMITS = {
  /** Agent heartbeat: 20 req/sec per agent_id */
  AGENT_HEARTBEAT: { maxRequests: 20, windowMs: 1_000 } satisfies RateLimitConfig,
  /** Agent status: 2 req/min per agent_id */
  AGENT_STATUS: { maxRequests: 2, windowMs: 60_000 } satisfies RateLimitConfig,
  /** Authenticated API: 100 req/min per user_id */
  AUTHENTICATED_API: { maxRequests: 100, windowMs: 60_000 } satisfies RateLimitConfig,
  /** Unauthenticated API: 10 req/min per IP */
  UNAUTHENTICATED_API: { maxRequests: 10, windowMs: 60_000 } satisfies RateLimitConfig,
  /** WhatsApp send: 5 req/hour per user_id */
  WHATSAPP_SEND: { maxRequests: 5, windowMs: 3_600_000 } satisfies RateLimitConfig,
} as const;

// --- Store ---

const store = new Map<string, RateLimitEntry>();

// --- Cleanup ---

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }, 60_000);
  // Allow process to exit without waiting for cleanup
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

// Start cleanup on module load
startCleanup();

// --- Core ---

/**
 * Check if a request is within the rate limit.
 *
 * @param key - Namespaced key (e.g., "ip:1.2.3.4", "user:abc-123")
 * @param config - Rate limit configuration
 * @returns RateLimitResult with allowed status and metadata
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  // No entry or expired window: create fresh
  if (!entry || entry.resetAt <= now) {
    const resetAt = now + config.windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt };
  }

  // Within window: increment
  entry.count += 1;

  if (entry.count > config.maxRequests) {
    const retryAfterS = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, resetAt: entry.resetAt, retryAfterS };
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Create a 429 Too Many Requests response with Retry-After header.
 */
export function rateLimitResponse(retryAfterS: number): NextResponse {
  const response = error(
    "Too many requests",
    ApiErrorCode.RATE_LIMITED,
    429
  );
  response.headers.set("Retry-After", String(retryAfterS));
  return response;
}

/**
 * Reset the rate limit store. For testing only.
 */
export function _resetStore(): void {
  store.clear();
}

/**
 * Get current store size. For testing only.
 */
export function _getStoreSize(): number {
  return store.size;
}

/**
 * Run the cleanup sweep manually. For testing only.
 */
export function _runCleanup(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}
