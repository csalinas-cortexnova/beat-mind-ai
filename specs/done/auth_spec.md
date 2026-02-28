# Authentication and Authorization Specification

**Module:** Auth | **Version:** 1.0 | **Date:** 2026-02-26 | **Status:** Draft

---

## 1. Overview

BeatMind AI is a multi-tenant SaaS platform for gyms, pilates studios, cycling centers, and fitness academies. The authentication and authorization system must support four distinct user roles, two non-Clerk auth mechanisms (TV display and local agent), and strict tenant isolation across all data access paths.

### Auth Strategy Summary

| Auth Mechanism | Use Case | Provider |
|----------------|----------|----------|
| Clerk Organizations | Web app (SuperAdmin, Owner, Trainer, Athlete) | Clerk |
| UUID Token | TV display at the gym | Custom (database) |
| Header-based credentials | Mini PC local agent | Custom (database) |

### Key Principles

- **Tenant isolation by default.** Every database query that touches tenant data must include a `gym_id` filter. No exceptions.
- **Least privilege.** Each role sees only the routes and data it needs. A Trainer cannot access SuperAdmin routes. An Athlete cannot access gym management routes.
- **Defense in depth.** Auth is enforced at three layers: Next.js middleware (route-level), server-side auth guards (function-level), and database query scoping (data-level).
- **No Clerk dependency for hardware paths.** The TV display and local agent must authenticate without Clerk to eliminate external service dependencies in real-time critical paths.

---

## 2. Clerk Multi-Tenancy Setup

### 2.1 Organization Model

Each gym registered on the platform maps to exactly one Clerk Organization. When a SuperAdmin creates a new gym via the `/superadmin` dashboard, the system:

1. Creates a row in the `gyms` table with a generated UUID.
2. Calls the Clerk Backend API to create an Organization.
3. Stores the returned `clerk_org_id` in the `gyms` row.
4. Invites the gym owner via Clerk Organization Invitation.

### 2.2 Role Definitions

| Role | Clerk Representation | Scope |
|------|---------------------|-------|
| **SuperAdmin** | `publicMetadata.is_superadmin: true` on the Clerk User object | Platform-wide. Not tied to any Organization. |
| **Gym Owner** | Organization member with role `org:admin` | Single gym (Organization). Full gym management. |
| **Trainer** | Organization member with role `org:trainer` | Single gym (Organization). Sessions, athletes, reports. |
| **Athlete** | Organization member with role `org:athlete` | Single gym (Organization). Own data only. |

### 2.3 Custom Roles Configuration

Custom roles must be configured in the Clerk Dashboard under **Organizations > Roles**:

```
Role Key         Display Name     Permissions
─────────────────────────────────────────────────────────
org:admin        Gym Owner        org:gym:manage, org:trainers:manage, org:athletes:manage, org:sessions:manage, org:settings:manage, org:tv:manage
org:trainer      Trainer          org:athletes:manage, org:sessions:manage, org:athletes:read
org:athlete      Athlete          org:athlete:read_own
```

### 2.4 Custom Permissions

Define these permissions in Clerk Dashboard under **Organizations > Permissions**:

| Permission Key | Description |
|---------------|-------------|
| `org:gym:manage` | Full gym CRUD (profile, branding, subscription view) |
| `org:trainers:manage` | Invite, edit, remove trainers |
| `org:athletes:manage` | CRUD athletes, assign bands |
| `org:athletes:read` | Read athlete profiles and session data |
| `org:sessions:manage` | Start, end, view sessions |
| `org:settings:manage` | Gym settings, timezone, language |
| `org:tv:manage` | View and regenerate TV access token |
| `org:athlete:read_own` | Athlete reads own profile and sessions |

### 2.5 SuperAdmin Designation

SuperAdmin is NOT an Organization role. It is a platform-level flag stored in the Clerk User's `publicMetadata`:

```json
{
  "is_superadmin": true
}
```

This flag is set manually via the Clerk Dashboard or programmatically via the Clerk Backend API during initial platform setup. It must never be settable by any user-facing endpoint.

The local database `users` table mirrors this flag:

```sql
users.is_superadmin BOOLEAN DEFAULT false
```

Both sources must agree. The Clerk `publicMetadata` is the source of truth; the database field is a cache for queries that do not call Clerk (e.g., database joins for reporting).

---

## 3. Route Protection Matrix

### 3.1 Page Routes

| Route Pattern | Auth Method | Allowed Roles | Redirect on Fail |
|--------------|-------------|---------------|------------------|
| `/` | None (public) | Everyone | N/A |
| `/sign-in(.*)` | None (public) | Everyone | N/A |
| `/sign-up(.*)` | None (public) | Everyone | N/A |
| `/superadmin/*` | Clerk + `is_superadmin` check | SuperAdmin only | `/sign-in` if unauthenticated, `/unauthorized` if wrong role |
| `/gym/*` | Clerk + active org membership | Gym Owner, Trainer | `/sign-in` if unauthenticated, `/unauthorized` if not a member |
| `/athlete/*` | Clerk + active org membership | Athlete | `/sign-in` if unauthenticated, `/unauthorized` if wrong role |
| `/tv/[gymId]` | UUID token via query param `?token=TOKEN` | Public with valid token | `/tv/invalid-token` error page |

