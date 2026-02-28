import { verifyAgentAuth, isAuthError } from "@/lib/auth/agent-auth";
import { validateBody } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { AgentStatusSchema } from "@/lib/validations/agent";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/api/rate-limit";

export async function POST(request: Request) {
  // 1. Auth
  const authResult = await verifyAgentAuth(request);
  if (isAuthError(authResult)) {
    return error(authResult.error, ApiErrorCode.UNAUTHORIZED, authResult.status);
  }

  // 1b. Rate limit per agent
  const rlResult = checkRateLimit(
    `agent-st:${authResult.agentId}`,
    RATE_LIMITS.AGENT_STATUS
  );
  if (!rlResult.allowed) {
    return rateLimitResponse(rlResult.retryAfterS);
  }

  // 2. Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(
      "Invalid JSON body",
      ApiErrorCode.VALIDATION_ERROR,
      422
    );
  }

  // 3. Validate
  const validation = validateBody(AgentStatusSchema, body);
  if (!validation.success) {
    return validation.response;
  }

  const data = validation.data;

  // 4. Check gymId matches agent's gym
  if (data.gymId !== authResult.gymId) {
    return error(
      "Gym ID does not match agent's assigned gym",
      ApiErrorCode.GYM_MISMATCH,
      422
    );
  }

  // 5. Update agent record
  await db
    .update(agents)
    .set({
      status: data.status,
      softwareVersion: data.softwareVersion,
      ipAddress: data.ipAddress,
    })
    .where(eq(agents.id, authResult.agentId));

  // 6. Return success
  return ok({ ok: true });
}
