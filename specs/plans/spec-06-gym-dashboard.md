# Spec 06 — Gym Dashboard: Plan por Partes

> **Spec file:** [gym_dashboard_spec.md](../gym_dashboard_spec.md)
> **Priority:** 4 (after Spec 05 SuperAdmin Dashboard)
> **Total parts:** 6
> **Estimated tests:** ~93
> **Prerequisite:** Spec 05 should be completed first (shared components)

## Context

BeatMind AI has all backend infrastructure ready: database (Spec 01), auth (Spec 02), REST API with 15+ gym endpoints (Spec 03), security (Spec 04), and WebSocket server (Spec 08). The Gym Dashboard is the primary UI for gym owners and trainers — covering athlete/trainer management, session monitoring (real-time via WebSocket), settings/branding, and session history with charts. This is the largest UI spec in the project.

**Already implemented (DO NOT recreate):**
- All gym API endpoints (profile, athletes, bands, trainers, sessions, active session, end session)
- Auth guards: `requireGymAccess()`, `requireGymOwner()`, API variants
- Validation schemas: athlete, gym, trainer, session, band
- API utilities: response helpers, pagination, validation, error codes
- WebSocket server: TV connections, gym state, auto-session, batch writer
- HR zone calculations with es/pt localization
- Utility functions: downsample, weekly streak, trend

**Out of scope (deferred):**
- Report generation + PDF (Spec 12)
- WhatsApp delivery (Spec 12)
- AI coaching message writing (Spec 10)
- CSV import/export (Phase 2)
- Cloud file storage for logos (Infrastructure)

## Parallelization Graph

```
Part A (Foundation) ─── sequential, lead builds first
         │
    ┌────┼────┬────┬────┐
    v    v    v    v    v
Part B Part C Part D Part E Part F  ← all 5 run in parallel
```

**Recommended grouping for 3 agents:**
- Agent 1: Part B + Part C (dashboard + settings, lighter pages)
- Agent 2: Part D + Part E (athlete CRUD + sessions + charts)
- Agent 3: Part F (live session, real-time WebSocket — most complex)

---

## Part A: Foundation (Layout + Shared Components + Missing API Endpoints)

**Status:** `[ ]`

**Scope:** Install deps, build the shell, shared components, and 3 missing API endpoints.

### New Dependencies

```bash
bun add recharts date-fns date-fns-tz react-colorful react-dropzone
```

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `types/gym-dashboard.ts` | Types | GymDashboardStats, SessionListItem, TrainerListItem, LiveAthleteData |
| `app/(platform)/gym/layout.tsx` | Server Component | `requireGymAccess()` guard, passes gymId + role to sidebar |
| `components/dashboard/gym-sidebar.tsx` | Client Component | Nav links with role-based visibility, active state, active session indicator |
| `components/dashboard/stat-card.tsx` | Server Component | Metric + label + optional trend |
| `components/dashboard/data-table.tsx` | Client Component | Generic sortable/filterable/paginated table. Reuse Spec 05's if exists |
| `components/dashboard/confirm-modal.tsx` | Client Component | Confirmation dialog, destructive variant |
| `components/dashboard/empty-state.tsx` | Server Component | Message + optional CTA button |
| `lib/validations/session-start.ts` | Validation | StartSessionSchema with classType enum |
| `app/api/v1/gym/sessions/[id]/route.ts` | API Route | NEW: GET session detail (athletes + coaching messages) |
| `app/api/v1/gym/trainers/[id]/route.ts` | API Route | NEW: DELETE trainer (Clerk API + deactivate membership) |

### Files to Modify

| File | Change |
|------|--------|
| `app/api/v1/gym/sessions/route.ts` | Add POST handler (start manual session) alongside existing GET |
| `lib/api/errors.ts` | Add SESSION_ALREADY_ACTIVE, TRAINER_NOT_FOUND codes |

### Tests (~27)

