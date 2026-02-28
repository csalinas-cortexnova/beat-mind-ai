import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "../logger";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalEnv;
  });

  it("should output JSON to stdout for info level", () => {
    log.info("test message");

    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("test message");
  });

  it("should output JSON to stderr for error level", () => {
    log.error("error occurred");

    expect(errorSpy).toHaveBeenCalledOnce();
    const output = errorSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("error occurred");
  });

  it("should output JSON to console.warn for warn level", () => {
    log.warn("warning message");

    expect(warnSpy).toHaveBeenCalledOnce();
    const output = warnSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe("warn");
    expect(parsed.message).toBe("warning message");
  });

  it("should suppress debug in production", () => {
    process.env.NODE_ENV = "production";
    log.debug("should not appear");

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("should output debug in development", () => {
    process.env.NODE_ENV = "development";
    log.debug("debug message");

    expect(logSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.level).toBe("debug");
  });

  it("should include timestamp and env fields", () => {
    process.env.NODE_ENV = "test";
    log.info("with fields");

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.env).toBe("test");
    // Verify timestamp is ISO format
    expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
  });

  it("should include optional context fields", () => {
    log.info("with context", {
      module: "athlete-deletion",
      requestId: "req-123",
      athleteId: "ath-456",
    });

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.module).toBe("athlete-deletion");
    expect(parsed.requestId).toBe("req-123");
    expect(parsed.athleteId).toBe("ath-456");
  });

  it("should strip undefined fields from context", () => {
    log.info("strip undefined", {
      module: "test",
      requestId: undefined,
    });

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.module).toBe("test");
    expect("requestId" in parsed).toBe(false);
  });

  it("should produce valid JSON output", () => {
    log.info("json check", { module: "test", count: 42 });

    const output = logSpy.mock.calls[0][0] as string;
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("should include env=production when NODE_ENV is production", () => {
    process.env.NODE_ENV = "production";
    log.info("production message");

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.env).toBe("production");
  });
});
