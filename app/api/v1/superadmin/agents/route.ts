import { requireSuperAdminApi, isAuthError } from "@/lib/auth/guards";
import { validateQuery } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { paginationMeta, paginationOffsetLimit } from "@/lib/api/pagination";
import { ListAgentsQuerySchema } from "@/lib/validations/superadmin";
import { db } from "@/lib/db";
import { agents, gyms } from "@/lib/db/schema";
import { eq, and, count, desc } from "drizzle-orm";

const OFFLINE_THRESHOLD_MS = 90_000; // 90 seconds

export async function GET(request: Request) {
  // 1. Auth
  const authResult = await requireSuperAdminApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // 2. Validate query params
  const { searchParams } = new URL(request.url);
  const validation = validateQuery(ListAgentsQuerySchema, searchParams);
  if (!validation.success) return validation.response;

  const { page, limit, status, gymId } = validation.data;
  const { offset } = paginationOffsetLimit({ page, limit });

  // 3. Build filters
  const conditions = [];
  if (status) {
    conditions.push(eq(agents.status, status));
  }
  if (gymId) {
    conditions.push(eq(agents.gymId, gymId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // 4. Fetch agents with gym name
  const agentRows = await db
    .select({
      id: agents.id,
      gymId: agents.gymId,
      name: agents.name,
      status: agents.status,
      hardwareModel: agents.hardwareModel,
      serialNumber: agents.serialNumber,
      lastHeartbeat: agents.lastHeartbeat,
      ipAddress: agents.ipAddress,
      softwareVersion: agents.softwareVersion,
      createdAt: agents.createdAt,
      gymName: gyms.name,
    })
    .from(agents)
    .leftJoin(gyms, eq(agents.gymId, gyms.id))
    .where(whereClause)
    .orderBy(desc(agents.createdAt))
    .limit(limit)
    .offset(offset);

  // 5. Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(agents)
    .where(whereClause);

  // 6. Compute effective status (offline detection)
  const now = Date.now();
  const data = agentRows.map((agent) => {
    let effectiveStatus = agent.status;
    if (agent.status === "online" && agent.lastHeartbeat) {
      const heartbeatTime = new Date(agent.lastHeartbeat).getTime();
      if (now - heartbeatTime > OFFLINE_THRESHOLD_MS) {
        effectiveStatus = "offline";
      }
    }
    if (!agent.lastHeartbeat) {
      effectiveStatus = "offline";
    }
    return { ...agent, effectiveStatus };
  });

  return ok({
    data,
    pagination: paginationMeta(Number(total), { page, limit }),
  });
}
