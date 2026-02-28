# Spec 11 — Athlete Portal (Plan)

> **Status:** All 4 parts `[ ]` Pending
> **Depends on:** Spec 01 (DB), Spec 02 (Auth), Spec 03 (API) — all `[x]` COMPLETE
> **Estimated tests:** ~44 new tests

## Critical Discovery: All Backend Already Exists

All 5 API endpoints, auth guards, validation schemas, and utility functions are **implemented and tested** (Spec 03). This is a **pure frontend/UI spec**:

| Already Done | File |
|---|---|
| `requireAthlete()` page guard | `lib/auth/guards.ts` |
| `requireAthleteApi()` API guard | `lib/auth/guards.ts` |
| `GET /api/v1/athlete/profile` | `app/api/v1/athlete/profile/route.ts` |
| `PATCH /api/v1/athlete/profile` | same file |
| `GET /api/v1/athlete/sessions` | `app/api/v1/athlete/sessions/route.ts` |
| `GET /api/v1/athlete/sessions/[id]` | `app/api/v1/athlete/sessions/[id]/route.ts` |
| `GET /api/v1/athlete/progress` | `app/api/v1/athlete/progress/route.ts` |
| `UpdateAthleteProfileSchema` | `lib/validations/athlete.ts` |
| `AthleteProgressQuerySchema` | `lib/validations/athlete.ts` |
| `calculateWeeklyStreak()` | `lib/utils/weekly-streak.ts` |
| `calculateTrend()` | `lib/utils/trend.ts` |
| `downsampleHrData()` | `lib/utils/downsample.ts` |
| HR zones + colors | `lib/hr/zones.ts` |

## Spec-vs-Reality Discrepancies

| # | Area | Spec Says | Actual Code |
|---|------|-----------|-------------|
| 1 | Progress query | Includes zone time distribution per period | Route at `progress/route.ts` does NOT aggregate zone times — only sessionCount, avgHr, totalCalories |
| 2 | Session detail AI messages | Filter by `athlete_summaries ? :athleteId` JSONB | Route at `sessions/[id]/route.ts` returns ALL session messages (no athlete filter) |
| 3 | Session detail | Includes trainerName, gymName | Route doesn't join users/gyms tables for these |
| 4 | `requireAthlete()` | Needs to be created | Already exists in `lib/auth/guards.ts` |
| 5 | `calculateWeeklyStreak()` | Needs to be created | Already exists in `lib/utils/weekly-streak.ts` |
| 6 | LTTB downsampling | Needs to be created | Already exists as `downsampleHrData()` |
| 7 | `athleteProfileSchema` | Needs to be created | `UpdateAthleteProfileSchema` already exists (missing `.refine()` for phone+whatsapp) |

## TASKS.md Items Already Done

These tasks in §11 of TASKS.md are already complete and should be marked `[x]` during execution:
- `requireAthlete()` auth guard
- `calculateWeeklyStreak()` utility
- LTTB downsampling utility
- `athleteProfileSchema` (base version exists, refinement added in client form only)

---

## Execution Strategy

```
Part A (Foundation) ─── sequential, lead builds first
         │
    ┌────┼────┐
    v    v    v
Part B  Part C  Part D  ← 3 parallel agents (independent pages)
```

1. Part A sequentially (lead) — layout, types, shared atoms, format utils, `recharts` install
2. Parts B + C + D in parallel (3 agents with `isolation: "worktree"`)
3. Integration — lead merges, `bun run test`, `bun run lint`, tracking updates

---

## Part A: Foundation (Layout + Types + Format Utils + Shared Atoms)

> **Status:** `[ ]` Pending
> **~14 tests | 9 files created, 1 modified**

**New dependency:** `bun add recharts`

| File | Type | Description |
|------|------|-------------|
| `types/athlete-portal.ts` | Types | DashboardData, SessionListItem, SessionDetailData, ProgressPeriodData, AthleteProfileData |
| `app/(platform)/athlete/layout.tsx` | Server Component | `requireAthlete()` guard, flex layout with sidebar left + content right |
| `components/athlete/sidebar.tsx` | Client Component | Nav: Dashboard, Sessions, Progress, Profile. `usePathname()` active state. Mobile hamburger |
| `components/athlete/stat-card.tsx` | Server Component | icon, value, label, optional trend indicator |
| `components/athlete/empty-state.tsx` | Server Component | icon, title, description, optional CTA link |
| `components/athlete/pagination.tsx` | Server Component | `<Link>` pagination with page numbers, prev/next |
| `components/athlete/weekly-streak-badge.tsx` | Server Component | Flame icon + streak number, gray for zero |
| `lib/utils/format.ts` | Utility | `formatDuration()`, `formatRelativeDate()`, `formatAbsoluteDate()`, `formatZonePercent()` |

