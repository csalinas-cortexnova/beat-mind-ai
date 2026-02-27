# SuperAdmin Dashboard - Technical Specification

**Module:** SuperAdmin Dashboard (`/superadmin`)
**Version:** 1.0
**Date:** 2026-02-26
**Status:** Draft
**PRD Reference:** BeatMind AI PRD v1.0, Section 4.1

---

## 1. Overview

The SuperAdmin Dashboard is the platform owner's control center for managing all gyms, subscriptions, hardware, and global analytics across the BeatMind AI multi-tenant SaaS platform. It is accessible exclusively by the platform operator (SuperAdmin) and provides full visibility into every tenant (gym) in the system.

This module is part of **Phase 1: Foundation (Weeks 1-3)** and is a prerequisite for all other modules since gyms must be created here before any gym-level functionality can operate.

### Scope

- CRUD operations for gym tenants
- Subscription lifecycle management
- Owner assignment via Clerk invitations
- Hardware inventory tracking (mini PCs, ANT+ dongles)
- Agent health monitoring
- Global platform analytics

### Out of Scope

- Gym-level management (athletes, trainers, sessions) -- covered by Gym Dashboard spec
- TV Dashboard configuration -- covered by TV Dashboard spec
- Billing/payment processing -- subscriptions are managed offline; this module only tracks status
- Agent software deployment/updates -- agents self-report; no remote management in v1

---

## 2. Access Control

### Authentication

All `/superadmin/*` routes are protected by Clerk middleware. The user must be signed in via Clerk.

### Authorization

Access is granted exclusively to users with the `is_superadmin` flag set to `true` in their Clerk user **public metadata**.

```typescript
// lib/auth/guards.ts
import { auth, currentUser } from "@clerk/nextjs/server";

export async function requireSuperAdmin(): Promise<{
  userId: string;
  clerkUserId: string;
}> {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const user = await currentUser();
  if (!user?.publicMetadata?.is_superadmin) {
    redirect("/");
  }

  // Resolve internal user ID from clerk_user_id
  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  if (!dbUser.length || !dbUser[0].isSuperadmin) {
    redirect("/");
  }

  return { userId: dbUser[0].id, clerkUserId: userId };
}
```

### Middleware Configuration

```typescript
// middleware.ts (Clerk)
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isSuperAdminRoute = createRouteMatcher(["/superadmin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isSuperAdminRoute(req)) {
    const { userId } = await auth();
    if (!userId) {
      return auth().redirectToSignIn();
    }
    // Fine-grained check happens in page-level guards (requireSuperAdmin)
    // Middleware only ensures the user is authenticated
    await auth.protect();
  }
});
```

### Security Notes

- The `is_superadmin` flag must be set in **both** Clerk public metadata and the `users` database table. The guard checks both.
- There is no UI to self-assign SuperAdmin status. It must be set via Clerk Dashboard or a database migration.
- All SuperAdmin API endpoints must call `requireSuperAdmin()` before processing.

---

## 3. Pages and Routes

### Route Structure

All SuperAdmin pages live under the `(platform)/superadmin` route group, sharing a common layout with sidebar navigation.

```
app/
  (platform)/
    superadmin/
      layout.tsx              -- SuperAdmin layout with sidebar + guard
      page.tsx                -- /superadmin (Overview)
      gyms/
        page.tsx              -- /superadmin/gyms (Gym List)
        new/
          page.tsx            -- /superadmin/gyms/new (Create Gym)
        [id]/
          page.tsx            -- /superadmin/gyms/[id] (Edit Gym)
      agents/
        page.tsx              -- /superadmin/agents (Hardware/Agent Management)
```

### 3.1 Layout (`/superadmin` - layout.tsx)

**Purpose:** Shared shell for all SuperAdmin pages. Runs the `requireSuperAdmin()` guard once at the layout level.

**Components:**
- Sidebar navigation with links to all SuperAdmin pages
- Top bar with breadcrumbs and user avatar (Clerk `<UserButton />`)
- Main content area (children)

**Sidebar Links:**
| Label | Route | Icon |
|-------|-------|------|
| Overview | `/superadmin` | `LayoutDashboard` |
| Gyms | `/superadmin/gyms` | `Building2` |
| Agents | `/superadmin/agents` | `Cpu` |

### 3.2 Overview Page (`/superadmin`)

**Purpose:** High-level platform health at a glance.

**Data Displayed:**
- Stats cards row:
  - Total Gyms (count of all gyms)
  - Active Gyms (count where `subscription_status = 'active'`)
  - Total Athletes (sum of active athletes across all gyms)
  - Active Sessions Right Now (count where `sessions.status = 'active'`)
  - Sessions This Month (count of sessions started in current calendar month)
  - Agents Online (count where `agents.status = 'connected'` and `last_heartbeat` within 90 seconds)
- Recent Activity feed (last 10 events):
  - New gym created
  - Gym status changed
  - Agent connected/disconnected
- Quick Actions:
  - "Create New Gym" button linking to `/superadmin/gyms/new`

**Server Component:** Yes (fetches data server-side).

### 3.3 Gym List Page (`/superadmin/gyms`)

**Purpose:** Searchable, sortable table of all gyms in the platform.

