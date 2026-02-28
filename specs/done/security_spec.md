# Security Architecture Specification - BeatMind AI

**Version:** 1.0 | **Date:** 2026-02-26 | **Status:** Draft
**Tech Stack:** Next.js 16, Clerk, PostgreSQL, Drizzle ORM, WebSocket (ws), PM2, VPS

---

## 1. Overview

BeatMind AI is a multi-tenant fitness SaaS platform that collects, processes, and stores real-time heart rate (HR) data from athletes across multiple gyms. HR data is health-related biometric information and must be treated with elevated care regarding privacy, isolation, and access control.

**Security posture summary:**

- **Multi-tenancy model:** Shared database, shared schema, application-layer isolation via `gym_id` foreign key on all tenant-scoped tables.
- **Attack surface:** Web application (Next.js), REST API, WebSocket server (separate PM2 process), agent API (mini PC hardware), TV dashboard (public kiosk displays).
- **Threat actors:** Unauthorized external users, compromised gym owners attempting cross-tenant access, compromised or spoofed agents (mini PCs), leaked credentials.
- **Data sensitivity:** Heart rate readings are biometric health data. While not regulated under HIPAA (non-US health provider context), they must be handled with equivalent care: encrypted in transit, access-controlled, and deletable on request.
- **Authentication providers:** Clerk (web users), custom agent credentials (mini PCs), UUID tokens (TV displays).

**Guiding principles:**

1. Defense in depth -- no single layer is trusted alone.
2. Least privilege -- every role, query, and connection gets the minimum access required.
3. Zero trust on client-supplied identifiers -- all `gym_id`, `athlete_id`, and role claims are validated server-side.
4. Fail closed -- if authentication or authorization cannot be verified, deny access.

---

## 2. Credential Management

### 2.1 CRITICAL: Credential Rotation (Immediate Action Required)

The `.env.local` file contains live production credentials that were committed to the git repository. **All exposed credentials must be rotated immediately before any other work proceeds.**

**Keys to rotate:**

| Credential | Where to Rotate | Priority |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk Dashboard > API Keys > Rotate | P0 |
| `CLERK_SECRET_KEY` | Clerk Dashboard > API Keys > Rotate | P0 |
| `DATABASE_URL` (PostgreSQL password) | VPS: `ALTER USER ... PASSWORD '...'` | P0 |
| `OPENAI_API_KEY` | OpenAI Dashboard > API Keys > Revoke + Create New | P0 |

**Rotation procedure:**

1. Generate new credentials on each provider's dashboard.
2. Update `.env.local` on the VPS with new values.
3. Restart the application (PM2 reload).
4. Verify the application works with the new credentials.
5. Revoke/delete the old credentials on each provider.

### 2.2 Clean Git History

The `.env.local` file and any `.env` files must be purged from the entire git history, not just removed from the current tree.

**Using BFG Repo-Cleaner (recommended):**

```bash
# Install BFG
brew install bfg

# Clone a fresh mirror
git clone --mirror git@github.com:YOUR_ORG/beat-mind-ai.git

# Remove .env files from all history
bfg --delete-files '.env.local' beat-mind-ai.git
bfg --delete-files '.env' beat-mind-ai.git

# Clean up and push
cd beat-mind-ai.git
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push
```

**Alternative using git filter-repo:**

```bash
git filter-repo --invert-paths --path .env.local --path .env
```

After cleaning, force-push and notify all contributors to re-clone.

### 2.3 .gitignore Verification

The current `.gitignore` includes ``.env*`` which covers `.env`, `.env.local`, `.env.production`, etc. This is correct. Verify this line exists and is not commented out:

```gitignore
# env files (can opt-in for committing if needed)
.env*
```

**Additional entries to ensure are present:**

```gitignore
# Explicitly block env files
.env
.env.local
.env.production
.env.staging

# Block credential files
*.pem
*.key
*.cert
```

The `.env.local.example` file (with placeholder values only, no real keys) is safe to commit and should remain in the repo as a template.

### 2.4 Environment Variable Management in Production (VPS)

**Storage:**

- Environment variables are stored in `.env.local` on the VPS filesystem, readable only by the application user.
- File permissions: `chmod 600 .env.local` (owner read/write only).
- Owner: The non-root user running PM2 (e.g., `beatmind`).

**Required environment variables for production:**

```bash
# App
NEXT_PUBLIC_APP_URL=https://app.beatmind.ai
NEXT_PUBLIC_SITE_URL=https://beatmind.ai
NODE_ENV=production

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...

# Database
DATABASE_URL=postgresql://beatmind_app:PASSWORD@localhost:5432/beatmind?sslmode=require

# OpenAI
OPENAI_API_KEY=sk-...

# WebSocket
WS_PORT=8080
WS_AUTH_SECRET=<random-64-char-hex>

# WhatsApp (Twilio)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+1...
```

**Rules:**

- Never log environment variables at application startup.
- Never include environment variables in error responses.
- Never send environment variables to the client (only `NEXT_PUBLIC_*` prefixed variables are exposed to the browser, and those must not contain secrets).