- `app/api/v1/gym/sessions/__tests__/route.test.ts` — +6 (POST: success, conflict, validation, auth)
- `app/api/v1/gym/sessions/[id]/__tests__/route.test.ts` — 5 (GET detail with athletes + coaching)
- `app/api/v1/gym/trainers/[id]/__tests__/route.test.ts` — 5 (DELETE: success, not found, auth)
- `components/dashboard/__tests__/stat-card.test.tsx` — 3
- `components/dashboard/__tests__/confirm-modal.test.tsx` — 3
- `components/dashboard/__tests__/empty-state.test.tsx` — 2
- `lib/validations/__tests__/session-start.test.ts` — 3

### Key Decisions

1. POST /sessions: check no active session for gym (409 if exists), insert with status='active', set trainerId if trainer role
2. GET /sessions/[id]: join session_athletes + athletes + ai_coaching_messages, return SessionDetailResponse
3. DELETE /trainers/[id]: find gym_membership by id, verify role=trainer, call Clerk deleteOrganizationMembership, set is_active=false
4. DataTable: if Spec 05 created `components/ui/data-table.tsx`, import from there; otherwise create gym-specific version
5. Layout: server component with `requireGymAccess()`, flex layout with sidebar left + content right

### Reference Patterns

- `app/api/v1/gym/sessions/[id]/end/route.ts` — session-scoped route with `params: Promise<{ id: string }>`
- `app/api/v1/gym/trainers/route.ts` — Clerk API calls pattern
- `app/api/v1/gym/athletes/route.ts` — GET+POST in same route file

---

## Part B: Dashboard Overview + Trainer Management + Reports

**Status:** `[ ]`

**Scope:** Dashboard landing page with stats, trainer list with invite modal, reports placeholder.

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `app/(platform)/gym/page.tsx` | Server Component | Stats cards, active session banner, recent sessions, agent status |
| `lib/queries/gym-overview.ts` | Query | Drizzle queries: today's stats, active session, agent status |
| `app/(platform)/gym/trainers/page.tsx` | Server Component | Trainer list (Owner only), invite button |
| `components/dashboard/invite-trainer-modal.tsx` | Client Component | Email input, calls POST /gym/trainers |
| `app/(platform)/gym/reports/page.tsx` | Server Component | Recent sessions list linking to session detail |

### Tests (~10)

- `lib/queries/__tests__/gym-overview.test.ts` — 4 (stats queries with/without data)
- `components/dashboard/__tests__/invite-trainer-modal.test.tsx` — 3 (form, validation, submit)
- `app/(platform)/gym/__tests__/page.test.tsx` — 3 (stats, active session banner, empty)

### Key Decisions

1. Dashboard overview runs 5 parallel queries via `Promise.all()`: sessions today, athletes trained, active session, agent status, recent 5 sessions
2. Trainer page calls `requireGymOwner()` (not requireGymAccess)
3. Reports page is simple: last 10 completed sessions with links to `/gym/sessions/[id]`. WhatsApp/report generation deferred to Spec 12

### Reference Patterns

- `app/api/v1/gym/sessions/active/route.ts` — active session query
- `app/api/v1/gym/trainers/route.ts` — GET trainer list query

---

## Part C: Settings & Branding (Owner Only)

**Status:** `[ ]`

**Scope:** Gym profile settings, TV token management, branding with color picker and logo upload.

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `app/(platform)/gym/settings/page.tsx` | Server Component | Settings form + TV token. `requireGymOwner()` |
| `components/dashboard/tv-token-manager.tsx` | Client Component | Masked token, copy URL, regenerate with confirm |
| `app/(platform)/gym/branding/page.tsx` | Server Component | Color pickers + file upload + preview. `requireGymOwner()` |
| `components/dashboard/color-picker.tsx` | Client Component | react-colorful wrapper + hex input |
| `components/dashboard/file-upload.tsx` | Client Component | react-dropzone wrapper, PNG/SVG/WEBP, max 2MB, preview |

### Tests (~10)

- `components/dashboard/__tests__/tv-token-manager.test.tsx` — 3 (masked display, copy, regenerate)
- `components/dashboard/__tests__/color-picker.test.tsx` — 2 (renders, text input updates)
- `components/dashboard/__tests__/file-upload.test.tsx` — 3 (dropzone, reject format, reject size)
- `app/(platform)/gym/settings/__tests__/page.test.tsx` — 2 (renders form, submits PATCH)

### Key Decisions