### 3.2 API Routes

| Route Pattern | Auth Method | Allowed Roles | Error Response |
|--------------|-------------|---------------|----------------|
| `/api/agent/heartbeat` | `X-Agent-Id` + `X-Agent-Secret` headers | Registered agent | `401 Unauthorized` |
| `/api/agent/status` | `X-Agent-Id` + `X-Agent-Secret` headers | Registered agent | `401 Unauthorized` |
| `/api/v1/superadmin/*` | Clerk + `is_superadmin` check | SuperAdmin only | `401` / `403` |
| `/api/v1/gym/*` | Clerk + org membership check | Gym Owner, Trainer | `401` / `403` |
| `/api/v1/athlete/*` | Clerk + org membership check | Athlete | `401` / `403` |
| `/api/v1/reports/*` | Clerk + org membership check | Owner, Trainer, Athlete (own) | `401` / `403` |

### 3.3 WebSocket Endpoints

| Endpoint | Auth Method | Notes |
|----------|-------------|-------|
| `/ws/agent` | `X-Agent-Id` + `X-Agent-Secret` in initial handshake headers | Validated on connection upgrade |
| `/ws/tv/[gymId]?token=TOKEN` | UUID token in query param | Validated on connection upgrade |

---

## 4. Middleware Implementation

### 4.1 File Location

```
middleware.ts    (project root)
```

### 4.2 Implementation

```typescript
// middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Routes that require no authentication at all
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/tv/(.*)",           // TV uses token auth, not Clerk
  "/api/agent/(.*)",    // Agent uses header auth, not Clerk
  "/unauthorized",
]);

// Routes restricted to SuperAdmin
const isSuperAdminRoute = createRouteMatcher([
  "/superadmin(.*)",
  "/api/v1/superadmin(.*)",
]);

// Routes restricted to gym staff (Owner + Trainer)
const isGymRoute = createRouteMatcher([
  "/gym(.*)",
  "/api/v1/gym(.*)",
]);

// Routes restricted to athletes
const isAthleteRoute = createRouteMatcher([
  "/athlete(.*)",
  "/api/v1/athlete(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  const { pathname } = request.nextUrl;

  // 1. Public routes: no Clerk enforcement
  if (isPublicRoute(request)) {
    return NextResponse.next();
  }

  // 2. All remaining routes require authentication
  const { userId, sessionClaims, orgId, orgRole } = await auth();

  if (!userId) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect_url", request.url);
    return NextResponse.redirect(signInUrl);
  }

  // 3. SuperAdmin routes: check publicMetadata.is_superadmin
  if (isSuperAdminRoute(request)) {
    const isSuperAdmin =
      sessionClaims?.publicMetadata?.is_superadmin === true;
    if (!isSuperAdmin) {
      return NextResponse.redirect(
        new URL("/unauthorized", request.url)
      );
    }
    return NextResponse.next();
  }

  // 4. Gym routes: require active org membership with org:admin or org:trainer
  if (isGymRoute(request)) {
    if (!orgId) {
      return NextResponse.redirect(
        new URL("/unauthorized", request.url)
      );
    }
    const allowedRoles = ["org:admin", "org:trainer"];
    if (!orgRole || !allowedRoles.includes(orgRole)) {
      return NextResponse.redirect(
        new URL("/unauthorized", request.url)
      );
    }
    return NextResponse.next();
  }

  // 5. Athlete routes: require active org membership with org:athlete
  if (isAthleteRoute(request)) {
    if (!orgId) {
      return NextResponse.redirect(
        new URL("/unauthorized", request.url)
      );
    }
    if (orgRole !== "org:athlete") {
      return NextResponse.redirect(
        new URL("/unauthorized", request.url)
      );
    }
    return NextResponse.next();
  }

  // 6. All other authenticated routes: allow if signed in
  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
```

### 4.3 Middleware Behavior Notes

- The middleware runs on the Edge runtime. It must not import server-only modules or perform database queries directly.
- Clerk session claims are available in the middleware via `auth()`. The `publicMetadata` containing `is_superadmin` is included in session claims by default.
- For gym and athlete routes, the middleware checks `orgId` and `orgRole` from the active organization context. The user must have an active organization selected in Clerk for these checks to pass.
- TV and agent routes bypass Clerk entirely. Their auth is handled inside the respective route handlers / WebSocket server.

### 4.4 Active Organization Requirement

Clerk's organization context requires the user to have an active organization selected. This is managed via:

1. **Automatic selection on sign-in:** If the user belongs to exactly one organization, Clerk auto-selects it.
2. **Organization switcher:** If the user belongs to multiple organizations (e.g., a trainer working at two gyms), the UI must present an `<OrganizationSwitcher />` component.
3. **Redirect on missing org:** If a user hits `/gym/*` without an active org, they are redirected to an org selection page.