**Table Columns:**
| Column | Source | Sortable | Filterable |
|--------|--------|----------|------------|
| Name | `gyms.name` | Yes | Yes (search) |
| Slug | `gyms.slug` | No | No |
| Status | `gyms.subscription_status` | Yes | Yes (dropdown: all/active/suspended/cancelled) |
| Plan | `gyms.subscription_plan` | Yes | Yes (dropdown) |
| Athletes | Count from `athletes` where `gym_id` and `is_active` | Yes | No |
| Owner | Resolved from `gym_memberships` where `role = 'owner'` | No | No |
| Last Active | Most recent `sessions.started_at` for the gym | Yes | No |
| Agent Status | `agents.status` for agents assigned to the gym | No | Yes (dropdown: online/offline/none) |
| Created | `gyms.created_at` | Yes | No |

**Features:**
- Text search across gym name and slug
- Filter by subscription status and plan
- Pagination (25 rows per page, server-side)
- Sort by clicking column headers (server-side)
- Click row to navigate to `/superadmin/gyms/[id]`
- "Create Gym" button in top-right

**URL State:** Filters, sort, and pagination are stored in URL search params for bookmarkability:
```
/superadmin/gyms?status=active&plan=pro&sort=name&order=asc&page=2&q=fit
```

### 3.4 Create Gym Page (`/superadmin/gyms/new`)

**Purpose:** Form to provision a new gym tenant.

**Form Fields:**

| Field | Type | Required | Validation | Notes |
|-------|------|----------|------------|-------|
| Gym Name | text | Yes | 2-100 chars | |
| Slug | text | Auto-generated | lowercase, alphanumeric + hyphens, unique | Auto-derived from name, editable |
| Address | text | No | max 500 chars | |
| Phone | text | No | E.164 format | |
| Timezone | select | Yes | IANA timezone | Default: `America/Sao_Paulo` |
| Language | select | Yes | `es` / `pt` | Default: `pt` |
| Subscription Plan | select | Yes | `starter` / `pro` / `enterprise` | |
| Max Athletes | number | Yes | 1-100 | Default based on plan |
| Owner Email | email | Yes | valid email | Used for Clerk invitation |
| Owner Name | text | Yes | 2-100 chars | |
| Primary Color | color picker | No | hex color | Default: `#6366F1` |
| Secondary Color | color picker | No | hex color | Default: `#818CF8` |

**Plan Defaults:**

| Plan | Max Athletes | Price (reference only) |
|------|-------------|----------------------|
| Starter | 15 | - |
| Pro | 30 | - |
| Enterprise | 100 | - |

**Submission Flow:**

1. Validate all form fields client-side (React Hook Form + Zod)
2. Submit via Server Action
3. Server Action:
   a. Validate server-side (Zod)
   b. Create Clerk Organization with gym name
   c. Insert row into `gyms` table with `clerk_org_id` and generated `tv_access_token` (UUIDv4)
   d. Insert row into `users` table for the owner (if not exists) from Clerk data
   e. Send Clerk Organization invitation to owner email with role `org:admin`
   f. Insert `gym_memberships` row (status pending until invitation accepted)
   g. Return success with redirect to `/superadmin/gyms/[id]`
4. On error: display toast with error message, preserve form state

### 3.5 Edit Gym Page (`/superadmin/gyms/[id]`)

**Purpose:** View and edit gym details, manage subscription, view assigned hardware.

**Sections:**

**A. Gym Details (editable form)**
Same fields as Create, except:
- Slug is read-only after creation
- Owner Email is read-only (displayed, not editable -- use "Reassign Owner" action)

**B. Subscription Management**
| Field | Type | Options |
|-------|------|---------|
| Subscription Status | select | `active` / `suspended` / `cancelled` |
| Subscription Plan | select | `starter` / `pro` / `enterprise` |
| Max Athletes | number | 1-100 |

Status transitions trigger side effects (see Section 8: Business Rules).

**C. Owner Section**
- Display current owner (name, email)
- "Reassign Owner" button: opens modal with email input, sends new Clerk invitation, marks previous owner's membership as inactive
- Owner invitation status badge: `pending` / `accepted`

**D. TV Access Token**
- Display current token (masked, with copy button)
- "Regenerate Token" button with confirmation dialog
- TV Dashboard URL: `https://[domain]/tv/[gymId]?token=[TOKEN]`

**E. Assigned Hardware (read-only summary)**
- Table of agents assigned to this gym (name, serial, status, last heartbeat)
- Link to `/superadmin/agents` filtered by this gym

**F. Quick Stats (read-only)**
- Total athletes (active)
- Total sessions (all time)
- Sessions this month
- Last session date

### 3.6 Agents Page (`/superadmin/agents`)

**Purpose:** Hardware inventory and agent health monitoring.

**Table Columns:**
| Column | Source | Sortable |
|--------|--------|----------|
| Name | `agents.name` | Yes |
| Serial Number | `agents.serial_number` | Yes |
| Assigned Gym | Resolved from `gyms.name` via `agents.gym_id` | Yes |
| Hardware Model | `agents.hardware_model` | No |
| Status | `agents.status` | Yes |
| Last Heartbeat | `agents.last_heartbeat` | Yes |
| Software Version | `agents.software_version` | No |
| IP Address | `agents.ip_address` | No |

