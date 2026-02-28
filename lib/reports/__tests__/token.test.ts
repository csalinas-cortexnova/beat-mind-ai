// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateReportToken, validateReportToken } from "../token";

describe("Report Token", () => {
  const TEST_SECRET = "test-report-secret-key-min-32-chars-long";

  beforeEach(() => {
    vi.stubEnv("REPORT_TOKEN_SECRET", TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const sessionId = "550e8400-e29b-41d4-a716-446655440001";
  const athleteId = "550e8400-e29b-41d4-a716-446655440002";
  const gymId = "550e8400-e29b-41d4-a716-446655440003";

  it("should generate a valid token string", () => {
    const token = generateReportToken(sessionId, athleteId, gymId);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    // Base64url encoded, has 3 parts (header.payload.signature)
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
  });

  it("should validate a freshly generated token", () => {
    const token = generateReportToken(sessionId, athleteId, gymId);
    const result = validateReportToken(token);

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe(sessionId);
    expect(result!.athleteId).toBe(athleteId);
    expect(result!.gymId).toBe(gymId);
  });

  it("should reject an expired token", () => {
    // Generate token, then advance time past 30 days
    const token = generateReportToken(sessionId, athleteId, gymId);

    // Manually create a token with past expiry
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const expiredToken = generateReportToken(sessionId, athleteId, gymId);
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z")); // 59 days later
    const result = validateReportToken(expiredToken);
    vi.useRealTimers();

    expect(result).toBeNull();
  });

  it("should reject a tampered token", () => {
    const token = generateReportToken(sessionId, athleteId, gymId);
    // Tamper with the payload
    const parts = token.split(".");
    parts[1] = parts[1] + "tampered";
    const tampered = parts.join(".");

    const result = validateReportToken(tampered);
    expect(result).toBeNull();
  });

  it("should reject a malformed token", () => {
    expect(validateReportToken("not-a-valid-token")).toBeNull();
    expect(validateReportToken("")).toBeNull();
    expect(validateReportToken("a.b")).toBeNull();
  });
});