---

## 5. Auth Guards

Server-side auth guard functions live in `lib/auth/guards.ts`. These are called inside Server Components, Server Actions, and API Route Handlers as a second layer of defense beyond middleware.

### 5.1 File Location

```
lib/auth/guards.ts
lib/auth/agent-auth.ts
lib/auth/tv-auth.ts
lib/auth/types.ts
```

### 5.2 Type Definitions

```typescript
// lib/auth/types.ts

export interface AuthenticatedUser {
  userId: string;         // Clerk user ID
  clerkUserId: string;    // Same as userId (Clerk ID)
  dbUserId: string;       // UUID from users table
  email: string;
  isSuperAdmin: boolean;
}

export interface GymContext {
  user: AuthenticatedUser;
  gymId: string;          // UUID from gyms table
  orgId: string;          // Clerk organization ID
  role: "org:admin" | "org:trainer";
}

export interface AthleteContext {
  user: AuthenticatedUser;
  gymId: string;
  orgId: string;
  athleteId: string;      // UUID from athletes table
}

export interface AgentContext {
  agentId: string;        // UUID from agents table
  gymId: string;          // UUID from gyms table
}

export interface TvContext {
  gymId: string;          // UUID from gyms table
}
```

### 5.3 Guard Implementations

```typescript
// lib/auth/guards.ts
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { users, gyms, gymMemberships, athletes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type {
  AuthenticatedUser,
  GymContext,
  AthleteContext,
} from "./types";

/**
 * Requires the current user to be a SuperAdmin.
 * Redirects to /unauthorized if not.
 * Use in Server Components and Server Actions for /superadmin/* pages.
 */
export async function requireSuperAdmin(): Promise<AuthenticatedUser> {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const isSuperAdmin =
    sessionClaims?.publicMetadata?.is_superadmin === true;

  if (!isSuperAdmin) {
    redirect("/unauthorized");
  }

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  if (!dbUser.length) {
    redirect("/unauthorized");
  }

  return {
    userId,
    clerkUserId: userId,
    dbUserId: dbUser[0].id,
    email: dbUser[0].email,
    isSuperAdmin: true,
  };
}

/**
 * Requires the current user to be a member of the specified gym
 * with role org:admin or org:trainer.
 * Use in Server Components and Server Actions for /gym/* pages.
 *
 * @param gymId - UUID of the gym (from route params or resolved from org)
 */
export async function requireGymAccess(
  gymId?: string
): Promise<GymContext> {
  const { userId, orgId, orgRole } = await auth();

  if (!userId || !orgId) {
    redirect("/sign-in");
  }

  const allowedRoles = ["org:admin", "org:trainer"];
  if (!orgRole || !allowedRoles.includes(orgRole)) {
    redirect("/unauthorized");
  }

  // Resolve gym from Clerk org ID
  const gym = await db
    .select()
    .from(gyms)
    .where(eq(gyms.clerkOrgId, orgId))
    .limit(1);

  if (!gym.length) {
    redirect("/unauthorized");
  }

  const resolvedGymId = gym[0].id;

  // If a specific gymId was requested, verify it matches the active org
  if (gymId && gymId !== resolvedGymId) {
    redirect("/unauthorized");
  }

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  if (!dbUser.length) {
    redirect("/unauthorized");
  }

  return {
    user: {
      userId,
      clerkUserId: userId,
      dbUserId: dbUser[0].id,
      email: dbUser[0].email,
      isSuperAdmin: false,
    },
    gymId: resolvedGymId,
    orgId,
    role: orgRole as "org:admin" | "org:trainer",
  };
}

/**
 * Requires the current user to be an org:trainer (or org:admin)
 * in the active organization.
 * Stricter than requireGymAccess -- use where only trainers+ should operate.
 */
export async function requireTrainer(): Promise<GymContext> {
  const ctx = await requireGymAccess();
  // org:admin can also perform trainer actions (superset)
  return ctx;
}

/**
 * Requires the current user to be an org:admin (gym owner)
 * in the active organization.
 */
export async function requireGymOwner(): Promise<GymContext> {
  const ctx = await requireGymAccess();
  if (ctx.role !== "org:admin") {
    redirect("/unauthorized");
  }
  return ctx;
}

/**
 * Requires the current user to be an athlete in the active organization.
 * Resolves the athlete profile from the database.
 */
export async function requireAthlete(): Promise<AthleteContext> {
  const { userId, orgId, orgRole } = await auth();

  if (!userId || !orgId) {
    redirect("/sign-in");
  }

  if (orgRole !== "org:athlete") {
    redirect("/unauthorized");
  }

  // Resolve gym
  const gym = await db
    .select()
    .from(gyms)
    .where(eq(gyms.clerkOrgId, orgId))
    .limit(1);

  if (!gym.length) {
    redirect("/unauthorized");
  }

  // Resolve user
  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  if (!dbUser.length) {
    redirect("/unauthorized");
  }

  // Resolve athlete profile
  const athlete = await db
    .select()
    .from(athletes)
    .where(
      and(
        eq(athletes.userId, dbUser[0].id),
        eq(athletes.gymId, gym[0].id),
        eq(athletes.isActive, true)
      )
    )
    .limit(1);

  if (!athlete.length) {
    redirect("/unauthorized");
  }

  return {
    user: {
      userId,
      clerkUserId: userId,
      dbUserId: dbUser[0].id,
      email: dbUser[0].email,
      isSuperAdmin: false,
    },
    gymId: gym[0].id,
    orgId,
    athleteId: athlete[0].id,
  };
}
```