**Status Values and Badge Colors:**
| Status | Badge Color | Condition |
|--------|-------------|-----------|
| Connected | Green | `status = 'connected'` AND `last_heartbeat` within 90s |
| Disconnected | Red | `status = 'disconnected'` OR `last_heartbeat` older than 90s |
| Never Connected | Gray | `last_heartbeat IS NULL` |

**Features:**
- Filter by gym (dropdown of all gyms)
- Filter by status (connected/disconnected/never connected)
- Health indicator auto-refreshes every 30 seconds (client-side polling via `setInterval` + `router.refresh()`)
- Click row to expand detail panel showing:
  - Full agent config (JSON viewer, read-only)
  - Heartbeat history (last 24 hours as a timeline)
  - Assigned ANT+ dongles

**Note:** Agent creation is not done through this UI. Agents self-register when they first connect to the platform via the Agent API. The SuperAdmin can only view and reassign agents to different gyms.

---

## 4. Features by Priority

### P0 - Must Have (Phase 1)

#### P0.1: List Gyms
- Server-side paginated table with all gyms
- Columns: name, status, plan, athlete count, owner, last active, agent status
- Search by name
- Filter by subscription status
- Sort by any sortable column

#### P0.2: Create Gym
- Multi-field form with validation
- Clerk Organization creation
- Owner invitation via Clerk
- TV access token generation
- Default plan configuration

#### P0.3: Edit Gym
- Update gym details (name, address, phone, timezone, language, colors)
- Change subscription status with side effects
- Change subscription plan and max athletes
- View and regenerate TV access token

#### P0.4: Assign Owner
- Clerk Organization invitation with `org:admin` role
- Owner reassignment (deactivate previous, invite new)
- Invitation status tracking

### P1 - Should Have (Phase 1-2)

#### P1.1: Hardware Inventory
- List all agents (mini PCs) across all gyms
- Display serial number, hardware model, assigned gym
- Reassign agent to different gym
- View dongles associated with each agent

#### P1.2: Agent Health Monitoring
- Real-time status (connected/disconnected) based on heartbeat
- Last heartbeat timestamp
- Auto-refresh every 30 seconds
- Visual indicators (green/red/gray badges)

### P2 - Nice to Have (Phase 5)

#### P2.1: Global Analytics
- Total athletes across all gyms
- Active sessions right now (real-time count)
- Total sessions this month
- Growth trends (gyms added over time)
- Top gyms by session count

---

## 5. UI Components

### Component Inventory

All components are built with React 19 Server Components where possible, with Client Components only for interactivity.

#### 5.1 Layout Components

**`SuperAdminLayout`** - `components/superadmin/layout.tsx`
```typescript
// Server Component
// Props: { children: React.ReactNode }
// - Sidebar with navigation links
// - Top bar with breadcrumbs
// - Clerk <UserButton />
// - Active route highlighting
```

**`SuperAdminSidebar`** - `components/superadmin/sidebar.tsx`
```typescript
// Client Component (needs usePathname for active state)
// - Logo/brand at top
// - Nav links with icons
// - Collapsible on mobile
```

#### 5.2 Data Display Components

**`StatsCard`** - `components/superadmin/stats-card.tsx`
```typescript
interface StatsCardProps {
  label: string;
  value: number | string;
  description?: string;      // e.g., "+12% from last month"
  icon: React.ReactNode;
  trend?: "up" | "down" | "neutral";
}
// Server Component
// Renders a card with large value, label, optional trend indicator
```

**`StatsCardGrid`** - `components/superadmin/stats-card-grid.tsx`
```typescript
interface StatsCardGridProps {
  children: React.ReactNode;
}
// Server Component
// Responsive grid: 2 cols on mobile, 3 on tablet, 4-6 on desktop
// CSS: grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4
```

**`DataTable`** - `components/ui/data-table.tsx`
```typescript
interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  sorting?: {
    column: string;
    direction: "asc" | "desc";
  };
  onSort?: (column: string) => void;
  onPageChange?: (page: number) => void;
}
// Client Component
// - Renders table with headers, rows, pagination controls
// - Sortable column headers with arrow indicators
// - Empty state message
// - Loading skeleton
```

**`StatusBadge`** - `components/ui/status-badge.tsx`
```typescript
interface StatusBadgeProps {
  status: string;
  variant: "success" | "warning" | "danger" | "neutral" | "info";
}
// Server Component
// Maps subscription_status and agent status to colors:
//   active     -> success  (green)
//   suspended  -> warning  (amber)
//   cancelled  -> danger   (red)
//   connected  -> success  (green)
//   disconnected -> danger (red)
//   pending    -> info     (blue)
//   never      -> neutral  (gray)
```

#### 5.3 Form Components

**`GymForm`** - `components/superadmin/gym-form.tsx`
```typescript
interface GymFormProps {
  mode: "create" | "edit";
  initialData?: GymFormData;
  onSubmit: (data: GymFormData) => Promise<void>;
}
// Client Component
// - React Hook Form with Zod validation
// - All fields from Section 3.4
// - Auto-slug generation from name
// - Color picker for brand colors
// - Plan-based max athletes defaults
// - Loading state on submit
// - Error display per field
```