---

## 3. Data Isolation (Multi-Tenancy)

### 3.1 Architecture

BeatMind uses a shared-database, shared-schema multi-tenancy model. Every tenant-scoped table includes a `gym_id` column as a foreign key to the `gyms` table. Data isolation is enforced at the application layer.

### 3.2 The `withGymScope` Utility

All database queries that access tenant-scoped data MUST use the `withGymScope` utility. This utility wraps Drizzle ORM queries to inject the `gym_id` filter.

**Location:** `lib/utils/gym-scope.ts`

**Implementation specification:**

```typescript
import { eq, and, SQL } from "drizzle-orm";

/**
 * Returns a Drizzle WHERE condition scoped to a specific gym.
 * MUST be used on every query touching tenant-scoped tables.
 */
export function withGymScope<T extends { gym_id: any }>(
  table: T,
  gymId: string
): SQL {
  return eq(table.gym_id, gymId);
}

/**
 * Combines gym scope with additional conditions.
 */
export function withGymScopeAnd<T extends { gym_id: any }>(
  table: T,
  gymId: string,
  ...conditions: SQL[]
): SQL {
  return and(eq(table.gym_id, gymId), ...conditions);
}
```

**Usage in every query:**

```typescript
// CORRECT
const athletes = await db
  .select()
  .from(athletesTable)
  .where(withGymScope(athletesTable, authenticatedGymId));

// WRONG - Missing gym scope
const athletes = await db.select().from(athletesTable);

// WRONG - Trusting client-supplied gym_id
const athletes = await db
  .select()
  .from(athletesTable)
  .where(eq(athletesTable.gym_id, req.body.gymId)); // Never trust client input
```

### 3.3 Server-Side gym_id Validation

The `gym_id` used in queries must ALWAYS be derived from the authenticated user's session, never from client-supplied parameters (URL params, request body, headers).

**Derivation chain:**

1. Clerk middleware authenticates the user and provides `userId` and `orgId`.
2. The server looks up the user's `gym_memberships` record matching `clerk_user_id` and `clerk_org_id`.
3. The `gym_id` from that membership record is the only value used in subsequent queries.

**Implementation specification:**

```typescript
// lib/auth/guards.ts

export async function getAuthenticatedGymId(
  userId: string,
  orgId: string
): Promise<string> {
  const membership = await db
    .select()
    .from(gymMemberships)
    .innerJoin(users, eq(users.id, gymMemberships.user_id))
    .innerJoin(gyms, eq(gyms.id, gymMemberships.gym_id))
    .where(
      and(
        eq(users.clerk_user_id, userId),
        eq(gyms.clerk_org_id, orgId),
        eq(gymMemberships.is_active, true)
      )
    )
    .limit(1);

  if (!membership.length) {
    throw new AuthorizationError("User does not belong to this gym");
  }

  return membership[0].gym_memberships.gym_id;
}
```

### 3.4 Isolation Rules

| Rule | Enforcement |
|---|---|
| Gym A cannot see Gym B's athletes | `withGymScope` on every athletes query |
| Gym A cannot see Gym B's sessions | `withGymScope` on every sessions query |
| Gym A cannot see Gym B's HR readings | `withGymScope` on every hr_readings query |
| Gym A cannot see Gym B's AI coaching messages | `withGymScope` on every ai_coaching_messages query |
| TV dashboard for Gym A only receives Gym A's WebSocket data | WebSocket rooms scoped by `gym_id` |
| Agent for Gym A can only write data for Gym A | Agent's `gym_id` is looked up from the `agents` table using the authenticated `agent_id` |

### 3.5 Code Review Checklist for Multi-Tenancy

Every pull request must verify:

- [ ] All new queries include `withGymScope` (or `withGymScopeAnd`).
- [ ] No raw SQL queries bypass the gym scope.
- [ ] No client-supplied `gym_id` is trusted.
- [ ] SuperAdmin queries that bypass gym scope are explicitly marked and justified.
- [ ] WebSocket broadcasts are scoped to the correct gym room.

---

## 4. Authentication Security

### 4.1 Clerk Middleware (Web Users)

Clerk middleware protects all web application routes and API routes that serve the platform UI.

**Protected routes:**

```typescript
// middleware.ts (root of the project)
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/tv/(.*)",           // TV uses token auth, not Clerk
  "/api/agent/(.*)",    // Agent uses custom auth
  "/api/webhooks/(.*)", // Webhooks use signature verification
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)"],
};
```

**Session cookie configuration (managed by Clerk):**

- `HttpOnly`: Yes (prevents JavaScript access).
- `Secure`: Yes (HTTPS only in production).
- `SameSite`: `Strict` (prevents CSRF via cross-site requests).
- `Domain`: Scoped to the application domain.

### 4.2 SuperAdmin Authentication

SuperAdmin access requires two checks:

1. Valid Clerk session (standard middleware).
2. `is_superadmin: true` in user's public metadata on Clerk.

**Implementation:**