### 5.4 API Route Guard Variants

For API Route Handlers, guards must return JSON error responses instead of redirects:

```typescript
// lib/auth/guards.ts (continued)
import { NextResponse } from "next/server";

/**
 * API variant: returns 401/403 JSON instead of redirect.
 */
export async function requireSuperAdminApi(): Promise<
  AuthenticatedUser | NextResponse
> {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  if (sessionClaims?.publicMetadata?.is_superadmin !== true) {
    return NextResponse.json(
      { error: "Forbidden: SuperAdmin access required" },
      { status: 403 }
    );
  }

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  if (!dbUser.length) {
    return NextResponse.json(
      { error: "User not found in database" },
      { status: 403 }
    );
  }

  return {
    userId,
    clerkUserId: userId,
    dbUserId: dbUser[0].id,
    email: dbUser[0].email,
    isSuperAdmin: true,
  };
}

/**
 * API variant for gym routes. Returns 401/403 JSON.
 */
export async function requireGymAccessApi(
  gymId?: string
): Promise<GymContext | NextResponse> {
  const { userId, orgId, orgRole } = await auth();

  if (!userId || !orgId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const allowedRoles = ["org:admin", "org:trainer"];
  if (!orgRole || !allowedRoles.includes(orgRole)) {
    return NextResponse.json(
      { error: "Forbidden: Gym staff access required" },
      { status: 403 }
    );
  }

  const gym = await db
    .select()
    .from(gyms)
    .where(eq(gyms.clerkOrgId, orgId))
    .limit(1);

  if (!gym.length) {
    return NextResponse.json(
      { error: "Gym not found" },
      { status: 403 }
    );
  }

  if (gymId && gymId !== gym[0].id) {
    return NextResponse.json(
      { error: "Forbidden: Gym mismatch" },
      { status: 403 }
    );
  }

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  if (!dbUser.length) {
    return NextResponse.json(
      { error: "User not found" },
      { status: 403 }
    );
  }

  return {
    user: {
      userId,
      clerkUserId: userId,
      dbUserId: dbUser[0].id,
      email: dbUser[0].email,
      isSuperAdmin: false,
    },
    gymId: gym[0].id,
    orgId,
    role: orgRole as "org:admin" | "org:trainer",
  };
}

/**
 * Helper: check if result is an error response.
 */
export function isAuthError(
  result: unknown
): result is NextResponse {
  return result instanceof NextResponse;
}
```

### 5.5 Usage Examples

```typescript
// app/superadmin/page.tsx (Server Component)
import { requireSuperAdmin } from "@/lib/auth/guards";

export default async function SuperAdminPage() {
  const admin = await requireSuperAdmin();
  // admin.dbUserId is available, page renders only for SuperAdmins
}

// app/api/v1/gym/athletes/route.ts (API Route)
import { requireGymAccessApi, isAuthError } from "@/lib/auth/guards";

export async function GET() {
  const result = await requireGymAccessApi();
  if (isAuthError(result)) return result;
  // result is GymContext, use result.gymId to scope queries
}
```

---

## 6. Agent Authentication

### 6.1 Overview

The local agent (mini PC at each gym) authenticates to the VPS API using HTTP headers. This mechanism is completely independent of Clerk, avoiding external dependencies in the hardware-to-server data pipeline.

### 6.2 Credentials

Each agent has a record in the `agents` table:

```sql
agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id),
  agent_secret TEXT NOT NULL,  -- bcrypt hash of the secret
  name TEXT,
  status TEXT DEFAULT 'offline',
  last_heartbeat TIMESTAMPTZ,
  ...
)
```

The `agent_secret` column stores a **bcrypt hash** of the secret. The plaintext secret is provided to the agent operator during initial setup and is never stored on the server.

### 6.3 Auth Headers

Every request from the agent to the VPS must include:

```
X-Agent-Id: <agent UUID>
X-Agent-Secret: <plaintext secret>
```

### 6.4 Auth Implementation

