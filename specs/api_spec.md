# BeatMind AI - REST API Specification

**Version:** 1.0 | **Date:** 2026-02-26 | **Status:** Draft

---

## 1. Overview

BeatMind AI exposes a REST API served entirely through **Next.js 16 App Router route handlers** (`app/api/` directory). Every endpoint returns JSON. The API serves three distinct consumer classes:

| Consumer | Auth Mechanism | Base Path |
|----------|---------------|-----------|
| **Local Agent** (Mini PC) | `X-Agent-Id` + `X-Agent-Secret` headers | `/api/agent/*` |
| **Web App** (SuperAdmin, Gym, Athlete) | Clerk JWT (cookie or Bearer token) | `/api/v1/*` |
| **TV Dashboard** | Token UUID query param (WebSocket only, not REST) | N/A |

All route handlers are located under `app/api/` and follow Next.js 16 conventions:

```
app/api/
  agent/
    heartbeat/route.ts
    status/route.ts
  v1/
    superadmin/
      gyms/route.ts
      gyms/[id]/route.ts
      agents/route.ts
    gym/
      profile/route.ts
      athletes/route.ts
      athletes/[id]/route.ts
      athletes/[id]/bands/route.ts
      trainers/route.ts
      sessions/route.ts
      sessions/active/route.ts
      sessions/[id]/end/route.ts
    athlete/
      profile/route.ts
      sessions/route.ts
      sessions/[id]/route.ts
      progress/route.ts
    reports/
      session/[id]/route.ts
      session/[id]/send-whatsapp/route.ts
```

**Content Type:** All requests and responses use `application/json`.

**HTTP Methods:** Each `route.ts` file exports named functions (`GET`, `POST`, `PATCH`, `DELETE`) corresponding to the HTTP methods it handles.

---

## 2. Authentication Patterns

### 2.1 Clerk-Authenticated Routes (Web App)

All `/api/v1/*` routes are protected by Clerk middleware. Authentication flow:

1. Clerk middleware (`middleware.ts`) intercepts the request.
2. JWT is validated from the session cookie (web) or `Authorization: Bearer <token>` header (programmatic).
3. `auth()` from `@clerk/nextjs/server` provides `userId`, `orgId`, `orgRole`, and `sessionClaims`.
4. Route handlers call guard functions from `lib/auth/guards.ts` to enforce role requirements.

**Guard functions:**

```typescript
// lib/auth/guards.ts
import { auth } from "@clerk/nextjs/server";

export async function requireSuperAdmin(): Promise<{ userId: string }>;
export async function requireGymAccess(roles?: string[]): Promise<{ userId: string; orgId: string; role: string }>;
export async function requireAthleteAccess(): Promise<{ userId: string; orgId: string; athleteId: string }>;
```

- `requireSuperAdmin()` checks `sessionClaims.metadata.is_superadmin === true`. Returns 403 if not superadmin.
- `requireGymAccess(roles?)` checks active organization membership. Optionally filters by role (`org:admin`, `org:trainer`). Returns 403 if not a member or wrong role.
- `requireAthleteAccess()` checks `org:athlete` role and resolves the `athleteId` from the user record. Returns 403 if not an athlete.

### 2.2 Agent Routes

All `/api/agent/*` routes use custom header-based authentication:

```typescript
// lib/auth/agent-auth.ts
export async function authenticateAgent(request: Request): Promise<{ agentId: string; gymId: string }>;
```

Required headers:

| Header | Type | Description |
|--------|------|-------------|
| `X-Agent-Id` | `string (UUID)` | Agent identifier from `agents` table |
| `X-Agent-Secret` | `string` | Shared secret stored in `agents.agent_secret` |

Validation:
1. Extract both headers. Return 401 if either is missing.
2. Query `agents` table for matching `id` + `agent_secret`.
3. Return 401 if no match. Return 403 if agent status is `disabled`.
4. Return `{ agentId, gymId }` on success.

### 2.3 Standard Error Response Shape

Every error response across all endpoints uses this shape:

```typescript
interface ApiError {
  error: string;   // Human-readable error message
  code: string;    // Machine-readable error code (e.g., "UNAUTHORIZED", "VALIDATION_ERROR")
}
```

Example:

```json
{
  "error": "You do not have permission to access this resource",
  "code": "FORBIDDEN"
}
```

### 2.4 Response Helper

```typescript
// lib/api/response.ts
export function ok<T>(data: T, status?: number): NextResponse<T>;
export function error(message: string, code: string, status: number): NextResponse<ApiError>;
```

---

## 3. Agent API (Mini PC to VPS)

These endpoints receive high-frequency data from the Local Agent running on each gym's Mini PC. They are outside the `/api/v1/` namespace because they use agent auth, not Clerk auth.

### 3.1 `POST /api/agent/heartbeat`

Receives a batch of HR sensor readings from the agent. Called every **5 seconds**.

**File:** `app/api/agent/heartbeat/route.ts`

**Auth:** Agent headers (`X-Agent-Id`, `X-Agent-Secret`)

**Request Body:**

```typescript
// Zod schema: AgentHeartbeatSchema
{
  agentId: string;          // UUID - must match X-Agent-Id header
  gymId: string;            // UUID - must match agent's gym
  devices: {
    [sensorId: string]: {   // ANT+ sensor ID (numeric string, e.g. "12345")
      bpm: number;          // Current heart rate in BPM (30-250)
      beatTime: number;     // ANT+ beat time counter
      beatCount: number;    // ANT+ beat count
      deviceActive: boolean; // Whether sensor is actively transmitting
    }
  };
  timestamp: string;        // ISO 8601 timestamp from agent clock
}
```

**Validation Rules:**
- `agentId` must be a valid UUID and must match the authenticated agent.
- `gymId` must be a valid UUID and must match the agent's assigned gym.
- `devices` must be a non-empty object. Maximum 30 keys.
- Each `bpm` must be an integer between 30 and 250.
- `beatTime` must be a non-negative number.
- `beatCount` must be a non-negative integer.
- `timestamp` must be a valid ISO 8601 string, not more than 30 seconds in the past (to detect stale buffered data).