```typescript
// lib/auth/guards.ts

export async function requireSuperAdmin(auth: Auth): Promise<void> {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    throw new AuthenticationError("Not authenticated");
  }

  if (!sessionClaims?.metadata?.is_superadmin) {
    throw new AuthorizationError("SuperAdmin access required");
  }
}
```

**Rules:**

- The `is_superadmin` flag is ONLY set via Clerk Dashboard or Clerk Backend API. It is never settable via the application UI.
- SuperAdmin routes (`/superadmin/*`, `/api/v1/superadmin/*`) call `requireSuperAdmin` at the top of every handler.

### 4.3 Agent Authentication (Mini PC)

Agents (mini PCs) authenticate using custom credentials, not Clerk.

**Headers:**

```
X-Agent-Id: <agent-uuid>
X-Agent-Secret: <agent-secret-plaintext>
```

**Server-side validation:**

```typescript
// lib/auth/agent-auth.ts
import bcrypt from "bcryptjs";

export async function authenticateAgent(
  agentId: string,
  agentSecret: string
): Promise<{ agentId: string; gymId: string }> {
  const agent = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.status, "active")))
    .limit(1);

  if (!agent.length) {
    throw new AuthenticationError("Invalid agent credentials");
  }

  const isValid = await bcrypt.compare(agentSecret, agent[0].agent_secret);

  if (!isValid) {
    throw new AuthenticationError("Invalid agent credentials");
  }

  return { agentId: agent[0].id, gymId: agent[0].gym_id };
}
```

**Storage:**

- `agent_secret` is stored as a bcrypt hash (cost factor 12) in the `agents` table.
- The plaintext secret is generated once during agent provisioning, shown to the admin, and never stored on the server.
- The agent stores its plaintext secret in its local `.env` file on the mini PC.

**Provisioning flow:**

1. SuperAdmin creates agent in the platform.
2. System generates a random 64-character hex secret.
3. System stores the bcrypt hash of the secret in the `agents` table.
4. System displays the plaintext secret once to the SuperAdmin.
5. SuperAdmin configures the agent's `.env` file with the secret.
6. The plaintext secret is never shown again. If lost, generate a new one.

### 4.4 TV Dashboard Authentication

TV dashboards use a UUID token for authentication, avoiding the need for Clerk on kiosk displays.

**URL format:** `/tv/[gymId]?token=TOKEN`

**Validation:**

```typescript
// app/tv/[gymId]/page.tsx (server component)

export default async function TVPage({
  params,
  searchParams,
}: {
  params: { gymId: string };
  searchParams: { token?: string };
}) {
  const gym = await db
    .select()
    .from(gyms)
    .where(
      and(
        eq(gyms.id, params.gymId),
        eq(gyms.tv_access_token, searchParams.token),
        eq(gyms.subscription_status, "active")
      )
    )
    .limit(1);

  if (!gym.length) {
    return <AccessDenied />;
  }

  // Render TV dashboard
}
```

**Token management:**

- Token is a UUIDv4, stored in the `gyms.tv_access_token` column.
- Gym Owner can view and regenerate the token from gym settings.
- Regenerating the token immediately invalidates the old one (all active TV displays disconnect).
- Token is transmitted via URL query parameter over HTTPS.

---

## 5. Authorization

### 5.1 Role-Based Access Control

| Role | Scope | Permissions |
|---|---|---|
| **SuperAdmin** | All gyms | Full CRUD on all resources. Can create/suspend gyms, manage agents, view global analytics. |
| **Gym Owner** | Own gym only | Full CRUD on own gym's athletes, trainers, sessions, settings, branding. Can view/regenerate TV token. |
| **Trainer** | Own gym only | Read/create sessions, read/create athletes, read reports. Cannot manage trainers, settings, or branding. |
| **Athlete** | Own data only | Read own profile, own sessions, own progress. Update own profile (name, weight, max HR, WhatsApp opt-in). |
| **Agent** | Own gym only | Write HR data, write health status. Cannot read any data. |
| **TV Token** | Own gym only | Read real-time HR data via WebSocket. No write access. |

### 5.2 Route-Level Authorization

```typescript
// lib/auth/guards.ts

type Role = "superadmin" | "org:admin" | "org:trainer" | "org:athlete";

export async function requireRole(
  auth: Auth,
  allowedRoles: Role[]
): Promise<{ userId: string; gymId: string; role: Role }> {
  const { userId, orgId, orgRole, sessionClaims } = await auth();

  if (!userId) {
    throw new AuthenticationError("Not authenticated");
  }

  // SuperAdmin check
  if (
    allowedRoles.includes("superadmin") &&
    sessionClaims?.metadata?.is_superadmin
  ) {
    return { userId, gymId: "all", role: "superadmin" };
  }

  // Org role check
  if (!orgId || !orgRole) {
    throw new AuthorizationError("No organization context");
  }

  if (!allowedRoles.includes(orgRole as Role)) {
    throw new AuthorizationError("Insufficient permissions");
  }

  const gymId = await getAuthenticatedGymId(userId, orgId);

  return { userId, gymId, role: orgRole as Role };
}
```