1. Settings: explicit "Save Changes" button, no auto-save. Uses PATCH /gym/profile
2. TV Token: masked by default, "Show" toggle, "Copy TV URL" copies full URL, "Regenerate" with ConfirmModal
3. Branding: split layout — left form (colors + upload) / right preview
4. Logo upload v1: base64 data URL stored in DB logo_url field. Cloud storage deferred

### Reference Patterns

- `app/api/v1/gym/profile/route.ts` — GET/PATCH profile (already exists)
- `lib/validations/gym.ts` — UpdateGymProfileSchema

---

## Part D: Athlete Management (CRUD)

**Status:** `[ ]`

**Scope:** Athlete list, create, edit, band assignment pages.

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `app/(platform)/gym/athletes/page.tsx` | Server Component | DataTable with search, filters, pagination |
| `app/(platform)/gym/athletes/new/page.tsx` | Server Component | Create form |
| `app/(platform)/gym/athletes/[id]/page.tsx` | Server/Client | Edit form + deactivate |
| `components/dashboard/athlete-form.tsx` | Client Component | Shared create/edit form |
| `app/(platform)/gym/athletes/[id]/bands/page.tsx` | Server Component | Band assignment (left: athlete info, right: available bands) |

### Tests (~12)

- `app/(platform)/gym/athletes/__tests__/page.test.tsx` — 3 (table, search, empty state)
- `components/dashboard/__tests__/athlete-form.test.tsx` — 5 (create/edit modes, validation, max HR helper, whatsapp toggle)
- `app/(platform)/gym/athletes/[id]/bands/__tests__/page.test.tsx` — 4 (assign, unassign, reassign confirm, current display)

### Key Decisions

1. AthleteForm: reusable for create and edit. Max HR field has helper "If unknown, use 220 - age" auto-calculating on age change. WhatsApp toggle disabled without phone
2. Deactivation via PATCH with `{ isActive: false }` + ConfirmModal
3. Band assignment: if sensor already assigned to another athlete, show ConfirmModal warning before reassigning

### Reference Patterns

- `app/api/v1/gym/athletes/route.ts` — GET list + POST create
- `app/api/v1/gym/athletes/[id]/route.ts` — GET detail + PATCH update
- `app/api/v1/gym/athletes/[id]/bands/route.ts` — POST assign + DELETE unassign
- `lib/validations/athlete.ts` — CreateAthleteSchema, UpdateAthleteSchema

---

## Part E: Session History & Detail + Charts

**Status:** `[ ]`

**Scope:** Session history, session detail with expandable athlete stats, Recharts chart components.

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `app/(platform)/gym/sessions/page.tsx` | Server Component | Session history with DataTable, date range, filters |
| `app/(platform)/gym/sessions/[id]/page.tsx` | Server Component | Header stats, AI summary, expandable athlete table |
| `components/dashboard/hr-time-chart.tsx` | Client Component | Recharts LineChart: time vs BPM with zone backgrounds |
| `components/dashboard/zone-distribution-chart.tsx` | Client Component | Recharts horizontal BarChart: zone 1-5 with colors |
| `components/dashboard/sparkline-chart.tsx` | Client Component | Minimal Recharts LineChart for inline sparklines |
| `lib/queries/gym-sessions.ts` | Query | getSessionDetail(): session + athletes + coaching messages |

### Tests (~12)

- `app/(platform)/gym/sessions/__tests__/page.test.tsx` — 3 (table, filters, empty)
- `lib/queries/__tests__/gym-sessions.test.ts` — 3 (detail with athletes, coaching messages, not found)
- `components/dashboard/__tests__/hr-time-chart.test.tsx` — 2 (renders, empty state)
- `components/dashboard/__tests__/zone-distribution-chart.test.tsx` — 2 (zone bars, zero times)
- `components/dashboard/__tests__/sparkline-chart.test.tsx` — 2 (data points, empty)

### Key Decisions

1. Session detail fetches via getSessionDetail() query function (not API call from server component)
2. HR chart uses `downsampleHrData()` to cap at 720 points
3. Date formatting uses date-fns-tz `formatInTimeZone()` for gym timezone
4. Zone chart colors from `lib/hr/zones.ts` ZONES constant