**`SubscriptionManager`** - `components/superadmin/subscription-manager.tsx`
```typescript
interface SubscriptionManagerProps {
  gymId: string;
  currentStatus: "active" | "suspended" | "cancelled";
  currentPlan: "starter" | "pro" | "enterprise";
  maxAthletes: number;
}
// Client Component
// - Status selector with confirmation dialog for destructive changes
// - Plan selector
// - Max athletes input
// - Save button triggers Server Action
```

**`OwnerAssignment`** - `components/superadmin/owner-assignment.tsx`
```typescript
interface OwnerAssignmentProps {
  gymId: string;
  currentOwner: {
    name: string;
    email: string;
    status: "pending" | "accepted";
  } | null;
}
// Client Component
// - Displays current owner info
// - "Reassign Owner" button opens modal
// - Modal: email input + name input + confirm button
// - Confirmation dialog warning about previous owner removal
```

**`TvTokenManager`** - `components/superadmin/tv-token-manager.tsx`
```typescript
interface TvTokenManagerProps {
  gymId: string;
  gymSlug: string;
  token: string;
}
// Client Component
// - Masked token display with "Show"/"Copy" buttons
// - Full TV URL with copy button
// - "Regenerate" button with confirmation dialog
```

#### 5.4 Agent Components

**`AgentStatusIndicator`** - `components/superadmin/agent-status-indicator.tsx`
```typescript
interface AgentStatusIndicatorProps {
  status: "connected" | "disconnected" | "never_connected";
  lastHeartbeat: Date | null;
}
// Server Component
// - Colored dot (green/red/gray) + status text
// - Relative time since last heartbeat (e.g., "2 minutes ago")
```

**`AgentDetailPanel`** - `components/superadmin/agent-detail-panel.tsx`
```typescript
interface AgentDetailPanelProps {
  agent: Agent;
}
// Client Component (expandable panel)
// - Config JSON viewer (read-only, syntax highlighted)
// - Gym reassignment dropdown
// - Heartbeat timeline (last 24h)
```

---

## 6. Data Requirements

### 6.1 Database Queries

#### Overview Page Queries

```sql
-- Total gyms count
SELECT COUNT(*) FROM gyms;

-- Active gyms count
SELECT COUNT(*) FROM gyms WHERE subscription_status = 'active';

-- Total active athletes count
SELECT COUNT(*) FROM athletes WHERE is_active = true;

-- Active sessions right now
SELECT COUNT(*) FROM sessions WHERE status = 'active';

-- Sessions this month
SELECT COUNT(*) FROM sessions
WHERE started_at >= date_trunc('month', CURRENT_DATE);

-- Agents online (heartbeat within 90 seconds)
SELECT COUNT(*) FROM agents
WHERE status = 'connected'
  AND last_heartbeat > NOW() - INTERVAL '90 seconds';
```

#### Gym List Page Query

```sql
SELECT
  g.id, g.name, g.slug, g.subscription_status, g.subscription_plan,
  g.created_at,
  COUNT(DISTINCT a.id) FILTER (WHERE a.is_active) AS athlete_count,
  MAX(s.started_at) AS last_session_at,
  u.name AS owner_name, u.email AS owner_email,
  ag.status AS agent_status, ag.last_heartbeat
FROM gyms g
LEFT JOIN athletes a ON a.gym_id = g.id
LEFT JOIN sessions s ON s.gym_id = g.id
LEFT JOIN gym_memberships gm ON gm.gym_id = g.id AND gm.role = 'owner' AND gm.is_active = true
LEFT JOIN users u ON u.id = gm.user_id
LEFT JOIN agents ag ON ag.gym_id = g.id
WHERE (:status IS NULL OR g.subscription_status = :status)
  AND (:plan IS NULL OR g.subscription_plan = :plan)
  AND (:search IS NULL OR g.name ILIKE '%' || :search || '%')
GROUP BY g.id, u.name, u.email, ag.status, ag.last_heartbeat
ORDER BY :sort_column :sort_direction
LIMIT :page_size OFFSET :offset;
```

#### Gym Detail Page Queries

```sql
-- Gym details
SELECT * FROM gyms WHERE id = :gym_id;

-- Current owner
SELECT u.id, u.name, u.email, gm.is_active
FROM gym_memberships gm
JOIN users u ON u.id = gm.user_id
WHERE gm.gym_id = :gym_id AND gm.role = 'owner'
ORDER BY gm.created_at DESC LIMIT 1;

-- Assigned agents
SELECT * FROM agents WHERE gym_id = :gym_id;

-- Quick stats
SELECT
  (SELECT COUNT(*) FROM athletes WHERE gym_id = :gym_id AND is_active = true) AS active_athletes,
  (SELECT COUNT(*) FROM sessions WHERE gym_id = :gym_id) AS total_sessions,
  (SELECT COUNT(*) FROM sessions WHERE gym_id = :gym_id
     AND started_at >= date_trunc('month', CURRENT_DATE)) AS sessions_this_month,
  (SELECT MAX(started_at) FROM sessions WHERE gym_id = :gym_id) AS last_session_at;
```

#### Agents Page Query

```sql
SELECT
  a.id, a.name, a.serial_number, a.hardware_model, a.status,
  a.last_heartbeat, a.software_version, a.ip_address, a.config,
  g.name AS gym_name, g.id AS gym_id
FROM agents a
LEFT JOIN gyms g ON g.id = a.gym_id
WHERE (:gym_id IS NULL OR a.gym_id = :gym_id)
  AND (:status IS NULL OR a.status = :status)
ORDER BY :sort_column :sort_direction
LIMIT :page_size OFFSET :offset;
```

