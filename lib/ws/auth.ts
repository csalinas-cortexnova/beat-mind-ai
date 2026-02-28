/**
 * WS authentication wrappers.
 * Thin layer over existing auth functions adding WS-specific timeout + close codes.
 */

import type { WebSocket } from "ws";
import { verifyAgentWsAuth } from "@/lib/auth/agent-auth";
import { verifyTvToken } from "@/lib/auth/tv-auth";
import { db } from "@/lib/db";
import { gyms } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { AgentAuthSchema } from "./schemas";
import { WS_CLOSE_CODES } from "./types";
import type { AgentContext, TvContext } from "@/lib/auth/types";
import { log } from "@/lib/logger";

/**
 * Authenticate an agent WS connection.
 * Waits for first message (agent-auth), validates credentials.
 * Closes with 4001 (AUTH_FAILED) or 4002 (AUTH_TIMEOUT).
 */
export function authenticateAgent(
  ws: WebSocket,
  timeoutMs: number
): Promise<AgentContext> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close(WS_CLOSE_CODES.AUTH_TIMEOUT, "Authentication timeout");
      reject(new Error("Authentication timeout"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      ws.removeListener("message", onMessage);
      ws.removeListener("close", onClose);
    };

    const onClose = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Connection closed before authentication"));
    };

    const onMessage = async (data: Buffer | string) => {
      if (settled) return;
      settled = true;
      cleanup();

      try {
        const raw = typeof data === "string" ? data : data.toString();
        const parsed = JSON.parse(raw);
        const result = AgentAuthSchema.safeParse(parsed);

        if (!result.success) {
          ws.close(WS_CLOSE_CODES.AUTH_FAILED, "Invalid auth message");
          reject(new Error("Invalid auth message"));
          return;
        }

        const { agentId, secret } = result.data;
        const ctx = await verifyAgentWsAuth(agentId, secret);

        if (!ctx) {
          ws.close(WS_CLOSE_CODES.AUTH_FAILED, "Invalid credentials");
          reject(new Error("Invalid credentials"));
          return;
        }

        resolve(ctx);
      } catch {
        ws.close(WS_CLOSE_CODES.AUTH_FAILED, "Authentication failed");
        reject(new Error("Authentication failed"));
      }
    };

    ws.once("message", onMessage);
    ws.once("close", onClose);
  });
}

/**
 * Authenticate a TV dashboard connection.
 * Validates token and checks gym subscription is active or trial.
 */
export async function authenticateTv(
  gymId: string,
  token: string
): Promise<TvContext | null> {
  const tvCtx = await verifyTvToken(gymId, token);
  if (!tvCtx) return null;

  // Check subscription status
  const rows = await db
    .select({ subscriptionStatus: gyms.subscriptionStatus })
    .from(gyms)
    .where(eq(gyms.id, gymId));

  if (rows.length === 0) return null;

  const status = rows[0].subscriptionStatus;
  if (status !== "active" && status !== "trial") {
    log.warn("TV auth rejected: inactive subscription", {
      module: "ws-auth",
      gymId,
      subscriptionStatus: status,
    });
    return null;
  }

  return tvCtx;
}
