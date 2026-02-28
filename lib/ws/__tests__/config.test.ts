import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadWsConfig, validateWsConfig } from "../config";

describe("loadWsConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should return sensible defaults when no env vars set", () => {
    delete process.env.WS_PORT;
    delete process.env.WS_INTERNAL_SECRET;
    delete process.env.WS_PING_INTERVAL;
    delete process.env.WS_PONG_TIMEOUT;
    delete process.env.WS_AUTH_TIMEOUT;
    delete process.env.WS_BATCH_FLUSH_INTERVAL;
    delete process.env.WS_BATCH_MAX_BUFFER;

    const config = loadWsConfig();
    expect(config.WS_PORT).toBe(3001);
    expect(config.WS_INTERNAL_SECRET).toBe("");
    expect(config.WS_PING_INTERVAL).toBe(30000);
    expect(config.WS_PONG_TIMEOUT).toBe(60000);
    expect(config.WS_AUTH_TIMEOUT).toBe(5000);
    expect(config.WS_BATCH_FLUSH_INTERVAL).toBe(5000);
    expect(config.WS_BATCH_MAX_BUFFER).toBe(1000);
  });

  it("should read custom env vars", () => {
    process.env.WS_PORT = "4000";
    process.env.WS_INTERNAL_SECRET = "super-secret";
    process.env.WS_PING_INTERVAL = "15000";
    process.env.WS_BATCH_MAX_BUFFER = "2000";

    const config = loadWsConfig();
    expect(config.WS_PORT).toBe(4000);
    expect(config.WS_INTERNAL_SECRET).toBe("super-secret");
    expect(config.WS_PING_INTERVAL).toBe(15000);
    expect(config.WS_BATCH_MAX_BUFFER).toBe(2000);
  });

  it("should handle non-numeric port gracefully (NaN)", () => {
    process.env.WS_PORT = "abc";
    const config = loadWsConfig();
    expect(isNaN(config.WS_PORT)).toBe(true);
  });
});

describe("validateWsConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should not throw for valid config in development", () => {
    process.env.NODE_ENV = "development";
    const config = loadWsConfig();
    expect(() => validateWsConfig(config)).not.toThrow();
  });

  it("should throw for missing WS_INTERNAL_SECRET in production", () => {
    process.env.NODE_ENV = "production";
    process.env.WS_INTERNAL_SECRET = "";

    const config = loadWsConfig();
    expect(() => validateWsConfig(config)).toThrow(
      "WS_INTERNAL_SECRET is required in production"
    );
  });

  it("should not throw when WS_INTERNAL_SECRET is set in production", () => {
    process.env.NODE_ENV = "production";
    process.env.WS_INTERNAL_SECRET = "my-prod-secret";

    const config = loadWsConfig();
    expect(() => validateWsConfig(config)).not.toThrow();
  });

  it("should throw for invalid port (NaN)", () => {
    process.env.WS_PORT = "abc";
    const config = loadWsConfig();
    expect(() => validateWsConfig(config)).toThrow("Invalid WS_PORT");
  });

  it("should throw for port out of range", () => {
    process.env.WS_PORT = "70000";
    const config = loadWsConfig();
    expect(() => validateWsConfig(config)).toThrow("Invalid WS_PORT");
  });
});