```typescript
// lib/auth/agent-auth.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import type { AgentContext } from "./types";

/**
 * Verifies agent authentication from request headers.
 * Returns AgentContext on success, NextResponse (401) on failure.
 */
export async function verifyAgentAuth(
  request: NextRequest
): Promise<AgentContext | NextResponse> {
  const agentId = request.headers.get("X-Agent-Id");
  const agentSecret = request.headers.get("X-Agent-Secret");

  if (!agentId || !agentSecret) {
    return NextResponse.json(
      { error: "Missing agent credentials" },
      { status: 401 }
    );
  }

  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(agentId)) {
    return NextResponse.json(
      { error: "Invalid agent ID format" },
      { status: 401 }
    );
  }

  const agent = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent.length) {
    return NextResponse.json(
      { error: "Agent not found" },
      { status: 401 }
    );
  }

  // Compare provided secret against stored bcrypt hash
  const secretValid = await bcrypt.compare(
    agentSecret,
    agent[0].agentSecret
  );

  if (!secretValid) {
    return NextResponse.json(
      { error: "Invalid agent secret" },
      { status: 401 }
    );
  }

  // Update last heartbeat timestamp
  await db
    .update(agents)
    .set({
      lastHeartbeat: new Date(),
      status: "online",
    })
    .where(eq(agents.id, agentId));

  return {
    agentId: agent[0].id,
    gymId: agent[0].gymId,
  };
}

/**
 * Verifies agent auth for WebSocket upgrade requests.
 * Same logic as verifyAgentAuth but accepts raw headers object.
 */
export async function verifyAgentWsAuth(
  agentId: string,
  agentSecret: string
): Promise<AgentContext | null> {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(agentId)) return null;

  const agent = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent.length) return null;

  const secretValid = await bcrypt.compare(
    agentSecret,
    agent[0].agentSecret
  );

  if (!secretValid) return null;

  return {
    agentId: agent[0].id,
    gymId: agent[0].gymId,
  };
}
```

### 6.5 Agent API Route Usage

```typescript
// app/api/agent/heartbeat/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyAgentAuth } from "@/lib/auth/agent-auth";
import { isAuthError } from "@/lib/auth/guards";

export async function POST(request: NextRequest) {
  const authResult = await verifyAgentAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { agentId, gymId } = authResult;
  const body = await request.json();

  // Process heartbeat data scoped to gymId
  // ...

  return NextResponse.json({ status: "ok" });
}
```

### 6.6 Agent Secret Generation

When a SuperAdmin registers a new agent, the system:

1. Generates a cryptographically random 48-character secret using `crypto.randomBytes(36).toString('base64url')`.
2. Hashes the secret with bcrypt (cost factor 12).
3. Stores the hash in `agents.agent_secret`.
4. Returns the plaintext secret to the SuperAdmin **once** for configuration on the mini PC `.env` file.
5. The plaintext secret is never stored or logged on the server.

---

## 7. TV Token Authentication

### 7.1 Overview

The TV dashboard at each gym (`/tv/[gymId]?token=TOKEN`) is displayed on a wall-mounted screen. It does not use Clerk authentication because:

- There is no keyboard/mouse to sign in.
- The TV browser is a static kiosk display.
- Clerk session tokens expire, requiring periodic re-authentication.

Instead, each gym has a persistent UUID token stored in the `gyms` table.

### 7.2 Token Storage

```sql
gyms (
  ...
  tv_access_token UUID DEFAULT gen_random_uuid(),
  ...
)
```

### 7.3 Token Verification

```typescript
// lib/auth/tv-auth.ts
import { db } from "@/lib/db";
import { gyms } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { TvContext } from "./types";

/**
 * Verifies a TV access token for a given gym.
 * Returns TvContext on success, null on failure.
 */
export async function verifyTvToken(
  gymId: string,
  token: string
): Promise<TvContext | null> {
  // Validate UUID formats
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(gymId) || !uuidRegex.test(token)) {
    return null;
  }

  const gym = await db
    .select({ id: gyms.id, tvAccessToken: gyms.tvAccessToken })
    .from(gyms)
    .where(
      and(
        eq(gyms.id, gymId),
        eq(gyms.tvAccessToken, token)
      )
    )
    .limit(1);

  if (!gym.length) {
    return null;
  }

  return { gymId: gym[0].id };
}

/**
 * Regenerates the TV access token for a gym.
 * Must be called by a gym owner (org:admin).
 * Returns the new token.
 */
export async function regenerateTvToken(
  gymId: string
): Promise<string> {
  const newToken = crypto.randomUUID();

  await db
    .update(gyms)
    .set({ tvAccessToken: newToken })
    .where(eq(gyms.id, gymId));

  return newToken;
}
```

### 7.4 TV Page Route Handler

```typescript
// app/tv/[gymId]/page.tsx
import { verifyTvToken } from "@/lib/auth/tv-auth";
import { redirect } from "next/navigation";

interface TvPageProps {
  params: Promise<{ gymId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function TvPage({
  params,
  searchParams,
}: TvPageProps) {
  const { gymId } = await params;
  const { token } = await searchParams;

  if (!token) {
    redirect("/tv/error?reason=missing-token");
  }

  const tvContext = await verifyTvToken(gymId, token);

  if (!tvContext) {
    redirect("/tv/error?reason=invalid-token");
  }

  // Render TV dashboard for this gym
  return <TvDashboard gymId={tvContext.gymId} />;
}
```

### 7.5 TV WebSocket Authentication

The WebSocket server (separate process) validates the TV token during the connection upgrade:

