# Spec 05 — SuperAdmin Dashboard: Plan por Partes

> **Spec file:** [superadmin_dashboard_spec.md](../superadmin_dashboard_spec.md)
> **Priority:** 1 (top of queue)
> **Total parts:** 5
> **Estimated tests:** ~60-80

## Context

**What already exists:**
- Backend API endpoints (Spec 03): GET/POST gyms, PATCH gyms/[id], GET agents — all functional with tests
- Auth guards: `requireSuperAdmin()` (page redirect), `requireSuperAdminApi()` (JSON 401/403)
- Validation schemas: `lib/validations/superadmin.ts` has `ListGymsQuerySchema` and `ListAgentsQuerySchema`
- Pagination utilities: `lib/api/pagination.ts`
- Common validations: `lib/validations/common.ts` (UUID, email, phone patterns)

**What this spec builds:**
- First UI spec — no shared UI components exist yet (DataTable, StatusBadge created here)
- SuperAdmin layout shell + sidebar navigation
- 4 pages: Overview, Gym List, Gym Create/Edit, Agent Management
- Server Actions for gym CRUD operations

**Out of scope:**
- Gym Dashboard UI (Spec 06)
- Athlete Portal UI (Spec 11)
- TV Dashboard UI (Spec 07)

## Parallelization Graph

```
Part A (Foundation) ─── sequential, build first
         │
    ┌────┼────┐
    ▼    ▼    ▼
Part B  Part C  Part E  ← can run in parallel (independent pages)
              │
              ▼
           Part D       ← depends on Part C (gym list patterns)
```

**Optimal execution:**
1. Part A sequentially (lead)
2. Parts B, C, E in parallel (3 agents)
3. Part D sequentially (depends on C patterns)

---

## Part A: Foundation (Layout + Types + Shared Components)

**Status:** `[ ]`

**Scope:** Build the shell that all pages will use

### Files to create

| File | Type | Description |
|------|------|-------------|
| `types/superadmin.ts` | Types | GymListItem, GymDetail, GymFormData, AgentListItem, OverviewStats, PaginatedResponse\<T\> |
| `lib/validations/superadmin.ts` | Validation (MODIFY — file exists with ListGymsQuerySchema, ListAgentsQuerySchema) | Add createGymSchema, updateGymSchema, reassignOwnerSchema |
| `app/(platform)/superadmin/layout.tsx` | Server Component | `requireSuperAdmin()` guard |
| `components/superadmin/sidebar.tsx` | Client Component | Nav links (Overview, Gyms, Agents), active state, collapsible mobile |
| `components/ui/data-table.tsx` | Client Component | Generic table: pagination, sorting, empty states |
| `components/ui/status-badge.tsx` | Server Component | Status → color mapping |

### Tests

- `lib/validations/__tests__/superadmin.test.ts`
- `components/ui/__tests__/status-badge.test.ts`
- `components/ui/__tests__/data-table.test.ts`

### Existing code to reuse

- `lib/auth/guards.ts` → `requireSuperAdmin()`
- `lib/api/pagination.ts` → pagination utilities
- `lib/validations/common.ts` → UUID, email, phone patterns

### TASKS.md mapping

- Layout & Navigation tasks
- Shared component tasks (DataTable, StatusBadge)

### Dependency

None — this is the foundation

---

## Part B: Overview Page

**Status:** `[ ]`

**Scope:** Dashboard with stats cards and activity feed

### Files to create

| File | Type | Description |
|------|------|-------------|
| `app/(platform)/superadmin/page.tsx` | Server Component | 6 stat queries |
| `components/superadmin/stats-card.tsx` | Server Component | Metric + label + trend |
| `components/superadmin/stats-card-grid.tsx` | Layout | Responsive grid (2→6 cols) |
| `components/superadmin/activity-feed.tsx` | Component | Recent events list (last 10) |
| `lib/queries/superadmin-stats.ts` | Query | Drizzle queries for overview stats |