### 6.2 Drizzle ORM Schema Reference

The following tables from the database schema are used by the SuperAdmin Dashboard. Full schema is defined in `lib/db/schema.ts`.

```typescript
// Relevant tables for SuperAdmin module
import {
  gyms,
  users,
  gymMemberships,
  athletes,
  sessions,
  agents,
  hrBands,
} from "@/lib/db/schema";
```

### 6.3 Type Definitions

```typescript
// types/superadmin.ts

export interface GymListItem {
  id: string;
  name: string;
  slug: string;
  subscriptionStatus: "active" | "suspended" | "cancelled";
  subscriptionPlan: "starter" | "pro" | "enterprise";
  athleteCount: number;
  ownerName: string | null;
  ownerEmail: string | null;
  lastSessionAt: Date | null;
  agentStatus: "connected" | "disconnected" | null;
  agentLastHeartbeat: Date | null;
  createdAt: Date;
}

export interface GymDetail {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  language: string;
  clerkOrgId: string;
  tvAccessToken: string;
  subscriptionStatus: "active" | "suspended" | "cancelled";
  subscriptionPlan: "starter" | "pro" | "enterprise";
  maxAthletes: number;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GymFormData {
  name: string;
  slug: string;
  address?: string;
  phone?: string;
  timezone: string;
  language: "es" | "pt";
  subscriptionPlan: "starter" | "pro" | "enterprise";
  maxAthletes: number;
  ownerEmail: string;
  ownerName: string;
  primaryColor: string;
  secondaryColor: string;
}

export interface GymUpdateData {
  name?: string;
  address?: string;
  phone?: string;
  timezone?: string;
  language?: string;
  subscriptionStatus?: "active" | "suspended" | "cancelled";
  subscriptionPlan?: "starter" | "pro" | "enterprise";
  maxAthletes?: number;
  primaryColor?: string;
  secondaryColor?: string;
}

export interface AgentListItem {
  id: string;
  name: string;
  serialNumber: string;
  hardwareModel: string | null;
  status: "connected" | "disconnected" | "never_connected";
  lastHeartbeat: Date | null;
  softwareVersion: string | null;
  ipAddress: string | null;
  gymId: string | null;
  gymName: string | null;
}

export interface OverviewStats {
  totalGyms: number;
  activeGyms: number;
  totalAthletes: number;
  activeSessions: number;
  sessionsThisMonth: number;
  agentsOnline: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

### 6.4 Validation Schemas

```typescript
// lib/validations/superadmin.ts
import { z } from "zod";

export const createGymSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  address: z.string().max(500).optional(),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, "Must be E.164 format")
    .optional()
    .or(z.literal("")),
  timezone: z.string().min(1),
  language: z.enum(["es", "pt"]),
  subscriptionPlan: z.enum(["starter", "pro", "enterprise"]),
  maxAthletes: z.number().int().min(1).max(100),
  ownerEmail: z.string().email(),
  ownerName: z.string().min(2).max(100),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#6366F1"),
  secondaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#818CF8"),
});

export const updateGymSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  address: z.string().max(500).optional(),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/)
    .optional()
    .or(z.literal("")),
  timezone: z.string().min(1).optional(),
  language: z.enum(["es", "pt"]).optional(),
  subscriptionStatus: z.enum(["active", "suspended", "cancelled"]).optional(),
  subscriptionPlan: z.enum(["starter", "pro", "enterprise"]).optional(),
  maxAthletes: z.number().int().min(1).max(100).optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  secondaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

export const reassignOwnerSchema = z.object({
  ownerEmail: z.string().email(),
  ownerName: z.string().min(2).max(100),
});
```

---

## 7. API Endpoints

All endpoints are implemented as Next.js Route Handlers under `app/api/v1/superadmin/`.

### Common Headers

All requests must include Clerk session cookie (automatically handled by Clerk middleware). All responses use `Content-Type: application/json`.

### Common Error Responses

```typescript
// 401 Unauthorized - Not authenticated
{ "error": "Unauthorized" }

// 403 Forbidden - Not a SuperAdmin
{ "error": "Forbidden: SuperAdmin access required" }

// 404 Not Found
{ "error": "Gym not found", "gymId": "..." }

// 422 Unprocessable Entity - Validation error
{ "error": "Validation failed", "details": [{ "field": "name", "message": "..." }] }

// 500 Internal Server Error
{ "error": "Internal server error" }
```

### 7.1 GET /api/v1/superadmin/gyms

**Purpose:** List all gyms with aggregated stats.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number (1-indexed) |
| `pageSize` | number | 25 | Items per page (max 100) |
| `sort` | string | `created_at` | Column to sort by |
| `order` | string | `desc` | Sort direction: `asc` or `desc` |
| `status` | string | - | Filter by subscription_status |
| `plan` | string | - | Filter by subscription_plan |
| `q` | string | - | Search by gym name (ILIKE) |

**Response: 200 OK**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "CrossFit Arena",
      "slug": "crossfit-arena",
      "subscriptionStatus": "active",
      "subscriptionPlan": "pro",
      "athleteCount": 24,
      "ownerName": "Maria Silva",
      "ownerEmail": "maria@crossfitarena.com",
      "lastSessionAt": "2026-02-25T18:30:00Z",
      "agentStatus": "connected",
      "agentLastHeartbeat": "2026-02-26T10:00:30Z",
      "createdAt": "2026-01-15T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "total": 42,
    "totalPages": 2
  }
}
```

