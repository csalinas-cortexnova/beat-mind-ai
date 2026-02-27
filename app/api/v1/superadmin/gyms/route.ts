import { requireSuperAdminApi, isAuthError } from "@/lib/auth/guards";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { ok, error } from "@/lib/api/response";
import { ApiErrorCode } from "@/lib/api/errors";
import { paginationMeta, paginationOffsetLimit } from "@/lib/api/pagination";
import { ListGymsQuerySchema } from "@/lib/validations/superadmin";
import { CreateGymSchema } from "@/lib/validations/gym";
import { db } from "@/lib/db";
import { gyms, athletes, sessions, agents } from "@/lib/db/schema";
import { eq, and, or, ilike, sql, count, desc, max } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";

export async function GET(request: Request) {
  // 1. Auth
  const authResult = await requireSuperAdminApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // 2. Validate query params
  const { searchParams } = new URL(request.url);
  const validation = validateQuery(ListGymsQuerySchema, searchParams);
  if (!validation.success) return validation.response;

  const { page, limit, status, search } = validation.data;
  const { offset } = paginationOffsetLimit({ page, limit });

  // 3. Build filters
  const conditions = [];
  if (status) {
    conditions.push(eq(gyms.subscriptionStatus, status));
  }
  if (search) {
    conditions.push(
      or(
        ilike(gyms.name, `%${search}%`),
        ilike(gyms.slug, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // 4. Fetch gyms
  const gymRows = await db
    .select({
      id: gyms.id,
      name: gyms.name,
      slug: gyms.slug,
      address: gyms.address,
      subscriptionStatus: gyms.subscriptionStatus,
      subscriptionPlan: gyms.subscriptionPlan,
      maxAthletes: gyms.maxAthletes,
      timezone: gyms.timezone,
      language: gyms.language,
      createdAt: gyms.createdAt,
    })
    .from(gyms)
    .where(whereClause)
    .orderBy(desc(gyms.createdAt))
    .limit(limit)
    .offset(offset);

  // 5. Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(gyms)
    .where(whereClause);

  // 6. Batch stats queries for returned gyms
  const gymIds = gymRows.map((g) => g.id);

  let athleteCounts: Record<string, number> = {};
  let sessionCounts: Record<string, number> = {};
  const agentStatuses: Record<string, { online: number; total: number }> = {};
  let lastSessions: Record<string, Date | null> = {};

  if (gymIds.length > 0) {
    // Athlete counts per gym
    const athleteRows = await db
      .select({
        gymId: athletes.gymId,
        count: count(),
      })
      .from(athletes)
      .where(
        and(
          sql`${athletes.gymId} IN (${sql.join(gymIds.map((id) => sql`${id}`), sql`, `)})`,
          eq(athletes.isActive, true)
        )
      )
      .groupBy(athletes.gymId);

    athleteCounts = Object.fromEntries(
      athleteRows.map((r) => [r.gymId, Number(r.count)])
    );

    // Session counts per gym
    const sessionRows = await db
      .select({
        gymId: sessions.gymId,
        count: count(),
      })
      .from(sessions)
      .where(
        sql`${sessions.gymId} IN (${sql.join(gymIds.map((id) => sql`${id}`), sql`, `)})`
      )
      .groupBy(sessions.gymId);

    sessionCounts = Object.fromEntries(
      sessionRows.map((r) => [r.gymId, Number(r.count)])
    );

    // Agent status per gym
    const agentRows = await db
      .select({
        gymId: agents.gymId,
        status: agents.status,
        count: count(),
      })
      .from(agents)
      .where(
        sql`${agents.gymId} IN (${sql.join(gymIds.map((id) => sql`${id}`), sql`, `)})`
      )
      .groupBy(agents.gymId, agents.status);

    for (const row of agentRows) {
      if (!agentStatuses[row.gymId]) {
        agentStatuses[row.gymId] = { online: 0, total: 0 };
      }
      agentStatuses[row.gymId].total += Number(row.count);
      if (row.status === "online") {
        agentStatuses[row.gymId].online += Number(row.count);
      }
    }

    // Last session per gym
    const lastSessionRows = await db
      .select({
        gymId: sessions.gymId,
        lastSession: max(sessions.startedAt),
      })
      .from(sessions)
      .where(
        sql`${sessions.gymId} IN (${sql.join(gymIds.map((id) => sql`${id}`), sql`, `)})`
      )
      .groupBy(sessions.gymId);

    lastSessions = Object.fromEntries(
      lastSessionRows.map((r) => [r.gymId, r.lastSession])
    );
  }

  // 7. Enrich gyms with stats
  const data = gymRows.map((gym) => ({
    ...gym,
    stats: {
      activeAthletes: athleteCounts[gym.id] ?? 0,
      totalSessions: sessionCounts[gym.id] ?? 0,
      agentsOnline: agentStatuses[gym.id]?.online ?? 0,
      agentsTotal: agentStatuses[gym.id]?.total ?? 0,
      lastSession: lastSessions[gym.id] ?? null,
    },
  }));

  return ok({
    data,
    pagination: paginationMeta(Number(total), { page, limit }),
  });
}

export async function POST(request: Request) {
  // 1. Auth
  const authResult = await requireSuperAdminApi();
  if (isAuthError(authResult)) {
    const code = authResult.status === 401 ? ApiErrorCode.UNAUTHORIZED : ApiErrorCode.FORBIDDEN;
    return error(authResult.error, code, authResult.status);
  }

  // 2. Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body", ApiErrorCode.VALIDATION_ERROR, 422);
  }

  // 3. Validate
  const validation = validateBody(CreateGymSchema, body);
  if (!validation.success) return validation.response;

  const { name, slug, address, ownerEmail, plan, maxAthletes } = validation.data;

  // 4. Check slug uniqueness
  const existing = await db
    .select({ id: gyms.id })
    .from(gyms)
    .where(eq(gyms.slug, slug));

  if (existing.length > 0) {
    return error("Slug already taken", ApiErrorCode.SLUG_TAKEN, 409);
  }

  // 5. Create Clerk organization
  let clerkOrgId: string;
  try {
    const clerk = await clerkClient();
    const org = await clerk.organizations.createOrganization({
      name,
      slug,
    });
    clerkOrgId = org.id;

    // 6. Invite owner
    await clerk.organizations.createOrganizationInvitation({
      organizationId: clerkOrgId,
      emailAddress: ownerEmail,
      role: "org:admin",
      inviterUserId: authResult.clerkUserId,
    });
  } catch (err) {
    return error(
      `Failed to create organization: ${err instanceof Error ? err.message : "Unknown error"}`,
      ApiErrorCode.CLERK_ERROR,
      500
    );
  }

  // 7. Insert gym in DB
  const [gym] = await db
    .insert(gyms)
    .values({
      name,
      slug,
      address,
      clerkOrgId,
      subscriptionStatus: "active",
      subscriptionPlan: plan,
      maxAthletes,
    })
    .returning();

  return ok(gym, 201);
}
