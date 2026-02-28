/**
 * Report token generation and validation.
 * Uses HMAC-SHA256 with a compact JWT-like format (header.payload.signature).
 * No external JWT library — uses Node.js native crypto.
 */

import { createHmac, timingSafeEqual } from "crypto";

interface ReportTokenPayload {
  sessionId: string;
  athleteId: string;
  gymId: string;
  exp: number; // Unix timestamp (seconds)
}

function getSecret(): string {
  const secret = process.env.REPORT_TOKEN_SECRET;
  if (!secret) {
    throw new Error("REPORT_TOKEN_SECRET environment variable is required");
  }
  return secret;
}

function base64urlEncode(data: string): string {
  return Buffer.from(data, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(data: string): string {
  const padded = data + "=".repeat((4 - (data.length % 4)) % 4);
  return Buffer.from(
    padded.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}

function sign(header: string, payload: string, secret: string): string {
  const data = `${header}.${payload}`;
  return createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Generate a report token valid for 30 days.
 */
export function generateReportToken(
  sessionId: string,
  athleteId: string,
  gymId: string
): string {
  const secret = getSecret();

  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "RT" }));
  const payload = base64urlEncode(
    JSON.stringify({
      sessionId,
      athleteId,
      gymId,
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
    } satisfies ReportTokenPayload)
  );

  const signature = sign(header, payload, secret);
  return `${header}.${payload}.${signature}`;
}

/**
 * Validate a report token and return the payload if valid.
 * Returns null if token is invalid, tampered, or expired.
 */
export function validateReportToken(
  token: string
): { sessionId: string; athleteId: string; gymId: string } | null {
  try {
    if (!token) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const secret = getSecret();

    // Verify signature using timing-safe comparison
    const expectedSig = sign(header, payload, secret);
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);

    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

    // Decode and validate payload
    const decoded = JSON.parse(base64urlDecode(payload)) as ReportTokenPayload;

    // Check expiry
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;

    return {
      sessionId: decoded.sessionId,
      athleteId: decoded.athleteId,
      gymId: decoded.gymId,
    };
  } catch {
    return null;
  }
}