### Tests

| Test File | Count |
|-----------|------:|
| `lib/utils/__tests__/format.test.ts` | 5 |
| `components/athlete/__tests__/stat-card.test.tsx` | 2 |
| `components/athlete/__tests__/pagination.test.tsx` | 3 |
| `components/athlete/__tests__/empty-state.test.tsx` | 2 |
| `components/athlete/__tests__/weekly-streak-badge.test.tsx` | 2 |

### Key Decisions

- Self-contained components — no dependency on Spec 05 shared UI (not built yet)
- Each page calls `requireAthlete()` independently (Clerk `auth()` is cached per request)
- No dark mode (deferred)
- Icons: inline SVG or Unicode for v1

---

## Part B: Dashboard + Profile Pages (Parallel Agent 1)

> **Status:** `[ ]` Pending
> **~10 tests | 4 files created**

| File | Type | Description |
|------|------|-------------|
| `app/(platform)/athlete/page.tsx` | Server Component | Dashboard: last session, stats row (total sessions, streak, calories), recent 5 sessions. 3 parallel DB queries via `Promise.all()` |
| `components/athlete/session-card.tsx` | Server Component | Prominent last session card. Links to session detail. Null = empty state |
| `app/(platform)/athlete/profile/page.tsx` | Server Component | Fetches athlete profile, passes to ProfileForm |
| `components/athlete/profile-form.tsx` | Client Component | React controlled form. Submit calls `PATCH /api/v1/athlete/profile`. Max HR helper (220-age). WhatsApp toggle disabled without phone. Form-level `.refine()` for phone+whatsapp validation |

### Tests

| Test File | Count |
|-----------|------:|
| `components/athlete/__tests__/session-card.test.tsx` | 3 |
| `components/athlete/__tests__/profile-form.test.tsx` | 5 |
| `app/(platform)/athlete/__tests__/page.test.tsx` | 2 |

### Key Decisions

- Dashboard uses inline Drizzle queries (same pattern as API routes, not calling API via fetch)
- Profile form calls existing PATCH API endpoint (no server actions)
- Client-side schema extends `UpdateAthleteProfileSchema` with `.refine()` for phone+whatsapp

### Existing Code to Reuse

- `requireAthlete()` from `lib/auth/guards.ts`
- `calculateWeeklyStreak()` from `lib/utils/weekly-streak.ts`
- `UpdateAthleteProfileSchema` from `lib/validations/athlete.ts`
- DB schema tables from `lib/db/schema.ts`

---

## Part C: Session History + Session Detail (Parallel Agent 2)

> **Status:** `[ ]` Pending
> **~12 tests | 7 files created**

| File | Type | Description |
|------|------|-------------|
| `app/(platform)/athlete/sessions/page.tsx` | Server Component | Paginated session list. URL-driven pagination (`?page=2`). Joins sessions + session_athletes + users (trainer) |
| `components/athlete/session-list.tsx` | Server Component | Table (desktop) / card list (mobile). Uses Pagination |
| `components/athlete/session-list-item.tsx` | Server Component | Row: date, class type badge, duration, avg HR, max HR, calories, "View Details" link |
| `app/(platform)/athlete/sessions/[id]/page.tsx` | Server Component | Session detail. Verifies participation. HR readings (downsampled). AI messages (filtered by athlete JSONB). Stats cards + charts |
| `components/athlete/hr-line-chart.tsx` | Client Component | Recharts LineChart. X: elapsed time (mm:ss). Y: BPM. Zone reference lines. Tooltip |
| `components/athlete/zone-bar-chart.tsx` | Client Component | Recharts horizontal BarChart. 5 bars (zone 1-5). Zone colors from `lib/hr/zones.ts`. Labels: zone name + duration + percentage |
| `components/athlete/ai-message-list.tsx` | Server Component | Chronological AI messages. Relative timestamps. Chat bubble styling. Empty state |