### 5.3 Endpoint Authorization Matrix

| Endpoint Pattern | Allowed Roles | Additional Checks |
|---|---|---|
| `/api/v1/superadmin/*` | SuperAdmin | `is_superadmin` metadata |
| `/api/v1/gym/profile` | Gym Owner | gym_id from auth |
| `/api/v1/gym/athletes` | Gym Owner, Trainer | gym_id from auth |
| `/api/v1/gym/trainers` | Gym Owner | gym_id from auth |
| `/api/v1/gym/sessions` | Gym Owner, Trainer | gym_id from auth |
| `/api/v1/athlete/profile` | Athlete | athlete_id from auth, own data only |
| `/api/v1/athlete/sessions` | Athlete | athlete_id from auth, own data only |
| `/api/v1/reports/session/[id]` | Gym Owner, Trainer, Athlete | Athlete sees only own; Owner/Trainer sees gym-scoped |
| `/api/agent/heartbeat` | Agent | X-Agent-Id + X-Agent-Secret |
| `/api/agent/status` | Agent | X-Agent-Id + X-Agent-Secret |

### 5.4 Athlete Data Isolation

Athletes can only access their own data. This requires an additional filter beyond `gym_id`:

```typescript
export async function requireAthleteOwnership(
  userId: string,
  athleteId: string
): Promise<void> {
  const athlete = await db
    .select()
    .from(athletes)
    .where(
      and(
        eq(athletes.id, athleteId),
        eq(athletes.user_id, userId)
      )
    )
    .limit(1);

  if (!athlete.length) {
    throw new AuthorizationError("You can only access your own data");
  }
}
```

---

## 6. API Security

### 6.1 Rate Limiting

Implement rate limiting using an in-memory store (e.g., `Map` with TTL) or Redis if available.

| Endpoint Group | Rate Limit | Window | Key |
|---|---|---|---|
| `/api/agent/heartbeat` | 20 requests/second | 1s sliding | `agent_id` |
| `/api/agent/status` | 2 requests/minute | 1min | `agent_id` |
| `/api/v1/*` (authenticated) | 100 requests/minute | 1min | `user_id` |
| `/api/v1/*` (unauthenticated) | 10 requests/minute | 1min | IP address |
| `/api/v1/reports/*/send-whatsapp` | 5 requests/hour | 1h | `user_id` |

**Implementation specification:**

```typescript
// lib/api/rate-limit.ts

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: now + config.windowMs };
  }

  entry.count++;

  if (entry.count > config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt };
}
```

Return `429 Too Many Requests` with `Retry-After` header when limit is exceeded.

### 6.2 Input Validation

All API endpoints MUST validate input using Zod schemas. No endpoint should trust raw request data.

**Pattern:**

```typescript
// app/api/v1/gym/athletes/route.ts
import { z } from "zod";

const createAthleteSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(254).optional(),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/).optional(),
  age: z.number().int().min(10).max(120).optional(),
  weight_kg: z.number().min(20).max(300).optional(),
  max_hr: z.number().int().min(100).max(230).default(190),
  whatsapp_opt_in: z.boolean().default(false),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = createAthleteSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Use parsed.data (typed and sanitized)
}
```

**Agent heartbeat validation (high-frequency, strict):**

```typescript
const heartbeatSchema = z.object({
  readings: z.array(
    z.object({
      sensor_id: z.number().int().min(0).max(65535),
      heart_rate_bpm: z.number().int().min(30).max(250),
      beat_time: z.number(),
      beat_count: z.number().int().min(0),
      device_active: z.boolean(),
      recorded_at: z.string().datetime(),
    })
  ).max(100), // Max 100 readings per batch
  session_id: z.string().uuid().optional(),
});
```

### 6.3 CORS Configuration

```typescript
// next.config.ts

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: process.env.NEXT_PUBLIC_APP_URL || "https://app.beatmind.ai",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization, X-Agent-Id, X-Agent-Secret",
          },
          {
            key: "Access-Control-Max-Age",
            value: "86400",
          },
        ],
      },
    ];
  },
};
```

**Rules:**

- `Access-Control-Allow-Origin` MUST be set to the specific application domain. Never use `*` in production.
- Agent API endpoints additionally allow `X-Agent-Id` and `X-Agent-Secret` headers.
- The WebSocket server handles CORS separately via the `ws` library's `verifyClient` callback.

### 6.4 Security Headers

Configure in `next.config.ts`:

```typescript
// next.config.ts

const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://clerk.beatmind.ai https://*.clerk.accounts.dev",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.clerk.com https://img.clerk.com",
      "font-src 'self'",
      "connect-src 'self' https://*.clerk.com https://*.clerk.accounts.dev wss://app.beatmind.ai https://api.openai.com https://us.i.posthog.com",
      "frame-src 'self' https://*.clerk.com https://*.clerk.accounts.dev",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  // Disable X-Powered-By header
  poweredByHeader: false,
};
```

**Notes on CSP:**