### Reference Patterns

- `app/api/v1/gym/sessions/route.ts` — GET list pattern
- `app/api/v1/gym/sessions/[id]/route.ts` (Part A) — GET detail API
- `lib/utils/downsample.ts` — LTTB for chart data
- `lib/hr/zones.ts` — ZONES for colors

---

## Part F: Live Session View (Real-Time WebSocket)

**Status:** `[ ]`

**Scope:** WebSocket hooks, real-time athlete cards, live session page, session controls.

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `hooks/use-websocket.ts` | Hook | WS connection with auto-reconnect (1s → 30s exponential backoff) |
| `hooks/use-session-timer.ts` | Hook | Elapsed time from startedAt, updates every 1s, returns HH:MM:SS |
| `hooks/use-athlete-state.ts` | Hook | Map<sensorId, LiveAthleteData>, processes hr-update/session-start/session-end/coach-message |
| `app/(platform)/gym/sessions/active/page.tsx` | Server Component | Fetches TV token server-side, passes WS URL to client |
| `components/dashboard/live-session-view.tsx` | Client Component | Orchestrator: WS connection, athlete grid, session controls |
| `components/dashboard/athlete-card.tsx` | Client Component | BPM, zone badge, % max HR, sparkline, coaching overlay (8s fade) |
| `components/dashboard/session-timer.tsx` | Client Component | Displays elapsed time via useSessionTimer |
| `components/dashboard/start-session-modal.tsx` | Client Component | Class type selector, calls POST /gym/sessions |

### Tests (~22)

- `hooks/__tests__/use-websocket.test.ts` — 5 (connect, messages, reconnect, backoff, max delay)
- `hooks/__tests__/use-session-timer.test.ts` — 3 (format, updates, stops)
- `hooks/__tests__/use-athlete-state.test.ts` — 4 (hr-update, session-start, coach-message, missing athlete)
- `components/dashboard/__tests__/athlete-card.test.tsx` — 3 (renders, inactive state, coaching overlay)
- `components/dashboard/__tests__/start-session-modal.test.tsx` — 3 (options, submit, error)
- `components/dashboard/__tests__/live-session-view.test.tsx` — 4 (no session, active renders, end session, WS banner)

### Key Decisions

1. useWebSocket: generic hook, not gym-specific. Exponential backoff 1s → 2s → 4s → ... → 30s max. Cleans up on unmount
2. useAthleteState: Map keyed by sensorId. Processes init, hr-update, session-start, session-end, coach-message. Sparkline history max 60 entries
3. Live session page: server fetches tvAccessToken from DB (not profile API), passes WS URL to client. User never sees token
4. AthleteCard: React.memo with custom comparison (BPM, zone, coaching). Responsive grid: 1 col (<640px), 2 cols (tablet), 3-4 cols (desktop)
5. Coaching overlay: 8s auto-clear via setTimeout. Semi-transparent overlay on athlete card
6. WS disconnection banner: yellow bar "Connection lost. Reconnecting..." when isConnected=false

### Reference Patterns

- `lib/ws/types.ts` — TvOutboundMessage types (init, hr-update, session-start, session-end, coach-message)
- `lib/ws/tv-handler.ts` — buildInitMessage shape
- `lib/hr/zones.ts` — ZONES for card colors

---

## Summary

### Test Totals

| Part | Scope | Tests |
|------|-------|------:|
| A | Foundation + 3 APIs | 27 |
| B | Dashboard + Trainers + Reports | 10 |
| C | Settings + Branding | 10 |
| D | Athlete Management | 12 |
| E | Sessions + Charts | 12 |
| F | Live Session (WebSocket) | 22 |
| **Total** | | **93** |

### Execution Plan

1. **Part A** — sequential (lead), ~38 files created/modified
2. **Parts B-F** — 5 parallel agents (or 3 agents with grouping B+C, D+E, F)
3. **Integration** — lead merges, runs full test suite, updates tracking

### INDEX.md Update

After plan creation:
```
| 4 | 06 Gym Dashboard | [ ] | [6 partes](plans/spec-06-gym-dashboard.md) | Main gym UI, needs WS |
```