### Tests

| Test File | Count |
|-----------|------:|
| `components/athlete/__tests__/session-list-item.test.tsx` | 3 |
| `components/athlete/__tests__/hr-line-chart.test.tsx` | 3 |
| `components/athlete/__tests__/zone-bar-chart.test.tsx` | 3 |
| `components/athlete/__tests__/ai-message-list.test.tsx` | 3 |

### Key Decisions

- Session detail page adds JSONB `?` operator filter for AI messages (unlike existing API route which returns all)
- HR data downsampled via `downsampleHrData()` (max 720 points)
- Zone bar chart uses zone colors from `ZONES` constant in `lib/hr/zones.ts`
- Recharts requires `"use client"` — all chart components are client components

### Gotchas

- `params` and `searchParams` are Promises in Next.js 16 — must await before use
- JSONB `?` operator in Drizzle needs raw SQL: `` sql`${aiCoachingMessages.athleteSummaries}::jsonb ? ${athleteId}` ``
- `afterEach(cleanup)` required in all component tests

### Existing Code to Reuse

- `requireAthlete()` from `lib/auth/guards.ts`
- `downsampleHrData()` from `lib/utils/downsample.ts`
- `paginationMeta()` / `paginationOffsetLimit()` from pagination utils
- `ZONES` from `lib/hr/zones.ts`

---

## Part D: Progress Page (Parallel Agent 3)

> **Status:** `[ ]` Pending
> **~8 tests | 4 files created**

| File | Type | Description |
|------|------|-------------|
| `app/(platform)/athlete/progress/page.tsx` | Server Component | Progress trends. URL-driven period toggle (`?period=weekly`). Extended Drizzle aggregation with zone time SUMs. EmptyState if < 2 data points |
| `components/athlete/period-toggle.tsx` | Client Component | "Weekly" / "Monthly" toggle buttons. Uses `<Link>` with search params |
| `components/athlete/progress-chart.tsx` | Client Component | 3 vertically stacked Recharts charts: (1) sessions count BarChart, (2) avg HR LineChart, (3) calories BarChart |
| `components/athlete/zone-evolution-chart.tsx` | Client Component | Recharts StackedBarChart. 5 segments per bar (zone 1-5). Y: 0-100%. Zone colors |

### Tests

| Test File | Count |
|-----------|------:|
| `components/athlete/__tests__/period-toggle.test.tsx` | 3 |
| `components/athlete/__tests__/progress-chart.test.tsx` | 3 |
| `components/athlete/__tests__/zone-evolution-chart.test.tsx` | 2 |

### Key Decisions

- Progress query EXTENDS the existing API route query by adding `SUM(sa.time_zone_1_s)` through `SUM(sa.time_zone_5_s)` for zone distribution
- If all zone times are 0 (known issue — zone times not populated yet), show informational note instead of empty chart
- Zone percentages computed in application code: `zonePct = (zoneSeconds / totalZoneSeconds) * 100`
- `searchParams` must be awaited (Next.js 16)

### Existing Code to Reuse

- `requireAthlete()` from `lib/auth/guards.ts`
- `calculateTrend()` from `lib/utils/trend.ts`
- `ZONES` from `lib/hr/zones.ts`

---

## Summary

| Part | Scope | Files | Tests |
|------|-------|-------|------:|
| A | Foundation | 9 created, 1 modified | ~14 |
| B | Dashboard + Profile | 4 created | ~10 |
| C | Sessions (list + detail) | 7 created | ~12 |
| D | Progress | 4 created | ~8 |
| **Total** | | **24 created, 1 modified** | **~44** |

Current test count: **834** → Expected after Spec 11: **~878**

---

## Anticipated Gotchas

1. `app/(platform)/` and `components/` directories don't exist yet — must be created
2. Next.js 16 async `params`/`searchParams` — must await before accessing
3. Recharts requires `"use client"` — all chart components are client components
4. `@testing-library/react` auto-cleanup not working — explicit `afterEach(cleanup)` required
5. Zone times in `session_athletes` are 0 — zone evolution chart may show empty data
6. `hrMaxPercent` is decimal column — Drizzle returns string, cast with `Number()`
7. `vi.mock()` hoisting — use `vi.hoisted()` for mock variables