**Implementation:**
```typescript
// app/api/v1/superadmin/gyms/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  await requireSuperAdmin();

  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? 25)));
  const sort = searchParams.get("sort") ?? "created_at";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const status = searchParams.get("status");
  const plan = searchParams.get("plan");
  const q = searchParams.get("q");

  // Build and execute Drizzle query (see Section 6.1 for SQL)
  // ...

  return NextResponse.json({ data, pagination });
}
```

### 7.2 POST /api/v1/superadmin/gyms

**Purpose:** Create a new gym tenant.

**Request Body:**
```json
{
  "name": "CrossFit Arena",
  "slug": "crossfit-arena",
  "address": "Av. Paulista 1000, Sao Paulo",
  "phone": "+5511999999999",
  "timezone": "America/Sao_Paulo",
  "language": "pt",
  "subscriptionPlan": "pro",
  "maxAthletes": 30,
  "ownerEmail": "maria@crossfitarena.com",
  "ownerName": "Maria Silva",
  "primaryColor": "#6366F1",
  "secondaryColor": "#818CF8"
}
```

**Response: 201 Created**
```json
{
  "data": {
    "id": "uuid",
    "name": "CrossFit Arena",
    "slug": "crossfit-arena",
    "clerkOrgId": "org_...",
    "tvAccessToken": "uuid-token",
    "subscriptionStatus": "active",
    "subscriptionPlan": "pro",
    "maxAthletes": 30,
    "ownerInvitationStatus": "pending",
    "createdAt": "2026-02-26T10:00:00Z"
  }
}
```

**Server-Side Flow:**
```typescript
export async function POST(request: NextRequest) {
  await requireSuperAdmin();

  const body = await request.json();
  const validated = createGymSchema.parse(body);

  // 1. Check slug uniqueness
  const existing = await db.select().from(gyms).where(eq(gyms.slug, validated.slug)).limit(1);
  if (existing.length > 0) {
    return NextResponse.json(
      { error: "Validation failed", details: [{ field: "slug", message: "Slug already in use" }] },
      { status: 422 }
    );
  }

  // 2. Create Clerk Organization
  const clerkOrg = await clerkClient.organizations.createOrganization({
    name: validated.name,
  });

  // 3. Insert gym into database
  const tvAccessToken = crypto.randomUUID();
  const [gym] = await db.insert(gyms).values({
    id: crypto.randomUUID(),
    name: validated.name,
    slug: validated.slug,
    address: validated.address ?? null,
    phone: validated.phone ?? null,
    timezone: validated.timezone,
    language: validated.language,
    clerkOrgId: clerkOrg.id,
    tvAccessToken,
    subscriptionStatus: "active",
    subscriptionPlan: validated.subscriptionPlan,
    maxAthletes: validated.maxAthletes,
    primaryColor: validated.primaryColor,
    secondaryColor: validated.secondaryColor,
  }).returning();

  // 4. Send Clerk invitation to owner
  await clerkClient.organizations.createOrganizationInvitation({
    organizationId: clerkOrg.id,
    emailAddress: validated.ownerEmail,
    role: "org:admin",
    inviterUserId: auth().userId, // SuperAdmin's Clerk user ID
  });

  return NextResponse.json({ data: gym }, { status: 201 });
}
```

### 7.3 PATCH /api/v1/superadmin/gyms/[id]

**Purpose:** Update gym details or subscription status.

**URL Parameters:**
- `id` (string, required): Gym UUID

**Request Body (partial):**
```json
{
  "subscriptionStatus": "suspended",
  "maxAthletes": 50
}
```

**Response: 200 OK**
```json
{
  "data": {
    "id": "uuid",
    "name": "CrossFit Arena",
    "subscriptionStatus": "suspended",
    "maxAthletes": 50,
    "updatedAt": "2026-02-26T12:00:00Z"
  }
}
```

**Side Effects by Status Change (see Section 8 for full rules):**
- `active -> suspended`: Agent connections are maintained but sessions cannot start
- `active -> cancelled`: Agent connections are terminated, TV token is invalidated
- `suspended -> active`: Normal operation resumes
- `cancelled -> active`: New TV token generated, agents must reconnect

### 7.4 GET /api/v1/superadmin/agents

**Purpose:** List all agents (mini PCs) across all gyms with health status.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 25 | Items per page (max 100) |
| `sort` | string | `name` | Column to sort by |
| `order` | string | `asc` | Sort direction |
| `gymId` | string | - | Filter by gym |
| `status` | string | - | Filter by status |