```typescript
// ws-server.ts (excerpt)
import { verifyTvToken } from "./lib/auth/tv-auth";

wss.on("connection", async (ws, request) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  const pathMatch = url.pathname.match(/^\/ws\/tv\/([^/]+)$/);

  if (!pathMatch) {
    ws.close(4000, "Invalid path");
    return;
  }

  const gymId = pathMatch[1];
  const token = url.searchParams.get("token");

  if (!token) {
    ws.close(4001, "Missing token");
    return;
  }

  const tvContext = await verifyTvToken(gymId, token);

  if (!tvContext) {
    ws.close(4003, "Invalid token");
    return;
  }

  // Authenticated. Subscribe this connection to gym updates.
  subscribeToGym(ws, tvContext.gymId);
});
```

### 7.6 Token Regeneration

The gym owner can regenerate the TV token from the gym settings page. This immediately invalidates the previous token and requires updating the TV browser's URL.

**UI flow:**
1. Owner navigates to `/gym/settings` > TV Display section.
2. Current token is displayed (masked: `xxxxxxxx-xxxx-xxxx-xxxx-xxxx****1234`).
3. "Regenerate Token" button triggers a Server Action.
4. Server Action calls `requireGymOwner()` + `regenerateTvToken(gymId)`.
5. New full URL is displayed for copy: `https://app.beatmind.ai/tv/{gymId}?token={newToken}`.
6. The old TV connection will receive a WebSocket close event and must be refreshed with the new URL.

---

## 8. User Invitation Flow

### 8.1 Platform Setup (One-time)

1. Deploy application.
2. SuperAdmin signs up via Clerk.
3. Platform operator sets `publicMetadata.is_superadmin: true` on the SuperAdmin user via Clerk Dashboard or Backend API.
4. Create the corresponding `users` row with `is_superadmin = true`.

### 8.2 Gym Onboarding

```
SuperAdmin                    Clerk API                    Database
    |                             |                           |
    |-- Create Gym ------------->|                           |
    |                             |-- Create Organization -->|
    |                             |                           |-- INSERT gyms
    |                             |<-- org_id ---------------|
    |                             |                           |
    |-- Invite Owner (email) --->|                           |
    |                             |-- Send Invitation ------>|  (email)
    |                             |   role: org:admin         |
    |                             |                           |
    |                    Owner clicks invite link              |
    |                             |                           |
    |                             |-- Create membership ----->|-- INSERT users
    |                             |   org:admin               |-- INSERT gym_memberships
```

**Step-by-step:**

1. SuperAdmin fills out "Create Gym" form: name, address, timezone, language, subscription plan, max athletes, owner email.
2. Server Action `createGym()`:
   a. Call `clerkClient.organizations.createOrganization({ name: gymName })`.
   b. Insert `gyms` row with `clerk_org_id`, generate `tv_access_token`.
   c. Call `clerkClient.organizations.createOrganizationInvitation({ organizationId, emailAddress: ownerEmail, role: "org:admin" })`.
3. Owner receives email invitation, signs up / signs in via Clerk.
4. Clerk webhook `organization.membership.created` fires.
5. Webhook handler inserts/updates `users` and `gym_memberships` rows.

### 8.3 Trainer Onboarding

1. Gym Owner navigates to `/gym/trainers` and clicks "Invite Trainer".
2. Enters trainer email.
3. Server Action `inviteTrainer()`:
   a. Verify `requireGymOwner()`.
   b. Call `clerkClient.organizations.createOrganizationInvitation({ organizationId: gym.clerkOrgId, emailAddress, role: "org:trainer" })`.
4. Trainer receives email, signs up, auto-joins the organization.
5. Webhook handler creates `users` and `gym_memberships` rows.

### 8.4 Athlete Onboarding

1. Gym Owner or Trainer navigates to `/gym/athletes` and clicks "Add Athlete".
2. Enters athlete details: name, email, phone, age, weight, max HR.
3. Server Action `createAthlete()`:
   a. Verify `requireGymAccess()`.
   b. Insert `athletes` row (with `user_id = NULL` initially).
   c. Optionally invite via Clerk: `clerkClient.organizations.createOrganizationInvitation({ organizationId, emailAddress, role: "org:athlete" })`.
   d. If athlete signs up, webhook links `athletes.user_id` to the new `users.id`.
4. Athletes without Clerk accounts can still be tracked via sensor (HR monitoring works without portal access).

### 8.5 Clerk Webhooks

Register a webhook endpoint at `/api/webhooks/clerk` to handle:

| Event | Handler Action |
|-------|---------------|
| `user.created` | Insert row into `users` table |
| `user.updated` | Update `users` row (email, name, is_superadmin sync) |
| `user.deleted` | Soft-delete or deactivate user |
| `organization.created` | Verify matching `gyms` row exists |
| `organizationMembership.created` | Insert `gym_memberships` row, link athlete if applicable |
| `organizationMembership.updated` | Update role in `gym_memberships` |
| `organizationMembership.deleted` | Deactivate `gym_memberships` row |