### Tests

- `components/superadmin/__tests__/stats-card.test.ts`
- `lib/queries/__tests__/superadmin-stats.test.ts`

### TASKS.md mapping

- Overview Page tasks (stats cards, activity feed)

### Dependency

Part A (layout, types)

---

## Part C: Gym List Page

**Status:** `[ ]`

**Scope:** Searchable, sortable, paginated gym table

### Files to create

| File | Type | Description |
|------|------|-------------|
| `app/(platform)/superadmin/gyms/page.tsx` | Server Component | Complex JOIN query |
| `lib/queries/superadmin-gyms.ts` | Query | Gym list query with filters, search, sort, pagination |
| `components/superadmin/gym-list-filters.tsx` | Client Component | Status/plan dropdowns + search input |

### Tests

- `lib/queries/__tests__/superadmin-gyms.test.ts`
- `app/(platform)/superadmin/gyms/__tests__/page.test.ts`

### Existing code to reuse

- `components/ui/data-table.tsx` (from Part A)
- `components/ui/status-badge.tsx` (from Part A)
- `lib/api/pagination.ts` → pagination math

### TASKS.md mapping

- Gym Management: gym list page, filtering, DataTable usage

### Dependency

Part A (DataTable, StatusBadge, types)

---

## Part D: Gym Create/Edit + Server Actions

**Status:** `[ ]`

**Scope:** Full CRUD flow for gyms

### Files to create

| File | Type | Description |
|------|------|-------------|
| `app/(platform)/superadmin/gyms/new/page.tsx` | Page | Create gym page |
| `app/(platform)/superadmin/gyms/[id]/page.tsx` | Page | Edit gym page (4 queries) |
| `app/(platform)/superadmin/gyms/actions.ts` | Server Actions | create, update, reassignOwner, regenerateTvToken |
| `components/superadmin/gym-form.tsx` | Client Component | React Hook Form + Zod, auto-slug, color pickers |
| `components/superadmin/subscription-manager.tsx` | Client Component | Status transitions with confirmation |
| `components/superadmin/owner-assignment.tsx` | Client Component | Current owner display + reassign modal |
| `components/superadmin/tv-token-manager.tsx` | Client Component | Masked token + copy + regenerate |

### Tests

- `app/(platform)/superadmin/gyms/actions.test.ts`
- `components/superadmin/__tests__/gym-form.test.ts`
- `components/superadmin/__tests__/subscription-manager.test.ts`

### Existing code to reuse

- `lib/validations/superadmin.ts` (from Part A)
- Clerk SDK → `clerkClient().organizations.createOrganization()`, `.createOrganizationInvitation()`

### TASKS.md mapping

- Gym Management: create/edit pages, forms, subscription manager, owner assignment, TV token manager
- Server Actions: all 4 actions

### Dependency

Parts A + C (layout, types, schemas, DataTable)

---

## Part E: Agent Management

**Status:** `[ ]`

**Scope:** Hardware inventory and health monitoring

### Files to create

| File | Type | Description |
|------|------|-------------|
| `app/(platform)/superadmin/agents/page.tsx` | Server Component | Agent list query |
| `lib/queries/superadmin-agents.ts` | Query | Agent query with gym JOIN, filters, sort |
| `components/superadmin/agent-status-indicator.tsx` | Component | Colored dot + relative time |
| `components/superadmin/agent-detail-panel.tsx` | Component | Expandable panel: JSON config, heartbeat timeline |
| `components/superadmin/agent-list-filters.tsx` | Client Component | Gym/status dropdowns |

### Tests

- `lib/queries/__tests__/superadmin-agents.test.ts`
- `components/superadmin/__tests__/agent-status-indicator.test.ts`

### Auto-refresh

30-second polling via `useEffect` + `router.refresh()`

### TASKS.md mapping

- Agent Management tasks (list page, status indicator, filtering, auto-refresh, detail panel)

### Dependency

Part A (layout, DataTable, types)