- `unsafe-inline` and `unsafe-eval` are required for Clerk and Next.js development mode. In production, consider using nonces if feasible.
- The `connect-src` must include the WebSocket endpoint (wss://), Clerk domains, OpenAI API, and PostHog.
- Review and tighten CSP directives after integration testing.

---

## 7. WebSocket Security

### 7.1 Transport Security

- **Production:** All WebSocket connections MUST use `wss://` (TLS-encrypted).
- The WebSocket server runs as a separate PM2 process and listens on a dedicated port (e.g., 8080).
- TLS termination is handled by the reverse proxy (Nginx/Caddy) in front of the WebSocket server.

### 7.2 Agent WebSocket Authentication

The agent authenticates on the first message after connection. If authentication fails, the server closes the connection immediately.

```typescript
// ws-server.ts (agent connection handler)

wss.on("connection", (ws, req) => {
  let authenticated = false;
  let agentGymId: string | null = null;

  // Authentication timeout: close if not authenticated within 5 seconds
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      ws.close(4001, "Authentication timeout");
    }
  }, 5000);

  ws.on("message", async (data) => {
    if (!authenticated) {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type !== "auth") {
          ws.close(4002, "First message must be auth");
          return;
        }

        const { agentId, gymId } = await authenticateAgent(
          msg.agent_id,
          msg.agent_secret
        );

        authenticated = true;
        agentGymId = gymId;
        clearTimeout(authTimeout);

        // Join gym-specific room
        joinRoom(ws, `gym:${gymId}`);

        ws.send(JSON.stringify({ type: "auth-ok" }));
      } catch (e) {
        ws.close(4003, "Authentication failed");
      }
      return;
    }

    // Process authenticated messages...
  });
});
```

### 7.3 TV WebSocket Authentication

TV displays authenticate during the connection handshake via URL parameters.

```typescript
// ws-server.ts (TV connection verifyClient)

const tvWss = new WebSocket.Server({
  noServer: true,
  verifyClient: async (info, callback) => {
    const url = new URL(info.req.url!, `wss://${info.req.headers.host}`);
    const gymId = url.pathname.split("/").pop();
    const token = url.searchParams.get("token");

    if (!gymId || !token) {
      callback(false, 401, "Missing credentials");
      return;
    }

    const gym = await db
      .select()
      .from(gyms)
      .where(
        and(
          eq(gyms.id, gymId),
          eq(gyms.tv_access_token, token),
          eq(gyms.subscription_status, "active")
        )
      )
      .limit(1);

    if (!gym.length) {
      callback(false, 403, "Invalid token");
      return;
    }

    // Attach gym info to the request for later use
    (info.req as any).gymId = gymId;
    callback(true);
  },
});
```

### 7.4 Connection Health (Ping/Pong)

```typescript
const PING_INTERVAL = 30_000; // 30 seconds
const PONG_TIMEOUT = 60_000;  // 60 seconds

function setupHeartbeat(ws: WebSocket) {
  let isAlive = true;

  ws.on("pong", () => {
    isAlive = true;
  });

  const interval = setInterval(() => {
    if (!isAlive) {
      clearInterval(interval);
      ws.terminate(); // Force close dead connection
      return;
    }

    isAlive = false;
    ws.ping();
  }, PING_INTERVAL);

  ws.on("close", () => {
    clearInterval(interval);
  });
}
```

### 7.5 Message Size and Rate Limits

```typescript
const WS_CONFIG = {
  maxPayload: 64 * 1024,          // 64 KB max message size
  agentMessageRateLimit: 5,        // Max 5 messages per second per agent
  agentMessageRateWindow: 1000,    // 1 second window
  tvBroadcastRateLimit: 2,         // Max 2 broadcasts per second per gym
};

// In WebSocket server setup
const wss = new WebSocket.Server({
  maxPayload: WS_CONFIG.maxPayload,
});
```

**Per-connection rate limiting:**

```typescript
function checkWsRateLimit(ws: WebSocket & { _msgCount?: number; _msgResetAt?: number }): boolean {
  const now = Date.now();

  if (!ws._msgResetAt || now > ws._msgResetAt) {
    ws._msgCount = 1;
    ws._msgResetAt = now + WS_CONFIG.agentMessageRateWindow;
    return true;
  }

  ws._msgCount = (ws._msgCount || 0) + 1;

  if (ws._msgCount > WS_CONFIG.agentMessageRateLimit) {
    return false;
  }

  return true;
}
```

---

## 8. Database Security

### 8.1 Database User Roles

Do NOT use the `postgres` superuser for the application. Create a limited-privilege role.

```sql
-- Create application user with minimum required privileges
CREATE ROLE beatmind_app WITH LOGIN PASSWORD 'STRONG_RANDOM_PASSWORD';

-- Grant usage on the application schema
GRANT USAGE ON SCHEMA public TO beatmind_app;

-- Grant table-level privileges (no DROP, no TRUNCATE, no REFERENCES)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO beatmind_app;