**Webhook verification:** Use Clerk's `svix` library to verify webhook signatures:

```typescript
// app/api/webhooks/clerk/route.ts
import { Webhook } from "svix";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    throw new Error("CLERK_WEBHOOK_SECRET is not set");
  }

  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing svix headers" },
      { status: 400 }
    );
  }

  const payload = await request.json();
  const body = JSON.stringify(payload);

  const wh = new Webhook(WEBHOOK_SECRET);
  let event: any;

  try {
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 }
    );
  }

  // Route to handlers based on event.type
  switch (event.type) {
    case "user.created":
      await handleUserCreated(event.data);
      break;
    case "organizationMembership.created":
      await handleMembershipCreated(event.data);
      break;
    // ... other handlers
  }

  return NextResponse.json({ received: true });
}
```

---

## 9. Session Management

### 9.1 Clerk Session Configuration

Configure in Clerk Dashboard:

| Setting | Value | Rationale |
|---------|-------|-----------|
| Session lifetime | 7 days | Gym staff stays signed in across shifts |
| Inactivity timeout | 24 hours | Auto-expire inactive sessions |
| Multi-session mode | Disabled | Single active session per device |
| Token lifetime | 60 seconds | Short-lived JWTs, auto-refreshed by Clerk SDK |

### 9.2 Token Refresh

Clerk handles JWT refresh automatically via the `<ClerkProvider>` wrapper:

- The Clerk frontend SDK detects when the JWT is about to expire.
- It silently refreshes by calling Clerk's session API.
- Server Components always get a fresh token via `auth()`.
- Client Components use `useAuth().getToken()` which returns a valid token.

### 9.3 Organization Context Persistence

When a user selects an organization (gym), the selection is persisted in their Clerk session. Subsequent requests include the `orgId` and `orgRole` automatically.

```typescript
// ClerkProvider configuration in app/layout.tsx
import { ClerkProvider } from "@clerk/nextjs";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      afterSignOutUrl="/"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
    >
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

### 9.4 Post-Login Redirect Logic

After sign-in, the user is redirected based on their role:

```typescript
// lib/auth/redirect.ts

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export async function redirectByRole(): Promise<never> {
  const { userId, sessionClaims, orgId, orgRole } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  // SuperAdmin
  if (sessionClaims?.publicMetadata?.is_superadmin === true) {
    redirect("/superadmin");
  }

  // Must have an active organization
  if (!orgId || !orgRole) {
    redirect("/org-selection");
  }

  // Route by org role
  switch (orgRole) {
    case "org:admin":
    case "org:trainer":
      redirect("/gym");
    case "org:athlete":
      redirect("/athlete");
    default:
      redirect("/unauthorized");
  }
}
```

### 9.5 Dashboard Route

```typescript
// app/dashboard/page.tsx
import { redirectByRole } from "@/lib/auth/redirect";

export default async function DashboardPage() {
  await redirectByRole();
  // This line is never reached; redirectByRole always redirects
}
```

---

## 10. Security Considerations

### 10.1 CSRF Protection

- **Next.js Server Actions** include built-in CSRF protection via the `Origin` header check. No additional configuration needed for form submissions.
- **API Routes** receiving requests from the local agent (mini PC) do not need CSRF tokens because they use header-based authentication (not cookies). The `X-Agent-Id` and `X-Agent-Secret` headers serve as a CSRF-equivalent proof of intent.
- **Clerk-authenticated API Routes** are protected by Clerk's session token, which is sent via cookie. The Clerk middleware validates the session, which implicitly mitigates CSRF because the session token is httpOnly and Clerk validates the request origin.

### 10.2 Rate Limiting

Apply rate limiting at the API layer:

| Endpoint Group | Limit | Window | Key |
|---------------|-------|--------|-----|
| `/api/agent/heartbeat` | 20 req | 1 second | Agent ID |
| `/api/agent/status` | 5 req | 1 minute | Agent ID |
| `/api/v1/superadmin/*` | 100 req | 1 minute | User ID |
| `/api/v1/gym/*` | 200 req | 1 minute | User ID + Org ID |
| `/api/v1/athlete/*` | 100 req | 1 minute | User ID |
| `/api/v1/reports/*/send-whatsapp` | 5 req | 1 minute | User ID |
| `/api/webhooks/clerk` | 100 req | 1 minute | IP |
| `/sign-in`, `/sign-up` | 10 req | 1 minute | IP |

Implementation: Use an in-memory rate limiter (e.g., `@upstash/ratelimit` with Redis, or a simple sliding window with `Map` for single-instance deployments).

```typescript
// lib/rate-limit.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const agentHeartbeatLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, "1 s"),
  prefix: "rl:agent:heartbeat",
});