**Processing Logic:**
1. Authenticate agent.
2. Validate request body against `AgentHeartbeatSchema`.
3. Resolve `sensor_id` to `athlete_id` via `athlete_bands` table (where `gym_id` matches and `is_active = true`).
4. Find or create an active session for this gym:
   - If no active session exists and there are active devices, auto-create one (`status = 'active'`, `class_type = 'general'`).
   - If an active session exists, use its `id`.
5. Insert rows into `hr_readings` table (bulk insert).
6. Compute HR zone for each reading using `lib/hr/zones.ts` and the athlete's `max_hr`.
7. Update in-memory gym state for WebSocket broadcasting (via `lib/ws/gym-state.ts`).
8. Return session ID for agent reference.

**Success Response (200):**

```json
{
  "ok": true,
  "sessionId": "uuid-of-active-session"
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | Invalid request body |
| 401 | `UNAUTHORIZED` | Missing or invalid agent credentials |
| 403 | `AGENT_DISABLED` | Agent has been disabled by superadmin |
| 422 | `GYM_MISMATCH` | `gymId` does not match agent's assigned gym |

**Rate Limit:** 20 requests/second per agent (burst to 30).

---

### 3.2 `POST /api/agent/status`

Receives health/status updates from the agent. Called every **30 seconds**.

**File:** `app/api/agent/status/route.ts`

**Auth:** Agent headers (`X-Agent-Id`, `X-Agent-Secret`)

**Request Body:**

```typescript
// Zod schema: AgentStatusSchema
{
  agentId: string;              // UUID
  gymId: string;                // UUID
  status: "online" | "degraded" | "error"; // Agent self-reported status
  softwareVersion: string;      // Semver, e.g. "1.2.3"
  uptime: number;               // Seconds since agent process started
  connectedSensors: number;     // Number of ANT+ sensors currently detected
  ipAddress: string;            // Agent's local network IP (for debugging)
}
```

**Validation Rules:**
- `agentId` must match the authenticated agent.
- `gymId` must match the agent's assigned gym.
- `status` must be one of the enum values.
- `softwareVersion` must match semver pattern `/^\d+\.\d+\.\d+$/`.
- `uptime` must be a non-negative integer.
- `connectedSensors` must be a non-negative integer (0-30).
- `ipAddress` must be a valid IPv4 or IPv6 string.

**Processing Logic:**
1. Authenticate agent.
2. Validate request body.
3. Update `agents` table: set `status`, `last_heartbeat = NOW()`, `ip_address`, `software_version`.
4. If `connectedSensors` drops to 0 and there is an active session with no heartbeat data for 2 minutes, auto-end the session.

**Success Response (200):**

```json
{
  "ok": true
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | Invalid request body |
| 401 | `UNAUTHORIZED` | Missing or invalid agent credentials |
| 403 | `AGENT_DISABLED` | Agent has been disabled |

**Rate Limit:** 5 requests/second per agent.

---

## 4. SuperAdmin API

All SuperAdmin endpoints require Clerk authentication and `is_superadmin` flag on the user's metadata.

**Auth guard:** Every handler calls `requireSuperAdmin()` first.

### 4.1 `GET /api/v1/superadmin/gyms`

List all gyms with aggregated stats.

**File:** `app/api/v1/superadmin/gyms/route.ts` (GET export)

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | `number` | `1` | Page number (1-indexed) |
| `limit` | `number` | `20` | Items per page (1-100) |
| `status` | `string` | - | Filter by `subscription_status`: `active`, `suspended`, `cancelled`, `trial` |
| `search` | `string` | - | Case-insensitive search on `name` or `slug` (ILIKE `%search%`) |

**Success Response (200):**

```typescript
{
  gyms: Array<{
    id: string;                    // UUID
    name: string;
    slug: string;
    address: string | null;
    clerkOrgId: string;
    subscriptionStatus: "active" | "suspended" | "cancelled" | "trial";
    subscriptionPlan: "starter" | "pro" | "enterprise";
    maxAthletes: number;
    createdAt: string;             // ISO 8601
    // Aggregated stats (computed via subqueries or joins)
    stats: {
      totalAthletes: number;       // Count of active athletes
      totalSessions: number;       // Count of all sessions
      activeSessions: number;      // Count of sessions with status='active'
      agentStatus: "online" | "offline" | "none"; // Best agent status, or "none" if no agent
      lastActiveAt: string | null; // Most recent session start time
    };
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

### 4.2 `POST /api/v1/superadmin/gyms`

Create a new gym tenant. This also creates a Clerk Organization and optionally invites the owner.

**File:** `app/api/v1/superadmin/gyms/route.ts` (POST export)

**Request Body:**

```typescript
// Zod schema: CreateGymSchema
{
  name: string;                   // 2-100 characters
  slug: string;                   // 2-50 chars, lowercase alphanumeric + hyphens, unique
  address: string | null;         // Optional, max 500 chars
  ownerEmail: string;             // Valid email - will receive Clerk invitation
  plan: "starter" | "pro" | "enterprise";
  maxAthletes: number;            // 5-100
}
```

**Processing Logic:**
1. Validate request body.
2. Check slug uniqueness against `gyms` table.
3. Create Clerk Organization with `name` and `slug`.
4. Insert row into `gyms` table with `clerk_org_id`, `subscription_status = 'active'`, generate `tv_access_token` (UUIDv4).
5. Send Clerk invitation to `ownerEmail` with role `org:admin`.
6. Return created gym.

**Success Response (201):**

```json
{
  "gym": {
    "id": "uuid",
    "name": "CrossFit Downtown",
    "slug": "crossfit-downtown",
    "clerkOrgId": "org_xxx",
    "subscriptionStatus": "active",
    "subscriptionPlan": "pro",
    "maxAthletes": 30,
    "tvAccessToken": "uuid-token",
    "createdAt": "2026-02-26T10:00:00Z"
  },
  "clerkOrgId": "org_xxx"
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 409 | `SLUG_TAKEN` | Slug already exists |
| 422 | `VALIDATION_ERROR` | Invalid request body |
| 502 | `CLERK_ERROR` | Failed to create Clerk organization |

---

### 4.3 `PATCH /api/v1/superadmin/gyms/[id]`

Update gym configuration. Partial update - only provided fields are changed.

**File:** `app/api/v1/superadmin/gyms/[id]/route.ts` (PATCH export)

**URL Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | `string (UUID)` | Gym ID |

**Request Body:**

```typescript
// Zod schema: UpdateGymSchema (all fields optional, at least one required)
{
  name?: string;                   // 2-100 characters
  address?: string | null;
  subscriptionStatus?: "active" | "suspended" | "cancelled" | "trial";
  subscriptionPlan?: "starter" | "pro" | "enterprise";
  maxAthletes?: number;            // 5-100
  timezone?: string;               // IANA timezone, e.g. "America/Sao_Paulo"
  language?: "es" | "pt" | "en";
}
```

**Processing Logic:**
1. Validate `id` is a valid UUID.
2. Look up gym. Return 404 if not found.
3. Validate request body (at least one field must be provided).
4. If `subscriptionStatus` changes to `suspended`, update Clerk Organization metadata to reflect suspension (used by middleware to block access).
5. Update `gyms` row, set `updated_at = NOW()`.

**Success Response (200):**

```json
{
  "gym": {
    "id": "uuid",
    "name": "CrossFit Downtown",
    "subscriptionStatus": "suspended",
    "updatedAt": "2026-02-26T12:00:00Z"
  }
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 404 | `GYM_NOT_FOUND` | No gym with that ID |
| 422 | `VALIDATION_ERROR` | Invalid request body |

---

### 4.4 `GET /api/v1/superadmin/agents`

List all registered agents across all gyms.

**File:** `app/api/v1/superadmin/agents/route.ts`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | `number` | `1` | Page number |
| `limit` | `number` | `50` | Items per page (1-100) |
| `status` | `string` | - | Filter by agent status: `online`, `offline`, `degraded`, `error`, `disabled` |
| `gymId` | `string` | - | Filter by specific gym UUID |

**Success Response (200):**

```typescript
{
  agents: Array<{
    id: string;                    // UUID
    gymId: string;                 // UUID
    gymName: string;               // Joined from gyms table
    name: string;                  // Agent display name
    status: "online" | "offline" | "degraded" | "error" | "disabled";
    lastHeartbeat: string | null;  // ISO 8601
    softwareVersion: string | null;
    ipAddress: string | null;
    hardwareModel: string | null;
    serialNumber: string | null;
    connectedSensors: number | null; // From most recent status report
    createdAt: string;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

**Note:** An agent is considered `offline` if `last_heartbeat` is older than 90 seconds (3 missed status reports at 30s intervals). This is computed at query time, not stored.

---

## 5. Gym API

All Gym endpoints require Clerk authentication and active membership in the current organization. The `orgId` from Clerk determines which gym's data is accessed (resolved via `gyms.clerk_org_id`).

**Auth guard:** Every handler calls `requireGymAccess()` which returns `{ userId, orgId, role }`. The `orgId` is mapped to `gymId` via `SELECT id FROM gyms WHERE clerk_org_id = $orgId`.

**Tenant isolation:** All database queries include `WHERE gym_id = $gymId` via the `withGymScope()` utility from `lib/utils/gym-scope.ts`.

### 5.1 `GET /api/v1/gym/profile`

Get the authenticated user's gym profile.

**File:** `app/api/v1/gym/profile/route.ts` (GET export)

**Auth:** `requireGymAccess()` -- any gym member role

**Success Response (200):**

```typescript
{
  gym: {
    id: string;
    name: string;
    slug: string;
    address: string | null;
    phone: string | null;
    timezone: string;                 // Default "America/Sao_Paulo"
    language: "es" | "pt" | "en";
    subscriptionStatus: string;
    subscriptionPlan: string;
    maxAthletes: number;
    tvAccessToken: string;            // Only included if role is org:admin
    branding: {
      logoUrl: string | null;
      primaryColor: string;           // Hex color, default "#3B82F6"
      secondaryColor: string;         // Hex color, default "#1E40AF"
    };
    createdAt: string;
  };
}
```

**Note:** `tvAccessToken` is only included when the requesting user has role `org:admin` (gym owner). Trainers do not see it.

---

### 5.2 `PATCH /api/v1/gym/profile`

Update gym profile. Only gym owners (`org:admin`) can update.

**File:** `app/api/v1/gym/profile/route.ts` (PATCH export)

**Auth:** `requireGymAccess(["org:admin"])`

**Request Body:**

```typescript
// Zod schema: UpdateGymProfileSchema
{
  name?: string;                    // 2-100 characters
  address?: string | null;          // Max 500 chars
  phone?: string | null;            // E.164 format or null
  timezone?: string;                // Valid IANA timezone
  language?: "es" | "pt" | "en";
  branding?: {
    logoUrl?: string | null;        // Valid URL or null
    primaryColor?: string;          // Valid hex color (#RRGGBB)
    secondaryColor?: string;        // Valid hex color (#RRGGBB)
  };
}
```

**Success Response (200):**

```json
{
  "gym": {
    "id": "uuid",
    "name": "Updated Name",
    "updatedAt": "2026-02-26T12:00:00Z"
  }
}
```

---

### 5.3 `GET /api/v1/gym/athletes`

List athletes belonging to the gym.

**File:** `app/api/v1/gym/athletes/route.ts` (GET export)

**Auth:** `requireGymAccess()` -- owner or trainer

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | `number` | `1` | Page number |
| `limit` | `number` | `20` | Items per page (1-100) |
| `search` | `string` | - | Search by name or email (ILIKE) |
| `active` | `boolean` | - | Filter by `is_active` status |

**Success Response (200):**

```typescript
{
  athletes: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    age: number | null;
    weightKg: number | null;
    maxHr: number;                  // Default 190
    whatsappOptIn: boolean;
    isActive: boolean;
    band: {                         // Current active band assignment, null if unassigned
      sensorId: number;
      bandLabel: string | null;
    } | null;
    lastSessionAt: string | null;   // Most recent session participation
    totalSessions: number;
    createdAt: string;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

### 5.4 `POST /api/v1/gym/athletes`

Create a new athlete in the gym.

**File:** `app/api/v1/gym/athletes/route.ts` (POST export)

**Auth:** `requireGymAccess()` -- owner or trainer

**Request Body:**

```typescript
// Zod schema: CreateAthleteSchema
{
  name: string;                    // 1-100 characters, required
  email: string | null;            // Valid email or null
  phone: string | null;            // E.164 format or null (WhatsApp number)
  age: number | null;              // 10-100 or null
  weightKg: number | null;         // 20-300 or null
  maxHr: number;                   // 100-250, default 190
  whatsappOptIn: boolean;          // Default false
}
```

**Processing Logic:**
1. Validate request body.
2. Check that gym has not exceeded `maxAthletes` count (only counts `is_active = true` athletes).
3. If `email` is provided, check uniqueness within the gym.
4. Insert into `athletes` table with `gym_id`, `is_active = true`.
5. Optionally: if email is provided, create a Clerk user and invitation with role `org:athlete`, linking `user_id`.

**Success Response (201):**

```json
{
  "athlete": {
    "id": "uuid",
    "name": "Carlos Silva",
    "email": "carlos@example.com",
    "maxHr": 185,
    "isActive": true,
    "createdAt": "2026-02-26T10:00:00Z"
  }
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 409 | `MAX_ATHLETES_REACHED` | Gym has reached `maxAthletes` limit |
| 409 | `EMAIL_ALREADY_EXISTS` | Email already used by another athlete in this gym |
| 422 | `VALIDATION_ERROR` | Invalid request body |

---

### 5.5 `PATCH /api/v1/gym/athletes/[id]`

Update an athlete's profile.

**File:** `app/api/v1/gym/athletes/[id]/route.ts` (PATCH export)

**Auth:** `requireGymAccess()` -- owner or trainer

**URL Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | `string (UUID)` | Athlete ID |

**Request Body:**

```typescript
// Zod schema: UpdateAthleteSchema (all optional, at least one required)
{
  name?: string;
  email?: string | null;
  phone?: string | null;
  age?: number | null;
  weightKg?: number | null;
  maxHr?: number;
  whatsappOptIn?: boolean;
  isActive?: boolean;
}
```

**Processing Logic:**
1. Validate athlete belongs to the gym (`gym_id` check).
2. If `email` is changed, check uniqueness within the gym.
3. If `isActive` is set to `false`, also deactivate any active band assignment in `athlete_bands`.
4. Update `athletes` row.

**Success Response (200):**

```json
{
  "athlete": {
    "id": "uuid",
    "name": "Carlos Silva",
    "updatedAt": "2026-02-26T12:00:00Z"
  }
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 404 | `ATHLETE_NOT_FOUND` | No athlete with that ID in this gym |
| 409 | `EMAIL_ALREADY_EXISTS` | Email conflict |
| 422 | `VALIDATION_ERROR` | Invalid body |

---

### 5.6 `POST /api/v1/gym/athletes/[id]/bands`

Assign an ANT+ sensor band to an athlete. Each sensor can only be assigned to one athlete per gym.

**File:** `app/api/v1/gym/athletes/[id]/bands/route.ts` (POST export)

**Auth:** `requireGymAccess()` -- owner or trainer

**URL Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | `string (UUID)` | Athlete ID |

**Request Body:**

```typescript
// Zod schema: AssignBandSchema
{
  sensorId: number;              // ANT+ sensor ID (positive integer)
  bandLabel?: string;            // Optional human-readable label, e.g. "Band #3"
}
```

**Processing Logic:**
1. Validate athlete exists and belongs to this gym.
2. Check if `sensor_id` is already assigned to another **active** athlete in this gym (`athlete_bands` table, `is_active = true`).
3. Deactivate any existing active band for this athlete (an athlete can only have one active band).
4. Insert new row into `athlete_bands` with `is_active = true`.

**Success Response (201):**

```json
{
  "band": {
    "id": "uuid",
    "athleteId": "uuid",
    "sensorId": 12345,
    "bandLabel": "Band #3",
    "isActive": true
  }
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 404 | `ATHLETE_NOT_FOUND` | Athlete not found in this gym |
| 409 | `SENSOR_ALREADY_ASSIGNED` | Sensor ID is assigned to another active athlete |
| 422 | `VALIDATION_ERROR` | Invalid body |

---

### 5.7 `DELETE /api/v1/gym/athletes/[id]/bands`

Remove the active band assignment from an athlete.

**File:** `app/api/v1/gym/athletes/[id]/bands/route.ts` (DELETE export)

**Auth:** `requireGymAccess()` -- owner or trainer

**URL Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | `string (UUID)` | Athlete ID |

**Processing Logic:**
1. Validate athlete exists and belongs to this gym.
2. Set `is_active = false` on all active `athlete_bands` rows for this athlete.
3. Return success even if no active band existed (idempotent).

**Success Response (200):**

```json
{
  "ok": true
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 404 | `ATHLETE_NOT_FOUND` | Athlete not found in this gym |

---

### 5.8 `GET /api/v1/gym/trainers`

List trainers in the gym.

**File:** `app/api/v1/gym/trainers/route.ts` (GET export)

**Auth:** `requireGymAccess(["org:admin"])` -- owner only

**Success Response (200):**

```typescript
{
  trainers: Array<{
    id: string;              // User ID
    name: string;
    email: string;
    clerkUserId: string;
    isActive: boolean;       // Membership active status
    joinedAt: string;        // ISO 8601
  }>;
}
```

**Note:** No pagination needed here as trainer count per gym is expected to be small (under 20).

---

### 5.9 `POST /api/v1/gym/trainers`

Invite a trainer to the gym via Clerk.

**File:** `app/api/v1/gym/trainers/route.ts` (POST export)

**Auth:** `requireGymAccess(["org:admin"])` -- owner only

**Request Body:**

```typescript
// Zod schema: InviteTrainerSchema
{
  email: string;               // Valid email, required
  name: string;                // 1-100 characters, required
}
```

**Processing Logic:**
1. Validate request body.
2. Create Clerk Organization Invitation with role `org:trainer`.
3. Optionally create a row in `users` table if the user does not already exist.
4. Create `gym_memberships` row with `role = 'trainer'`.

**Success Response (201):**

```json
{
  "invitation": {
    "email": "trainer@example.com",
    "role": "org:trainer",
    "status": "pending"
  }
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 409 | `ALREADY_MEMBER` | Email is already a member of this gym |
| 422 | `VALIDATION_ERROR` | Invalid body |
| 502 | `CLERK_ERROR` | Failed to create Clerk invitation |

---

### 5.10 `GET /api/v1/gym/sessions`

List workout sessions for the gym.

**File:** `app/api/v1/gym/sessions/route.ts` (GET export)

**Auth:** `requireGymAccess()` -- owner or trainer

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | `number` | `1` | Page number |
| `limit` | `number` | `20` | Items per page (1-100) |
| `from` | `string` | - | Filter sessions started on or after this date (ISO 8601 date) |
| `to` | `string` | - | Filter sessions started on or before this date (ISO 8601 date) |
| `status` | `string` | - | Filter by status: `active`, `completed`, `cancelled` |

**Success Response (200):**

```typescript
{
  sessions: Array<{
    id: string;
    classType: string | null;       // "spinning", "pilates", "cycling", "general", etc.
    status: "active" | "completed" | "cancelled";
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number | null;
    athleteCount: number;
    avgHr: number | null;           // Average HR across all athletes
    maxHr: number | null;           // Max HR recorded in this session
    trainerName: string | null;
    aiSummary: string | null;       // Only for completed sessions
    createdAt: string;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

### 5.11 `GET /api/v1/gym/sessions/active`

Get the currently active session with live aggregated data. Returns null if no session is active.

**File:** `app/api/v1/gym/sessions/active/route.ts`

**Auth:** `requireGymAccess()` -- owner or trainer

**Success Response (200):**

```typescript
{
  session: {
    id: string;
    classType: string | null;
    status: "active";
    startedAt: string;
    durationSeconds: number;         // Computed: NOW() - startedAt
    athletes: Array<{
      id: string;
      name: string;
      sensorId: number;
      currentBpm: number | null;     // Most recent reading
      avgBpm: number | null;         // Average for this session
      maxBpm: number | null;         // Max for this session
      hrZone: number;                // 1-5
      hrZoneName: string;            // "Rest", "Light", "Moderate", "Hard", "Maximum"
      hrZoneColor: string;           // "#3B82F6", "#22C55E", "#EAB308", "#F97316", "#EF4444"
      hrMaxPercent: number;          // Percentage of athlete's max HR
      lastReadingAt: string | null;  // Timestamp of last HR reading
      isActive: boolean;             // Whether sensor is currently transmitting
    }>;
    athleteCount: number;
  } | null;
}
```

---

### 5.12 `POST /api/v1/gym/sessions/[id]/end`

Manually end an active session.

**File:** `app/api/v1/gym/sessions/[id]/end/route.ts`

**Auth:** `requireGymAccess()` -- owner or trainer

**URL Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | `string (UUID)` | Session ID |

**Request Body:** None required. Optionally:

```typescript
{
  classType?: string;             // Override class type before ending
}
```

**Processing Logic:**
1. Validate session exists, belongs to this gym, and has `status = 'active'`.
2. Set `status = 'completed'`, `ended_at = NOW()`, compute `duration_seconds`.
3. Calculate per-athlete stats and insert/update `session_athletes` rows (avg_hr, max_hr, min_hr, calories, zone times).
4. Trigger async AI summary generation (store in `sessions.ai_summary`).
5. Trigger async WhatsApp report sending to opted-in athletes (2-minute delay).

**Success Response (200):**

```json
{
  "session": {
    "id": "uuid",
    "status": "completed",
    "endedAt": "2026-02-26T11:00:00Z",
    "durationSeconds": 3600,
    "athleteCount": 12
  }
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 404 | `SESSION_NOT_FOUND` | No session with that ID in this gym |
| 409 | `SESSION_NOT_ACTIVE` | Session is already completed or cancelled |

---

## 6. Athlete API

All Athlete endpoints require Clerk authentication with `org:athlete` role. The athlete's record is resolved from `athletes.user_id` matching the Clerk user ID.

**Auth guard:** Every handler calls `requireAthleteAccess()` which returns `{ userId, orgId, athleteId }`.

### 6.1 `GET /api/v1/athlete/profile`

Get the authenticated athlete's profile.

**File:** `app/api/v1/athlete/profile/route.ts` (GET export)

**Auth:** `requireAthleteAccess()`

**Success Response (200):**

```typescript
{
  athlete: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    age: number | null;
    weightKg: number | null;
    maxHr: number;
    whatsappOptIn: boolean;
    isActive: boolean;
    band: {
      sensorId: number;
      bandLabel: string | null;
    } | null;
    gym: {
      name: string;
      logoUrl: string | null;
    };
    stats: {
      totalSessions: number;
      lastSessionAt: string | null;
      weeklyStreak: number;         // Consecutive weeks with at least 1 session
    };
    createdAt: string;
  };
}
```

---

### 6.2 `PATCH /api/v1/athlete/profile`

Update the authenticated athlete's own profile. Athletes can only update specific fields.

**File:** `app/api/v1/athlete/profile/route.ts` (PATCH export)

**Auth:** `requireAthleteAccess()`

**Request Body:**

```typescript
// Zod schema: UpdateAthleteProfileSchema
{
  name?: string;                  // 1-100 characters
  age?: number | null;            // 10-100
  weightKg?: number | null;       // 20-300
  maxHr?: number;                 // 100-250
  phone?: string | null;          // E.164 format
  whatsappOptIn?: boolean;
}
```

**Note:** Athletes cannot update `email`, `isActive`, or `band` assignments. Those are managed by gym staff.

**Success Response (200):**

```json
{
  "athlete": {
    "id": "uuid",
    "name": "Carlos Silva",
    "updatedAt": "2026-02-26T12:00:00Z"
  }
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 422 | `VALIDATION_ERROR` | Invalid body |

---

### 6.3 `GET /api/v1/athlete/sessions`

List the authenticated athlete's session history.

**File:** `app/api/v1/athlete/sessions/route.ts`

**Auth:** `requireAthleteAccess()`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | `number` | `1` | Page number |
| `limit` | `number` | `20` | Items per page (1-50) |

**Success Response (200):**

```typescript
{
  sessions: Array<{
    id: string;                   // Session ID
    classType: string | null;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number | null;
    // Athlete-specific stats from session_athletes table
    avgHr: number;
    maxHr: number;
    minHr: number;
    calories: number;
    hrZones: {
      zone1Seconds: number;       // Rest
      zone2Seconds: number;       // Light
      zone3Seconds: number;       // Moderate
      zone4Seconds: number;       // Hard
      zone5Seconds: number;       // Maximum
    };
    gymName: string;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

### 6.4 `GET /api/v1/athlete/sessions/[id]`

Get detailed session data for a specific session the athlete participated in.

**File:** `app/api/v1/athlete/sessions/[id]/route.ts`

**Auth:** `requireAthleteAccess()`

**URL Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | `string (UUID)` | Session ID |

**Processing Logic:**
1. Verify the athlete participated in this session (check `session_athletes` table).
2. Return 404 if the athlete was not part of this session.
3. Fetch HR readings for this athlete in this session.

**Success Response (200):**

```typescript
{
  session: {
    id: string;
    classType: string | null;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number | null;
    aiSummary: string | null;
    stats: {
      avgHr: number;
      maxHr: number;
      minHr: number;
      calories: number;
      hrZones: {
        zone1Seconds: number;
        zone2Seconds: number;
        zone3Seconds: number;
        zone4Seconds: number;
        zone5Seconds: number;
      };
    };
    // Time-series HR data for charting (downsampled if session is long)
    hrData: Array<{
      timestamp: string;          // ISO 8601
      bpm: number;
      zone: number;               // 1-5
    }>;
    // AI coaching messages received during this session
    aiMessages: Array<{
      message: string;
      createdAt: string;
    }>;
    gymName: string;
  };
}
```

**Note on `hrData` downsampling:** If the session has more than 720 data points (1 hour at 5s intervals), downsample to 1 point per 10 seconds by averaging. This keeps the response under 100KB.

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 404 | `SESSION_NOT_FOUND` | Session not found or athlete did not participate |

---

### 6.5 `GET /api/v1/athlete/progress`

Get progress/trend data for the authenticated athlete.

**File:** `app/api/v1/athlete/progress/route.ts`

**Auth:** `requireAthleteAccess()`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | `string` | `weekly` | Aggregation period: `weekly` or `monthly` |

**Success Response (200):**

```typescript
{
  progress: {
    period: "weekly" | "monthly";
    dataPoints: Array<{
      periodStart: string;        // ISO 8601 date (Monday for weekly, 1st for monthly)
      periodEnd: string;          // ISO 8601 date
      sessionCount: number;
      totalDurationSeconds: number;
      avgHr: number | null;
      avgCalories: number | null;
      avgTimeInZone4Plus: number | null; // Seconds in zones 4-5 per session
    }>;
    summary: {
      totalSessions: number;       // In the selected period range
      avgSessionsPerWeek: number;
      trend: "improving" | "stable" | "declining"; // Based on avg HR efficiency
    };
  };
}
```

**Note:** Returns last 12 weeks for `weekly` or last 12 months for `monthly`.

---

## 7. Reports API

Reports can be accessed by gym staff (owner/trainer) and by athletes for their own sessions.

### 7.1 `GET /api/v1/reports/session/[id]`

Get a full session report. Gym staff can see all athletes; athletes can only see their own data.

**File:** `app/api/v1/reports/session/[id]/route.ts`

**Auth:** `requireGymAccess()` OR `requireAthleteAccess()` (checked in order)

**URL Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | `string (UUID)` | Session ID |

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `athleteId` | `string (UUID)` | - | Filter to specific athlete (gym staff only) |

**Success Response (200):**

```typescript
{
  report: {
    session: {
      id: string;
      classType: string | null;
      startedAt: string;
      endedAt: string | null;
      durationSeconds: number;
      athleteCount: number;
      aiSummary: string | null;
    };
    gym: {
      name: string;
      logoUrl: string | null;
      primaryColor: string;
    };
    athletes: Array<{
      id: string;
      name: string;
      avgHr: number;
      maxHr: number;
      minHr: number;
      calories: number;
      hrZones: {
        zone1: { seconds: number; percent: number };
        zone2: { seconds: number; percent: number };
        zone3: { seconds: number; percent: number };
        zone4: { seconds: number; percent: number };
        zone5: { seconds: number; percent: number };
      };
      hrData: Array<{
        timestamp: string;
        bpm: number;
        zone: number;
      }>;
    }>;
  };
}
```

**Access Logic:**
- If the caller is gym staff (`org:admin` or `org:trainer`), return all athletes or filter by `athleteId` query param.
- If the caller is an athlete (`org:athlete`), return only their own data. Ignore `athleteId` query param.

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 403 | `FORBIDDEN` | Athlete trying to access another athlete's data |
| 404 | `SESSION_NOT_FOUND` | Session not found in this gym |

---

### 7.2 `POST /api/v1/reports/session/[id]/send-whatsapp`

Send session report via WhatsApp to one or more athletes.

**File:** `app/api/v1/reports/session/[id]/send-whatsapp/route.ts`

**Auth:** `requireGymAccess()` -- owner or trainer only

**URL Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | `string (UUID)` | Session ID |

**Request Body:**

```typescript
// Zod schema: SendWhatsAppSchema
{
  athleteIds?: string[];          // UUIDs. If omitted, send to ALL opted-in athletes in the session.
}
```

**Processing Logic:**
1. Validate session exists, belongs to this gym, and has `status = 'completed'`.
2. Resolve target athletes:
   - If `athleteIds` provided, validate they participated in the session and have `whatsapp_opt_in = true` and a valid `phone`.
   - If omitted, select all athletes in `session_athletes` who have opt-in and phone.
3. For each athlete, compose Twilio WhatsApp template message with session stats.
4. Send messages via `lib/whatsapp/client.ts`. Queue failures for one retry.
5. Return send status per athlete.

**Success Response (200):**

```typescript
{
  results: Array<{
    athleteId: string;
    athleteName: string;
    phone: string;
    status: "sent" | "failed" | "skipped"; // "skipped" if no opt-in or no phone
    error?: string;                         // Only if status is "failed"
  }>;
  summary: {
    sent: number;
    failed: number;
    skipped: number;
  };
}
```

**Error Responses:**

| Status | Code | When |
|--------|------|------|
| 404 | `SESSION_NOT_FOUND` | Session not found in this gym |
| 409 | `SESSION_NOT_COMPLETED` | Session is still active or was cancelled |
| 422 | `VALIDATION_ERROR` | Invalid `athleteIds` |
| 503 | `WHATSAPP_UNAVAILABLE` | Twilio API is unreachable |

---

## 8. Error Codes

All error responses use the standard `{ error: string, code: string }` shape.

### 8.1 HTTP Status Codes

| Status | Usage |
|--------|-------|
| `200` | Successful read, update, or action |
| `201` | Successful resource creation |
| `400` | Malformed request (bad JSON, missing required fields) |
| `401` | Authentication required but not provided or invalid |
| `403` | Authenticated but insufficient permissions |
| `404` | Resource not found |
| `409` | Conflict (duplicate, state conflict) |
| `422` | Validation error (well-formed request but invalid data) |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `502` | Upstream service error (Clerk, Twilio) |
| `503` | Service unavailable |

### 8.2 Application Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient role or permission |
| `AGENT_DISABLED` | 403 | Agent has been disabled by admin |
| `NOT_FOUND` | 404 | Generic resource not found |
| `GYM_NOT_FOUND` | 404 | Gym does not exist |
| `ATHLETE_NOT_FOUND` | 404 | Athlete does not exist in this gym |
| `SESSION_NOT_FOUND` | 404 | Session does not exist in this gym |
| `VALIDATION_ERROR` | 422 | Request body failed Zod validation |
| `SLUG_TAKEN` | 409 | Gym slug already in use |
| `EMAIL_ALREADY_EXISTS` | 409 | Email already used by another athlete in the gym |
| `MAX_ATHLETES_REACHED` | 409 | Gym has reached its athlete limit |
| `SENSOR_ALREADY_ASSIGNED` | 409 | ANT+ sensor already assigned to another athlete |
| `SESSION_NOT_ACTIVE` | 409 | Action requires an active session but it is not active |
| `SESSION_NOT_COMPLETED` | 409 | Action requires a completed session |
| `GYM_MISMATCH` | 422 | Provided gymId does not match agent's assigned gym |
| `GYM_SUSPENDED` | 403 | Gym subscription is suspended |
| `RATE_LIMITED` | 429 | Too many requests |
| `CLERK_ERROR` | 502 | Clerk API failure |
| `WHATSAPP_UNAVAILABLE` | 503 | Twilio WhatsApp API is unreachable |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### 8.3 Validation Error Detail

When `code` is `VALIDATION_ERROR`, the response includes field-level details:

```typescript
{
  error: "Validation failed",
  code: "VALIDATION_ERROR",
  details: Array<{
    field: string;        // Dot-notation path, e.g. "devices.12345.bpm"
    message: string;      // Human-readable error
  }>
}
```

This is produced by mapping Zod's `ZodError.issues` array.

---

## 9. Pagination

All list endpoints use a consistent pagination pattern.

### 9.1 Request

Pagination is always controlled via query parameters:

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `page` | `number` | `1` | Must be >= 1 |
| `limit` | `number` | `20` | Must be 1-100 (some endpoints cap at 50) |

### 9.2 Response Envelope

Every paginated response includes these fields at the top level alongside the data array:

```typescript
{
  [resourceName]: Array<T>;     // e.g. "gyms", "athletes", "sessions"
  total: number;                 // Total count of matching records
  page: number;                  // Current page number (1-indexed)
  limit: number;                 // Items per page (as requested or capped)
  totalPages: number;            // ceil(total / limit)
}
```

### 9.3 Implementation

```typescript
// lib/api/pagination.ts
import { z } from "zod";

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationParams = z.infer<typeof PaginationSchema>;

export function paginationMeta(total: number, params: PaginationParams) {
  return {
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(total / params.limit),
  };
}

export function paginationOffsetLimit(params: PaginationParams) {
  return {
    offset: (params.page - 1) * params.limit,
    limit: params.limit,
  };
}
```

### 9.4 Empty Results

When no results match, the response is still valid with an empty array:

```json
{
  "athletes": [],
  "total": 0,
  "page": 1,
  "limit": 20,
  "totalPages": 0
}
```

---

## 10. Rate Limiting

Rate limiting is implemented at the route handler level using an in-memory sliding window counter (production: Redis-backed via Upstash or similar).

### 10.1 Limits by Endpoint Category

| Category | Rate Limit | Window | Scope |
|----------|-----------|--------|-------|
| Agent heartbeat | 20 req/s | 1 second | Per `agentId` |
| Agent status | 5 req/s | 1 second | Per `agentId` |
| SuperAdmin read | 30 req/min | 1 minute | Per `userId` |
| SuperAdmin write | 10 req/min | 1 minute | Per `userId` |
| Gym read | 60 req/min | 1 minute | Per `userId` |
| Gym write | 30 req/min | 1 minute | Per `userId` |
| Athlete read | 30 req/min | 1 minute | Per `userId` |
| Athlete write | 10 req/min | 1 minute | Per `userId` |
| WhatsApp send | 5 req/min | 1 minute | Per `gymId` |

### 10.2 Rate Limit Response

When rate limited, the endpoint returns:

```
HTTP 429 Too Many Requests
```

```json
{
  "error": "Rate limit exceeded. Try again in 12 seconds.",
  "code": "RATE_LIMITED"
}
```

**Headers included on all responses:**

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed in the window |
| `X-RateLimit-Remaining` | Remaining requests in the current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds until the client can retry (only on 429) |

### 10.3 Implementation

```typescript
// lib/api/rate-limit.ts
interface RateLimitConfig {
  max: number;           // Max requests per window
  windowSeconds: number; // Window duration
}

export function rateLimit(config: RateLimitConfig): (key: string) => Promise<RateLimitResult>;

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;       // Unix timestamp
  retryAfter?: number;   // Seconds (only when !allowed)
}
```

---

## 11. Validation

All request validation is performed using **Zod** schemas. Validation is the first step in every route handler, immediately after authentication.

### 11.1 Approach

1. **Define schema** in a co-located file or inline within the route handler.
2. **Parse request body** using `schema.safeParse(await request.json())`.
3. **Parse query params** using `schema.safeParse(Object.fromEntries(url.searchParams))`.
4. **Parse URL params** using `z.object({ id: z.string().uuid() }).safeParse(params)`.
5. On failure, return `422` with `VALIDATION_ERROR` code and field-level details.

### 11.2 Schema Organization

```
lib/
  validations/
    agent.ts          -- AgentHeartbeatSchema, AgentStatusSchema
    gym.ts            -- CreateGymSchema, UpdateGymSchema, UpdateGymProfileSchema
    athlete.ts        -- CreateAthleteSchema, UpdateAthleteSchema, UpdateAthleteProfileSchema
    band.ts           -- AssignBandSchema
    trainer.ts        -- InviteTrainerSchema
    session.ts        -- EndSessionSchema
    report.ts         -- SendWhatsAppSchema
    common.ts         -- PaginationSchema, UuidParamSchema
```

### 11.3 Validation Helper

```typescript
// lib/api/validate.ts
import { ZodSchema, ZodError } from "zod";
import { NextResponse } from "next/server";

export function validateBody<T>(schema: ZodSchema<T>, body: unknown):
  | { success: true; data: T }
  | { success: false; response: NextResponse } {
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          details: result.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      ),
    };
  }
  return { success: true, data: result.data };
}

export function validateQuery<T>(schema: ZodSchema<T>, searchParams: URLSearchParams):
  | { success: true; data: T }
  | { success: false; response: NextResponse };
```

### 11.4 Route Handler Pattern

Every route handler follows this consistent pattern:

```typescript
// app/api/v1/gym/athletes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireGymAccess } from "@/lib/auth/guards";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { CreateAthleteSchema } from "@/lib/validations/athlete";
import { PaginationSchema } from "@/lib/validations/common";
import { rateLimit } from "@/lib/api/rate-limit";
import { ok, error } from "@/lib/api/response";

// Rate limiter for gym write operations
const writeLimit = rateLimit({ max: 30, windowSeconds: 60 });

export async function GET(request: NextRequest) {
  // 1. Authenticate & authorize
  const auth = await requireGymAccess();
  if (!auth) return; // Guard already sent error response

  // 2. Rate limit
  const rl = await writeLimit(auth.userId);
  if (!rl.allowed) {
    return error(`Rate limit exceeded. Try again in ${rl.retryAfter} seconds.`, "RATE_LIMITED", 429);
  }

  // 3. Validate query params
  const query = validateQuery(PaginationSchema, request.nextUrl.searchParams);
  if (!query.success) return query.response;

  // 4. Business logic (database queries with gym scope)
  const { offset, limit } = paginationOffsetLimit(query.data);
  const [athletes, total] = await getAthletes(auth.gymId, { offset, limit });

  // 5. Return response
  return ok({ athletes, ...paginationMeta(total, query.data) });
}

export async function POST(request: NextRequest) {
  const auth = await requireGymAccess();
  if (!auth) return;

  const body = validateBody(CreateAthleteSchema, await request.json());
  if (!body.success) return body.response;

  const athlete = await createAthlete(auth.gymId, body.data);
  return ok({ athlete }, 201);
}
```

### 11.5 Common Zod Patterns

```typescript
// Reusable Zod refinements
const uuid = z.string().uuid();
const email = z.string().email().toLowerCase().trim();
const phone = z.string().regex(/^\+[1-9]\d{1,14}$/, "Must be E.164 format").nullable();
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be hex color (#RRGGBB)");
const ianaTimezone = z.string().refine(
  (tz) => { try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; } },
  "Must be a valid IANA timezone"
);
```

---

## Appendix A: Full Endpoint Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/agent/heartbeat` | Agent | Batch HR sensor data |
| `POST` | `/api/agent/status` | Agent | Agent health status |
| `GET` | `/api/v1/superadmin/gyms` | SuperAdmin | List all gyms |
| `POST` | `/api/v1/superadmin/gyms` | SuperAdmin | Create gym |
| `PATCH` | `/api/v1/superadmin/gyms/[id]` | SuperAdmin | Update gym |
| `GET` | `/api/v1/superadmin/agents` | SuperAdmin | List all agents |
| `GET` | `/api/v1/gym/profile` | Gym Member | Get gym profile |
| `PATCH` | `/api/v1/gym/profile` | Gym Owner | Update gym profile |
| `GET` | `/api/v1/gym/athletes` | Gym Member | List athletes |
| `POST` | `/api/v1/gym/athletes` | Gym Member | Create athlete |
| `PATCH` | `/api/v1/gym/athletes/[id]` | Gym Member | Update athlete |
| `POST` | `/api/v1/gym/athletes/[id]/bands` | Gym Member | Assign band |
| `DELETE` | `/api/v1/gym/athletes/[id]/bands` | Gym Member | Remove band |
| `GET` | `/api/v1/gym/trainers` | Gym Owner | List trainers |
| `POST` | `/api/v1/gym/trainers` | Gym Owner | Invite trainer |
| `GET` | `/api/v1/gym/sessions` | Gym Member | List sessions |
| `GET` | `/api/v1/gym/sessions/active` | Gym Member | Get active session |
| `POST` | `/api/v1/gym/sessions/[id]/end` | Gym Member | End session |
| `GET` | `/api/v1/athlete/profile` | Athlete | Get own profile |
| `PATCH` | `/api/v1/athlete/profile` | Athlete | Update own profile |
| `GET` | `/api/v1/athlete/sessions` | Athlete | List own sessions |
| `GET` | `/api/v1/athlete/sessions/[id]` | Athlete | Session detail |
| `GET` | `/api/v1/athlete/progress` | Athlete | Progress data |
| `GET` | `/api/v1/reports/session/[id]` | Gym/Athlete | Session report |
| `POST` | `/api/v1/reports/session/[id]/send-whatsapp` | Gym Member | Send WhatsApp report |

**Total endpoints: 26**
