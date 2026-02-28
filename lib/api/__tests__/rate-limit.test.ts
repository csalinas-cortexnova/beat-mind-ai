import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkRateLimit,
  rateLimitResponse,
  _resetStore,
  _getStoreSize,
  _runCleanup,
  RATE_LIMITS,
  type RateLimitConfig,
} from "../rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const config: RateLimitConfig = { maxRequests: 3, windowMs: 60_000 };

  it("should allow requests within limit", () => {
    const result = checkRateLimit("test:key1", config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("should decrement remaining on each request", () => {
    checkRateLimit("test:key2", config);
    const result2 = checkRateLimit("test:key2", config);
    expect(result2.remaining).toBe(1);

    const result3 = checkRateLimit("test:key2", config);
    expect(result3.remaining).toBe(0);
  });

  it("should block when over limit", () => {
    checkRateLimit("test:key3", config);
    checkRateLimit("test:key3", config);
    checkRateLimit("test:key3", config);
    const result = checkRateLimit("test:key3", config);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    if (!result.allowed) {
      expect(result.retryAfterS).toBeGreaterThan(0);
    }
  });

  it("should reset after window expires", () => {
    checkRateLimit("test:key4", config);
    checkRateLimit("test:key4", config);
    checkRateLimit("test:key4", config);

    // Advance past the window
    vi.advanceTimersByTime(60_001);

    const result = checkRateLimit("test:key4", config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("should track independent keys separately", () => {
    checkRateLimit("test:a", config);
    checkRateLimit("test:a", config);
    checkRateLimit("test:a", config);

    // Key "a" is exhausted, but "b" should be fresh
    const resultA = checkRateLimit("test:a", config);
    expect(resultA.allowed).toBe(false);

    const resultB = checkRateLimit("test:b", config);
    expect(resultB.allowed).toBe(true);
    expect(resultB.remaining).toBe(2);
  });

  it("should include retryAfterS in blocked result", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    checkRateLimit("test:retry", config);
    checkRateLimit("test:retry", config);
    checkRateLimit("test:retry", config);

    // Advance 30 seconds (half the window)
    vi.advanceTimersByTime(30_000);
    const result = checkRateLimit("test:retry", config);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterS).toBe(30); // 60s window - 30s elapsed = 30s
    }
  });

  it("should include resetAt timestamp in results", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const result = checkRateLimit("test:reset", config);
    expect(result.resetAt).toBe(Date.now() + 60_000);
  });
});

describe("rateLimitResponse", () => {
  it("should return 429 with Retry-After header", async () => {
    const response = rateLimitResponse(45);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("45");

    const body = await response.json();
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.error).toBe("Too many requests");
  });
});

describe("_resetStore", () => {
  beforeEach(() => {
    _resetStore();
  });

  it("should clear all entries", () => {
    const config: RateLimitConfig = { maxRequests: 10, windowMs: 60_000 };
    checkRateLimit("test:clear1", config);
    checkRateLimit("test:clear2", config);
    expect(_getStoreSize()).toBe(2);

    _resetStore();
    expect(_getStoreSize()).toBe(0);
  });
});

describe("cleanup removes expired entries", () => {
  beforeEach(() => {
    _resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should remove expired entries when cleanup runs", () => {
    const shortConfig: RateLimitConfig = { maxRequests: 5, windowMs: 10_000 };
    checkRateLimit("test:expire1", shortConfig);
    checkRateLimit("test:expire2", shortConfig);
    expect(_getStoreSize()).toBe(2);

    // Advance past window expiry
    vi.advanceTimersByTime(11_000);

    // Manually trigger cleanup (the real interval uses real timers, tested via _runCleanup)
    _runCleanup();

    expect(_getStoreSize()).toBe(0);
  });

  it("should keep non-expired entries during cleanup", () => {
    const shortConfig: RateLimitConfig = { maxRequests: 5, windowMs: 30_000 };
    const longConfig: RateLimitConfig = { maxRequests: 5, windowMs: 120_000 };
    checkRateLimit("test:short", shortConfig);
    checkRateLimit("test:long", longConfig);
    expect(_getStoreSize()).toBe(2);

    // Advance past short window but not long window
    vi.advanceTimersByTime(31_000);
    _runCleanup();

    expect(_getStoreSize()).toBe(1);
  });
});

describe("RATE_LIMITS configs", () => {
  it("should have correct AGENT_HEARTBEAT config", () => {
    expect(RATE_LIMITS.AGENT_HEARTBEAT.maxRequests).toBe(20);
    expect(RATE_LIMITS.AGENT_HEARTBEAT.windowMs).toBe(1_000);
  });

  it("should have correct AUTHENTICATED_API config", () => {
    expect(RATE_LIMITS.AUTHENTICATED_API.maxRequests).toBe(100);
    expect(RATE_LIMITS.AUTHENTICATED_API.windowMs).toBe(60_000);
  });

  it("should have correct UNAUTHENTICATED_API config", () => {
    expect(RATE_LIMITS.UNAUTHENTICATED_API.maxRequests).toBe(10);
    expect(RATE_LIMITS.UNAUTHENTICATED_API.windowMs).toBe(60_000);
  });
});