-- Grant sequence usage (for SERIAL/BIGSERIAL columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO beatmind_app;

-- Ensure future tables also get these permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO beatmind_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO beatmind_app;

-- Create a separate migrations user (used only during deployments)
CREATE ROLE beatmind_migrations WITH LOGIN PASSWORD 'DIFFERENT_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON SCHEMA public TO beatmind_migrations;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO beatmind_migrations;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO beatmind_migrations;
```

**Connection string for the application:**

```
DATABASE_URL=postgresql://beatmind_app:PASSWORD@localhost:5432/beatmind?sslmode=require
```

**Connection string for migrations (used only in CI/CD or manual deploys):**

```
MIGRATION_DATABASE_URL=postgresql://beatmind_migrations:PASSWORD@localhost:5432/beatmind?sslmode=require
```

### 8.2 SSL/TLS Connections

- **Production:** All database connections MUST use SSL. Add `?sslmode=require` to the connection string.
- **Development:** SSL is optional (`?sslmode=prefer`).

PostgreSQL server configuration (`postgresql.conf`):

```
ssl = on
ssl_cert_file = '/etc/ssl/certs/server.crt'
ssl_key_file = '/etc/ssl/private/server.key'
```

### 8.3 Query Safety

Drizzle ORM uses parameterized queries by default, which prevents SQL injection. However, the following rules must be enforced:

| Rule | Enforcement |
|---|---|
| No raw SQL without parameterization | Code review. If `sql.raw()` or `sql\`...\`` is used, all user input MUST be passed via `sql.placeholder()` or Drizzle's parameter binding. |
| No string concatenation in queries | Lint rule or code review. |
| No `db.execute()` with template literals containing user input | Code review. |

**Acceptable raw SQL:**

```typescript
// Parameterized - SAFE
const result = await db.execute(
  sql`SELECT * FROM athletes WHERE gym_id = ${gymId} AND name ILIKE ${`%${searchTerm}%`}`
);
```

**Unacceptable raw SQL:**

```typescript
// String concatenation - VULNERABLE
const result = await db.execute(
  sql.raw(`SELECT * FROM athletes WHERE name = '${searchTerm}'`)
);
```

### 8.4 Backup Strategy

| Component | Frequency | Retention | Method |
|---|---|---|---|
| Full database dump | Daily at 03:00 UTC | 30 days | `pg_dump` via cron |
| WAL archiving | Continuous | 7 days | PostgreSQL WAL archival |
| hr_readings archive | Monthly | Indefinite (compressed) | Export partitions > 6 months to compressed CSV, store offsite |

**Backup script (cron):**

```bash
#!/bin/bash
# /opt/beatmind/scripts/backup.sh
BACKUP_DIR="/opt/beatmind/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PGPASSWORD="$BACKUP_DB_PASSWORD" pg_dump \
  -h localhost \
  -U beatmind_backup \
  -d beatmind \
  -F c \
  -f "$BACKUP_DIR/beatmind_$TIMESTAMP.dump"

# Remove backups older than 30 days
find "$BACKUP_DIR" -name "*.dump" -mtime +30 -delete
```

**Backup user (read-only):**

```sql
CREATE ROLE beatmind_backup WITH LOGIN PASSWORD 'BACKUP_PASSWORD';
GRANT CONNECT ON DATABASE beatmind TO beatmind_backup;
GRANT USAGE ON SCHEMA public TO beatmind_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO beatmind_backup;
```

---

## 9. Health Data Privacy

### 9.1 Classification

Heart rate (HR) readings are biometric health data. While BeatMind AI operates in a fitness context (not clinical), HR data reveals information about cardiovascular health and must be protected accordingly.

**Data classification:**

| Data Type | Classification | Examples |
|---|---|---|
| HR readings | Sensitive Health | BPM, HR zones, max HR percentage |
| Athlete profile | PII | Name, email, phone, age, weight |
| Session data | Business Confidential | Duration, class type, gym association |
| Gym configuration | Business | Name, branding, settings |
| AI coaching messages | Internal | Generated coaching text |

### 9.2 Data Retention Policy

| Data Type | Active Retention | Archive | Deletion |
|---|---|---|---|
| `hr_readings` | 6 months in live tables | Move to partitioned archive tables after 6 months | Permanently delete after 24 months |
| `session_athletes` (stats) | Indefinite | N/A | On athlete deletion request |
| `sessions` | Indefinite | N/A | On gym deletion |
| `ai_coaching_messages` | 6 months | Archive after 6 months | Delete after 12 months |
| `athletes` (profiles) | While active | Soft-delete (is_active=false) | Hard delete on explicit request |

**Archival implementation:**

```sql
-- Monthly cron job to move old hr_readings to archive
INSERT INTO hr_readings_archive
SELECT * FROM hr_readings
WHERE recorded_at < NOW() - INTERVAL '6 months';

DELETE FROM hr_readings
WHERE recorded_at < NOW() - INTERVAL '6 months';
```

Use table partitioning by month on `hr_readings` (as specified in the PRD) to make this operation efficient:

```sql
CREATE TABLE hr_readings (
  id BIGSERIAL,
  recorded_at TIMESTAMPTZ NOT NULL,
  -- ... other columns
) PARTITION BY RANGE (recorded_at);

-- Create monthly partitions
CREATE TABLE hr_readings_2026_01 PARTITION OF hr_readings
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- ... etc.
```

### 9.3 Athlete Consent (WhatsApp Opt-In)

- Athletes must explicitly opt in to receive WhatsApp messages. This is stored in `athletes.whatsapp_opt_in` (boolean, default `false`).
- Opt-in is collected through the athlete portal profile page.
- Opt-in status is displayed to gym owners/trainers but can only be changed by the athlete.
- A record of when opt-in was granted should be logged (timestamp in an audit column: `whatsapp_opt_in_at`).

### 9.4 Data Deletion (Right to Erasure)

Athletes (or gym owners on their behalf) can request deletion of an athlete's data.

**Deletion scope:**

```typescript
// lib/data/athlete-deletion.ts

export async function deleteAthleteData(
  athleteId: string,
  gymId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Delete HR readings
    await tx
      .delete(hrReadings)
      .where(
        and(eq(hrReadings.athlete_id, athleteId), eq(hrReadings.gym_id, gymId))
      );

    // 2. Delete session athlete stats
    await tx
      .delete(sessionAthletes)
      .where(eq(sessionAthletes.athlete_id, athleteId));

    // 3. Delete band mappings
    await tx
      .delete(athleteBands)
      .where(
        and(eq(athleteBands.athlete_id, athleteId), eq(athleteBands.gym_id, gymId))
      );

    // 4. Anonymize AI coaching messages (remove athlete from summaries)
    // AI messages reference multiple athletes; anonymize rather than delete
    // This requires updating the JSONB athlete_summaries field

    // 5. Delete athlete profile
    await tx
      .delete(athletes)
      .where(and(eq(athletes.id, athleteId), eq(athletes.gym_id, gymId)));

    // 6. Log the deletion for audit
    await tx.insert(auditLog).values({
      action: "athlete_data_deleted",
      entity_type: "athlete",
      entity_id: athleteId,
      gym_id: gymId,
      details: { deleted_at: new Date().toISOString() },
    });
  });
}
```

**Rules:**

- Deletion is irreversible. Confirm with the user before executing.
- Deletion must cascade through all related tables.
- An audit log entry is created to prove the deletion occurred (without containing the deleted PII).
- If the athlete has a Clerk user account, it should be deactivated but the Clerk user record itself is managed separately.

---

## 10. Production Hardening

### 10.1 HTTPS Everywhere

- All HTTP traffic MUST redirect to HTTPS.
- Managed by the reverse proxy (Nginx or Caddy).

**Nginx configuration:**

```nginx
server {
    listen 80;
    server_name app.beatmind.ai;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.beatmind.ai;

    ssl_certificate /etc/letsencrypt/live/app.beatmind.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.beatmind.ai/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Next.js app
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket server
    location /ws/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400; # 24h for long-lived WS connections
    }
}
```

### 10.2 Firewall (UFW)

```bash
# Reset and deny all incoming by default
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (restrict to your IP if possible)
sudo ufw allow 22/tcp

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow WebSocket port (only if not proxied through Nginx on 443)
# If proxied through Nginx, this is NOT needed
# sudo ufw allow 8080/tcp

# Enable firewall
sudo ufw enable
```

**Rules:**

- The WebSocket server port (8080) should NOT be directly exposed if Nginx proxies WebSocket connections through port 443.
- PostgreSQL port (5432) should NOT be exposed externally. Database connections are localhost only.
- If remote database access is needed, use SSH tunneling.

### 10.3 PM2 Configuration

Run the application as a non-root user.

```bash
# Create application user
sudo useradd -m -s /bin/bash beatmind
sudo mkdir -p /opt/beatmind
sudo chown beatmind:beatmind /opt/beatmind
```

**PM2 ecosystem file (`ecosystem.config.cjs`):**

```javascript
module.exports = {
  apps: [
    {
      name: "beatmind-web",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/opt/beatmind/beat-mind-ai",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/opt/beatmind/logs/web-error.log",
      out_file: "/opt/beatmind/logs/web-out.log",
      merge_logs: true,
    },
    {
      name: "beatmind-ws",
      script: "ws-server.ts",
      interpreter: "bun",
      cwd: "/opt/beatmind/beat-mind-ai",
      env: {
        NODE_ENV: "production",
        WS_PORT: 8080,
      },
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "256M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/opt/beatmind/logs/ws-error.log",
      out_file: "/opt/beatmind/logs/ws-out.log",
      merge_logs: true,
    },
  ],
};
```

### 10.4 Dependency Security

```bash
# Check for known vulnerabilities (run weekly in CI and locally)
bun audit

# Or use npm audit (bun audit may not cover all cases)
npx npm-audit-resolver

# Automated dependency updates: configure Dependabot or Renovate
```

**`.github/dependabot.yml`:**

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    labels:
      - "dependencies"
      - "security"
```

### 10.5 Error Handling (No Stack Trace Leakage)

**API error responses MUST NOT include stack traces, file paths, or internal details.**

```typescript
// lib/api/error-handler.ts

export function handleApiError(error: unknown): Response {
  // Log the full error server-side
  console.error("[API Error]", error);

  if (error instanceof AuthenticationError) {
    return Response.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  if (error instanceof AuthorizationError) {
    return Response.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  if (error instanceof ValidationError) {
    return Response.json(
      { error: "Validation failed", details: error.details },
      { status: 400 }
    );
  }

  // Generic error - never expose internals
  return Response.json(
    { error: "Internal server error" },
    { status: 500 }
  );
}
```

**Next.js custom error pages:**

- `app/not-found.tsx` -- Custom 404 page without stack traces.
- `app/error.tsx` -- Custom error boundary that shows a user-friendly message.
- `app/global-error.tsx` -- Root error boundary for catastrophic failures.

In production (`NODE_ENV=production`), Next.js automatically strips stack traces from error responses. Verify this is the case and never override it.

### 10.6 Structured Logging Without PII

**Rules:**

- Never log email addresses, phone numbers, names, or HR readings.
- Log `user_id`, `gym_id`, `agent_id`, and `session_id` (UUIDs are not PII).
- Log action, status code, latency, and error types.
- Use structured JSON logging for machine-parseable logs.

**Implementation:**

```typescript
// lib/logger.ts

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string;
  userId?: string;
  gymId?: string;
  agentId?: string;
  action?: string;
  statusCode?: number;
  durationMs?: number;
  error?: string; // Error message only, never stack trace in production
}

export function log(entry: LogEntry): void {
  const output = {
    ...entry,
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  };

  // Remove undefined fields
  const cleaned = Object.fromEntries(
    Object.entries(output).filter(([, v]) => v !== undefined)
  );

  if (entry.level === "error") {
    console.error(JSON.stringify(cleaned));
  } else {
    console.log(JSON.stringify(cleaned));
  }
}

// Usage:
// log({
//   level: "info",
//   message: "Agent heartbeat received",
//   agentId: "uuid",
//   gymId: "uuid",
//   action: "agent.heartbeat",
//   durationMs: 12,
// });
```

**What to log:**

| Event | Fields |
|---|---|
| API request | action, userId/agentId, gymId, statusCode, durationMs |
| Authentication failure | action, IP address (hashed), reason |
| Authorization failure | action, userId, attempted resource, gymId |
| WebSocket connection | action, agentId/tvToken (masked), gymId |
| WebSocket disconnection | action, agentId, gymId, reason, duration |
| Agent heartbeat | action, agentId, gymId, readingCount |
| Database error | action, error message (no query params), table |
| Rate limit exceeded | action, key (userId/IP hashed), endpoint |

**What to NEVER log:**

- Email addresses, phone numbers, names
- HR readings or health data values
- Passwords, tokens, API keys
- Request/response bodies containing PII
- Full SQL queries with parameter values

---

## Appendix A: Security Checklist for Each Phase

### Phase 1 (Foundation)
- [ ] Rotate all exposed credentials (Clerk, PostgreSQL, OpenAI)
- [ ] Clean `.env` files from git history
- [ ] Verify `.gitignore` covers all env files
- [ ] Set up Clerk middleware with proper route matchers
- [ ] Implement `requireSuperAdmin` guard
- [ ] Implement agent authentication (bcrypt-hashed secrets)
- [ ] Implement `withGymScope` utility
- [ ] Create limited PostgreSQL role for the application
- [ ] Configure security headers in `next.config.ts`
- [ ] Set up structured logging

### Phase 2 (Gym Management + Agent)
- [ ] Implement `requireRole` guard for gym routes
- [ ] Validate gym_id derivation from Clerk org context
- [ ] Implement agent heartbeat input validation (Zod)
- [ ] Implement rate limiting on agent endpoints
- [ ] TV token generation and validation
- [ ] Agent secret provisioning flow

### Phase 3 (TV Dashboard + AI)
- [ ] WebSocket agent authentication (first-message auth)
- [ ] WebSocket TV authentication (verifyClient)
- [ ] WebSocket ping/pong and connection timeouts
- [ ] WebSocket message size and rate limits
- [ ] CORS configuration for WebSocket origins
- [ ] AI coaching: no PII in OpenAI prompts (use anonymized data)

### Phase 4 (Reports + Athlete Portal)
- [ ] Athlete data isolation (own data only)
- [ ] WhatsApp opt-in enforcement
- [ ] Data deletion capability
- [ ] Report access authorization (role-dependent visibility)

### Phase 5 (Polish + Launch)
- [ ] Full security audit (invoke security-auditor agent)
- [ ] Penetration testing on multi-tenancy isolation
- [ ] Production firewall configuration
- [ ] PM2 non-root user setup
- [ ] SSL on all database connections
- [ ] Dependency vulnerability scan
- [ ] Error page review (no stack trace leakage)
- [ ] CSP header tightening
- [ ] Backup strategy verification