export const apiLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(200, "1 m"),
  prefix: "rl:api",
});
```

### 10.3 Token Rotation

| Token Type | Rotation Policy |
|-----------|----------------|
| Agent Secret | Rotate on demand via SuperAdmin dashboard. Old secret invalidated immediately. |
| TV Access Token | Rotate on demand via Gym Owner settings. Old token invalidated immediately. |
| Clerk Session Token | Auto-rotated by Clerk (60s JWT lifetime). |
| Clerk Webhook Secret | Rotate in Clerk Dashboard + update `CLERK_WEBHOOK_SECRET` env var. |

### 10.4 Credential Storage

| Credential | Storage Location | Format |
|-----------|-----------------|--------|
| `CLERK_SECRET_KEY` | Environment variable (`.env.local`) | Plaintext (Clerk API key) |
| `CLERK_WEBHOOK_SECRET` | Environment variable (`.env.local`) | Plaintext (svix signing secret) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Environment variable (`.env.local`) | Plaintext (public, safe to expose) |
| Agent secrets | `agents.agent_secret` column | bcrypt hash (cost 12) |
| TV tokens | `gyms.tv_access_token` column | UUID plaintext (compared directly) |
| Database password | Environment variable (`DATABASE_URL`) | Plaintext in connection string |

**Critical rules:**
- `.env.local` must be in `.gitignore`. Verify this on every deployment.
- Never log agent secrets, even in error messages.
- Never return full TV tokens in API list responses; mask all but last 4 characters.
- Clerk keys must be rotated if suspected compromise (see PRD Section 10).

### 10.5 Data Isolation

All database queries that access tenant-specific data must include a `gym_id` filter. This is enforced by the auth guards returning a `gymId` in every context object, and by the `withGymScope` utility:

```typescript
// lib/utils/gym-scope.ts
import { eq } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Returns a Drizzle where clause that scopes queries to a specific gym.
 * Use this in every query that touches tenant data.
 */
export function withGymScope(column: PgColumn, gymId: string) {
  return eq(column, gymId);
}

// Usage:
// db.select().from(athletes).where(withGymScope(athletes.gymId, ctx.gymId))
```

### 10.6 Security Headers

Set the following headers via `next.config.ts`:

```typescript
// next.config.ts
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://clerk.beatmind.ai; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://clerk.beatmind.ai wss://*.beatmind.ai; frame-src https://clerk.beatmind.ai;",
          },
        ],
      },
      {
        // TV route: allow framing for kiosk mode
        source: "/tv/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
```

### 10.7 Audit Logging

Log all authentication-sensitive events to a structured log:

| Event | Data Logged |
|-------|------------|
| SuperAdmin action | userId, action, targetGymId, timestamp |
| Gym owner invites member | userId, orgId, inviteeEmail, role, timestamp |
| Agent credential rotation | superAdminUserId, agentId, timestamp |
| TV token regeneration | userId, gymId, timestamp |
| Failed auth attempt (agent) | agentId (if valid), IP, timestamp |
| Failed auth attempt (TV) | gymId, IP, timestamp |
| Webhook received | eventType, userId/orgId, timestamp |

---

## Appendix A: Environment Variables

```env
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
CLERK_WEBHOOK_SECRET=whsec_...

# Clerk URLs
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard

# Database
DATABASE_URL=postgresql://user:password@host:5432/beatmind

# Rate Limiting (optional, if using Upstash)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

## Appendix B: Dependencies

```json
{
  "@clerk/nextjs": "^6.x",
  "svix": "^1.x",
  "bcryptjs": "^2.x",
  "@upstash/ratelimit": "^2.x",
  "@upstash/redis": "^1.x"
}
```

Install with: `bun add @clerk/nextjs svix bcryptjs @upstash/ratelimit @upstash/redis`

Dev dependency: `bun add -d @types/bcryptjs`

## Appendix C: File Structure

```
middleware.ts
lib/
  auth/
    types.ts              -- AuthenticatedUser, GymContext, AthleteContext, AgentContext, TvContext
    guards.ts             -- requireSuperAdmin, requireGymAccess, requireTrainer, requireAthlete (+ API variants)
    agent-auth.ts         -- verifyAgentAuth, verifyAgentWsAuth
    tv-auth.ts            -- verifyTvToken, regenerateTvToken
    redirect.ts           -- redirectByRole (post-login routing)
  utils/
    gym-scope.ts          -- withGymScope helper
  rate-limit.ts           -- Rate limiter instances
app/
  (auth)/
    sign-in/[[...sign-in]]/page.tsx
    sign-up/[[...sign-up]]/page.tsx
  (platform)/
    superadmin/           -- Protected by requireSuperAdmin
    gym/                  -- Protected by requireGymAccess
    athlete/              -- Protected by requireAthlete
    dashboard/page.tsx    -- Redirect router (redirectByRole)
  tv/
    [gymId]/page.tsx      -- Protected by verifyTvToken
    error/page.tsx        -- Token error display
  api/
    agent/
      heartbeat/route.ts  -- Protected by verifyAgentAuth
      status/route.ts     -- Protected by verifyAgentAuth
    v1/
      superadmin/         -- Protected by requireSuperAdminApi
      gym/                -- Protected by requireGymAccessApi
      athlete/            -- Protected by requireAthleteApi
    webhooks/
      clerk/route.ts      -- Svix signature verification
```