**Response: 200 OK**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Arena-PC-01",
      "serialNumber": "BM-2026-001",
      "hardwareModel": "Intel NUC 13",
      "status": "connected",
      "lastHeartbeat": "2026-02-26T10:00:30Z",
      "softwareVersion": "1.2.0",
      "ipAddress": "192.168.1.100",
      "gymId": "uuid",
      "gymName": "CrossFit Arena"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "total": 8,
    "totalPages": 1
  }
}
```

### 7.5 PATCH /api/v1/superadmin/agents/[id]

**Purpose:** Reassign an agent to a different gym.

**Request Body:**
```json
{
  "gymId": "new-gym-uuid"
}
```

**Response: 200 OK**
```json
{
  "data": {
    "id": "uuid",
    "name": "Arena-PC-01",
    "gymId": "new-gym-uuid",
    "updatedAt": "2026-02-26T12:00:00Z"
  }
}
```

**Side Effects:**
- Agent must reconnect with new gym credentials
- Previous gym's active sessions are not affected (they continue with remaining data)
- Agent secret is regenerated on gym reassignment

---

## 8. Business Rules

### 8.1 Subscription Status Transitions

```
                    +-----------+
                    |  active   |
                    +-----+-----+
                         / \
                        /   \
                       v     v
              +-----------+ +-----------+
              | suspended | | cancelled |
              +-----+-----+ +-----------+
                    |              ^
                    v              |
              +-----------+        |
              |  active   |--------+
              +-----------+
```

**Valid transitions:**
| From | To | Allowed | Notes |
|------|-----|---------|-------|
| `active` | `suspended` | Yes | Temporary hold |
| `active` | `cancelled` | Yes | Permanent termination |
| `suspended` | `active` | Yes | Reactivation |
| `suspended` | `cancelled` | Yes | Final cancellation |
| `cancelled` | `active` | Yes | Reactivation (new TV token generated) |
| `cancelled` | `suspended` | No | Must reactivate first |

### 8.2 Gym Suspension Effects

When a gym's status changes to `suspended`:

1. **TV Dashboard:** Displays a "Gym Suspended" message instead of the live dashboard. The TV WebSocket connection is maintained but only sends the suspension notice.
2. **Agent Communication:** Agents remain connected and continue sending heartbeats, but HR data is **not processed** (dropped at the API level with a `403` response code and `gym_suspended` error).
3. **Sessions:** New sessions cannot be started. Active sessions at the time of suspension are force-ended.
4. **Gym Dashboard:** Owners and trainers see a "Subscription Suspended" banner. All features are read-only (historical data accessible, no new actions).
5. **Athlete Portal:** Athletes can still view historical data but see a notice that the gym is suspended.
6. **Data Retention:** All data is preserved. Nothing is deleted.

### 8.3 Gym Cancellation Effects

When a gym's status changes to `cancelled`:

1. **TV Dashboard:** TV access token is invalidated. Dashboard returns 401.
2. **Agent Communication:** All agent connections are terminated. Agent secrets are invalidated. Agents will fail to reconnect.
3. **Sessions:** All active sessions are force-ended.
4. **Gym Dashboard:** Owners and trainers are locked out. Redirect to a "Subscription Cancelled" page.
5. **Athlete Portal:** Athletes are locked out. Redirect to a "Gym Unavailable" page.
6. **Clerk Organization:** Organization is **not** deleted (data preservation). Members are not removed.
7. **Data Retention:** All data is preserved for 90 days. After 90 days, data may be archived or deleted per data retention policy (not implemented in v1).

### 8.4 Gym Reactivation from Cancelled

When a gym's status changes from `cancelled` to `active`:

1. A new `tv_access_token` is generated (old one remains invalid).
2. New agent secrets must be provisioned (agents need reconfiguration).
3. Clerk Organization members regain access immediately.
4. All historical data becomes accessible again.

### 8.5 Owner Assignment Flow

#### Initial Owner Assignment (Gym Creation)

1. SuperAdmin enters owner email and name in the Create Gym form.
2. System creates the Clerk Organization.
3. System sends a Clerk Organization invitation to the owner's email with role `org:admin`.
4. If the owner email already exists in Clerk, they receive an invitation to join the organization.
5. If the owner email is new to Clerk, they receive a sign-up invitation.
6. Upon accepting, the owner's `gym_memberships` record is activated.

#### Owner Reassignment

1. SuperAdmin clicks "Reassign Owner" on the gym edit page.
2. SuperAdmin enters the new owner's email and name.
3. System confirms the action (destructive for previous owner).
4. System performs:
   a. Sets previous owner's `gym_memberships.is_active = false` and `role` remains `owner` for audit trail.
   b. Revokes previous owner's Clerk Organization membership.
   c. Sends new Clerk Organization invitation with `org:admin` role.
   d. Creates new `gym_memberships` record with `is_active = true`.
5. Previous owner can no longer access the gym dashboard.
6. Previous owner's Clerk user account is **not** deleted (they may be an athlete or owner of another gym).

### 8.6 TV Access Token Rules

- Generated as UUIDv4 on gym creation.
- Can be regenerated by SuperAdmin at any time.
- Regeneration immediately invalidates the previous token.
- Active TV connections using the old token are disconnected within 5 seconds (WebSocket ping/pong check).
- Token is invalidated when gym status changes to `cancelled`.
- Token is regenerated (new value) when gym is reactivated from `cancelled`.

### 8.7 Agent Registration

- Agents are **not** created through the SuperAdmin UI.
- Agents self-register on first connection to `POST /api/agent/status` with their `X-Agent-Id` and `X-Agent-Secret`.
- The SuperAdmin provisions agent credentials out-of-band (manually sets `AGENT_ID`, `AGENT_SECRET`, and `GYM_ID` in the agent's `.env` file during hardware setup).
- The agents table row is created during this initial provisioning step via a database seed script or a future provisioning CLI tool.
- The SuperAdmin UI only displays and reassigns agents.

### 8.8 Max Athletes Enforcement

- When `max_athletes` is changed on a gym, the system does **not** deactivate existing athletes if the count exceeds the new limit.
- Instead, the Gym Dashboard prevents creating new athletes when the active count equals or exceeds `max_athletes`.
- The SuperAdmin can always override by setting a higher value.
- The enforcement happens at the API layer (`POST /api/v1/gym/athletes` checks count before insert).

---

## 9. Server Actions

Server Actions are used for form submissions to leverage Next.js progressive enhancement. They are defined alongside the API route handlers for consistency.

```typescript
// app/(platform)/superadmin/gyms/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createGymAction(formData: GymFormData) {
  await requireSuperAdmin();
  const validated = createGymSchema.parse(formData);
  // ... same logic as POST /api/v1/superadmin/gyms
  revalidatePath("/superadmin/gyms");
  redirect(`/superadmin/gyms/${gym.id}`);
}

