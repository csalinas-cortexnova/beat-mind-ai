import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import type { AgentContext, AuthError } from "./types";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Type guard to distinguish AuthError from AgentContext */
export function isAuthError(
  result: AgentContext | AuthError
): result is AuthError {
  return "error" in result && "status" in result;
}

/**
 * Verify agent authentication from HTTP request headers.
 * Reads X-Agent-Id and X-Agent-Secret, validates against DB.
 * On success, updates agent status to "online" and sets lastHeartbeat.
 */
export async function verifyAgentAuth(
  request: Request
): Promise<AgentContext | AuthError> {
  const agentId = request.headers.get("X-Agent-Id");
  const agentSecret = request.headers.get("X-Agent-Secret");

  if (!agentId || !agentSecret) {
    return { error: "Missing agent credentials", status: 401 };
  }

  if (!UUID_REGEX.test(agentId)) {
    return { error: "Invalid agent ID format", status: 401 };
  }

  const rows = await db
    .select({
      id: agents.id,
      gymId: agents.gymId,
      agentSecret: agents.agentSecret,
    })
    .from(agents)
    .where(eq(agents.id, agentId));

  if (rows.length === 0) {
    return { error: "Invalid agent credentials", status: 401 };
  }

  const agent = rows[0];
  const valid = await bcrypt.compare(agentSecret, agent.agentSecret);

  if (!valid) {
    return { error: "Invalid agent credentials", status: 401 };
  }

  // Update agent status and heartbeat
  await db
    .update(agents)
    .set({ status: "online", lastHeartbeat: new Date() })
    .where(eq(agents.id, agentId));

  return { agentId: agent.id, gymId: agent.gymId };
}

/**
 * Verify agent authentication for WebSocket connections.
 * Same validation logic as verifyAgentAuth but returns null on failure
 * instead of AuthError (simpler for WS upgrade handlers).
 */
export async function verifyAgentWsAuth(
  agentId: string,
  secret: string
): Promise<AgentContext | null> {
  if (!UUID_REGEX.test(agentId)) {
    return null;
  }

  const rows = await db
    .select({
      id: agents.id,
      gymId: agents.gymId,
      agentSecret: agents.agentSecret,
    })
    .from(agents)
    .where(eq(agents.id, agentId));

  if (rows.length === 0) {
    return null;
  }

  const agent = rows[0];
  const valid = await bcrypt.compare(secret, agent.agentSecret);

  if (!valid) {
    return null;
  }

  // Update agent status and heartbeat
  await db
    .update(agents)
    .set({ status: "online", lastHeartbeat: new Date() })
    .where(eq(agents.id, agentId));

  return { agentId: agent.id, gymId: agent.gymId };
}