export async function updateGymAction(gymId: string, data: GymUpdateData) {
  await requireSuperAdmin();
  const validated = updateGymSchema.parse(data);
  // ... same logic as PATCH /api/v1/superadmin/gyms/[id]
  revalidatePath(`/superadmin/gyms/${gymId}`);
  revalidatePath("/superadmin/gyms");
}

export async function reassignOwnerAction(gymId: string, data: { ownerEmail: string; ownerName: string }) {
  await requireSuperAdmin();
  const validated = reassignOwnerSchema.parse(data);
  // ... owner reassignment logic from Section 8.5
  revalidatePath(`/superadmin/gyms/${gymId}`);
}

export async function regenerateTvTokenAction(gymId: string) {
  await requireSuperAdmin();
  const newToken = crypto.randomUUID();
  await db.update(gyms).set({ tvAccessToken: newToken, updatedAt: new Date() }).where(eq(gyms.id, gymId));
  revalidatePath(`/superadmin/gyms/${gymId}`);
  return { token: newToken };
}
```

---

## 10. Error Handling

### Client-Side

- Form validation errors are displayed inline per field using React Hook Form + Zod.
- Server Action errors are caught and displayed as toast notifications using a toast component.
- Network errors show a generic "Something went wrong" toast with a retry option.

### Server-Side

- All API endpoints wrap logic in try/catch.
- Clerk API errors are caught and mapped to user-friendly messages.
- Database constraint violations (e.g., duplicate slug) return 422 with specific field errors.
- Unexpected errors return 500 and are logged with full stack trace.

### Error Logging

```typescript
// lib/utils/logger.ts
export function logError(context: string, error: unknown, metadata?: Record<string, unknown>) {
  console.error(`[${context}]`, {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...metadata,
    timestamp: new Date().toISOString(),
  });
}
```

---

## 11. Testing Requirements

### Unit Tests

- Validation schemas (Zod): test all valid and invalid inputs for `createGymSchema`, `updateGymSchema`, `reassignOwnerSchema`.
- Business rules: test subscription status transitions (valid and invalid).
- Guard function: test `requireSuperAdmin()` with valid SuperAdmin, non-SuperAdmin, and unauthenticated users.

### Integration Tests

- API endpoints: test each endpoint with mocked Clerk and database.
- Gym creation flow: verify Clerk Organization creation, database insert, and invitation sent.
- Subscription status changes: verify side effects (token invalidation, session force-end).

### Test Commands

```bash
bun run test                  # Run all tests
bun run test -- --watch       # Watch mode
bun run lint                  # Run ESLint
```

---

## 12. File Structure Summary

```
app/
  (platform)/
    superadmin/
      layout.tsx
      page.tsx                          # Overview
      gyms/
        page.tsx                        # Gym List
        actions.ts                      # Server Actions
        new/
          page.tsx                      # Create Gym
        [id]/
          page.tsx                      # Edit Gym
      agents/
        page.tsx                        # Agent Management
  api/
    v1/
      superadmin/
        gyms/
          route.ts                      # GET (list), POST (create)
          [id]/
            route.ts                    # PATCH (update)
        agents/
          route.ts                      # GET (list)
          [id]/
            route.ts                    # PATCH (reassign)

components/
  superadmin/
    layout.tsx                          # SuperAdminLayout
    sidebar.tsx                         # SuperAdminSidebar
    stats-card.tsx                      # StatsCard
    stats-card-grid.tsx                 # StatsCardGrid
    gym-form.tsx                        # GymForm
    subscription-manager.tsx            # SubscriptionManager
    owner-assignment.tsx                # OwnerAssignment
    tv-token-manager.tsx                # TvTokenManager
    agent-status-indicator.tsx          # AgentStatusIndicator
    agent-detail-panel.tsx              # AgentDetailPanel
  ui/
    data-table.tsx                      # DataTable (shared)
    status-badge.tsx                    # StatusBadge (shared)

lib/
  auth/
    guards.ts                           # requireSuperAdmin()
  validations/
    superadmin.ts                       # Zod schemas

types/
  superadmin.ts                         # TypeScript interfaces
```
