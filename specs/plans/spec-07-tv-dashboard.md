# Spec 07 — TV Dashboard Plan

> **Spec file:** [tv_dashboard_spec.md](../tv_dashboard_spec.md)
> **Priority:** 6 (after Specs 05, 06, 09)
> **Total parts:** 4
> **Estimated tests:** ~55-65
> **Prerequisite:** Spec 08 WebSocket Server [x] COMPLETE

---

## CRITICAL: Spec-vs-Reality Discrepancies

The spec was written BEFORE the WS server (Spec 08) was implemented. This plan uses the **ACTUAL** server contracts from `lib/ws/types.ts`. Key differences:

| # | Area | Spec Says | Actual Server (`lib/ws/types.ts`) |
|---|------|-----------|-----------------------------------|
| 1 | Init message | Not described | Server sends `{ type: "init", gym: {...}, athletes: EnrichedDeviceData[], session: ActiveSession \| null }` |
| 2 | HR update format | `devices: Record<string, AthleteData>` (dict) | `{ type: "hr-update", athletes: EnrichedDeviceData[], timestamp }` (array) |
| 3 | HR update `history` | Server provides 60-point `history[]` array | **NOT in payload** — TV must accumulate sparkline locally |
| 4 | HR update `maxHr` | Included per athlete | **NOT in `EnrichedDeviceData`** — only `hrMaxPercent` is sent |
| 5 | Coaching msg type | `"ai-coaching"` with `analysis`, `athletes[]` array, `messageId` | `"coach-message"` with `message`, optional `athleteId`, optional `athleteName` |
| 6 | Session events | Single `"session-event"` type with `event: "started" \| "ended"` | Two separate types: `"session-start"` and `"session-end"` |
| 7 | Session start | Has `trainerName` field | **NO `trainerName`** — only `sessionId`, `classType`, `startedAt` |
| 8 | Session end | Has `endedAt`, `duration` fields | Only `sessionId`, `durationSeconds` (no `endedAt`) |
| 9 | `EnrichedDeviceData.sensorId` | `string` in spec types | `number` in actual types |
| 10 | Coach targeting | Multi-athlete array targeting | Single `athleteId?` + `athleteName?` (optional, one athlete or all) |

**Impact on implementation:**
- `types/tv.ts` must import from `lib/ws/types.ts` where possible, NOT reinvent
- `useAthleteState` must maintain a local 60-entry sparkline history per sensor
- Coach overlay targeting simplified: single athlete or broadcast to all
- Session timer uses separate `session-start`/`session-end` messages

---

## What Already Exists (DO NOT recreate)

| Item | File | Status |
|------|------|--------|
| Middleware `/tv` exclusion | `middleware.ts` | ✅ `/tv` in PUBLIC_PATTERNS |
| DB `tvAccessToken` field | `lib/db/schema/gyms.ts` | ✅ UUID with `gen_random_uuid()` default |
| TV token auth | `lib/auth/tv-auth.ts` | ✅ `verifyTvToken()`, `regenerateTvToken()` with tests |
| WS TV handler | `lib/ws/tv-handler.ts` | ✅ `buildInitMessage()`, `setupTvPing()` with tests |
| WS message types | `lib/ws/types.ts` | ✅ All `TvOutboundMessage` types defined |
| HR zone calculation | `lib/hr/zones.ts` | ✅ `getZoneForLang()` with es/pt |
| Next.js headers | `next.config.ts` | ✅ `X-Frame-Options: SAMEORIGIN` for `/tv/:path*` |
| Drizzle DB client | `lib/db/index.ts` | ✅ |
| Gyms schema | `lib/db/schema/gyms.ts` | ✅ All fields needed for GymConfig |

---

## Out of Scope

- Leaderboard mode (P2, Phase 5)
- Report/WhatsApp integration (Spec 12)
- AI coaching message generation (Spec 10 — TV only DISPLAYS messages)
- CSV export
- Accessibility (deferred)

---

## Parallelization Graph

```
Part A (Foundation) ─── sequential, lead
         │
Part B (Hooks) ─── sequential, lead (hooks needed by all components)
         │
    ┌────┴────┐
    v         v
Part C     Part D    ← 2 parallel agents
Card+Grid  Orchestrator+Overlays+Integration
```

**Optimal execution:**
1. Part A sequentially (lead) — route setup, types, error screen
2. Part B sequentially (lead) — all 4 hooks with full tests
3. Parts C + D in parallel (2 agents with `isolation: "worktree"`)
4. Integration — lead merges, full test suite, tracking

---

## Part A: Foundation (Route + Types + Error Screen)

**Status:** `[ ]`

**Scope:** Server-side route with token validation, TypeScript types (corrected for actual protocol), error screen component.

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `types/tv.ts` | Types | `TvGymConfig`, `TvAthleteData`, `TvCoachMessage`, `TvWebSocketMessage` — aligned with actual `lib/ws/types.ts` |
| `app/tv/[gymId]/layout.tsx` | Server Component | Minimal: no Clerk, full viewport, `bg-slate-900 text-slate-200`, `noindex/nofollow` |
| `app/tv/[gymId]/page.tsx` | Server Component | Token validation via `verifyTvToken()`, fetches gym config, renders `TVDashboard` or `TVErrorScreen` |
| `app/tv/[gymId]/loading.tsx` | Server Component | Skeleton loading state |
| `components/tv/TVErrorScreen.tsx` | Server Component | Invalid token / access denied static page |

### Key Decisions

1. **types/tv.ts** re-exports `EnrichedDeviceData` from `lib/ws/types.ts` for the athlete data shape (same type server sends). Adds client-only extensions like `history: number[]` for sparkline.
2. **page.tsx** validates both `gymId` and `token` as UUID format before DB query. Uses `verifyTvToken()` from `lib/auth/tv-auth.ts`, then separately fetches gym config (name, logo, colors, language) for props.
3. **WS URL** constructed from `NEXT_PUBLIC_WS_URL` env var, passed as prop to client component.
4. **No Clerk imports** anywhere in `app/tv/` tree.

### Existing Code to Reuse

- `lib/auth/tv-auth.ts` → `verifyTvToken(gymId, token)`
- `lib/db/index.ts` → `db` (Drizzle client)
- `lib/db/schema/gyms.ts` → `gyms` table
- `lib/validations/common.ts` → UUID validation pattern

### Tests (~8)

- `app/tv/[gymId]/__tests__/page.test.tsx` — 5 tests: valid token renders dashboard, invalid token shows error, missing token shows error, invalid UUID format, gym not found
- `components/tv/__tests__/TVErrorScreen.test.tsx` — 3 tests: renders message, renders lock icon, no WS connection attempted

---

## Part B: Hooks (WebSocket + AthleteState + SessionTimer + GridLayout)

**Status:** `[ ]`

**Scope:** All 4 custom React hooks with full test coverage. These are the core logic layer.

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `components/tv/hooks/useWebSocket.ts` | Hook | WS connection with exponential backoff reconnect (1s → 30s) |
| `components/tv/hooks/useAthleteState.ts` | Hook | Map-based athlete state, sparkline accumulation, session lifecycle |
| `components/tv/hooks/useSessionTimer.ts` | Hook | `HH:MM:SS` elapsed time from `startedAt`, 1s interval |
| `components/tv/hooks/useGridLayout.ts` | Hook | Pure function: athlete count → `{ cols, rows, bpmFontSize }` |

### Key Decisions

1. **useWebSocket**: Generic hook. `url` prop. Returns `{ connected, reconnectAttempt, reconnectDelay }`. Calls `onMessage(data: TvOutboundMessage)` callback. Exponential backoff: `Math.min(1000 * 2^attempt, 30000)`. Cleanup on unmount (close WS + clear timeout). Does NOT parse messages — raw JSON → typed object.

2. **useAthleteState**: Processes all 5 message types from `TvOutboundMessage`:
   - `init` → set gym config, populate athletes Map, set session
   - `hr-update` → update athletes Map, **append bpm to local `history[]` per sensor** (cap at 60), derive sorted array only on count change
   - `session-start` → set sessionId + startedAt, clear stale data, reset coach banner flag
   - `session-end` → clear sessionId, optionally clear athletes after delay
   - `coach-message` → set coachMessage on targeted athlete card(s) or all cards

3. **useSessionTimer**: Takes `startedAt: string | null`. Returns `"HH:MM:SS"` or `"--:--:--"`. Uses `setInterval(1000)` internally. Cleans up on unmount or when `startedAt` becomes null.

4. **useGridLayout**: Pure calculation function (not a hook, but exported as utility). Input: `athleteCount: number`. Output: `{ cols, rows, bpmFontSize }`. Breakpoints per spec Section 7.

### Existing Code to Reuse

- `lib/ws/types.ts` → `TvOutboundMessage`, `EnrichedDeviceData`, `TvInitMessage`, etc.

### Tests (~20)

- `components/tv/hooks/__tests__/useWebSocket.test.ts` — 7: connect, onMessage callback, reconnect on close, exponential backoff, max delay 30s, cleanup on unmount, reset attempts on reconnect
- `components/tv/hooks/__tests__/useAthleteState.test.ts` — 6: init message populates state, hr-update updates athletes, sparkline accumulates (cap 60), session-start resets, session-end clears, coach-message sets overlay
- `components/tv/hooks/__tests__/useSessionTimer.test.ts` — 4: returns formatted time, updates every second, returns placeholder when null, cleans up interval
- `components/tv/hooks/__tests__/useGridLayout.test.ts` — 3: correct layout for 1/4/9/16/20 athletes, BPM font scaling, edge cases (0, 21)

---

## Part C: Card + Grid + Sparkline Components

**Status:** `[ ]`

**Scope:** AthleteCard, Sparkline canvas, AthleteGrid, and related visual components.

**Execution:** Parallel agent (after Part B completes).

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `components/tv/AthleteCard.tsx` | Client Component | BPM, zone bar, zone badge, % max HR, signal dot, sparkline. `React.memo` with custom comparison. 3 states: active/inactive/empty. |
| `components/tv/Sparkline.tsx` | Client Component | `<canvas>` 60-point rolling sparkline. Zone-colored line + gradient fill. `devicePixelRatio` support. |
| `components/tv/AthleteGrid.tsx` | Client Component | CSS Grid container. Uses `useGridLayout` for dimensions. Smooth transitions (0.3s). |

### Key Decisions

1. **AthleteCard** wrapped in `React.memo` comparing `bpm`, `zone`, `active`, `history.length`. Props extend `EnrichedDeviceData` + `history: number[]` + `coachMessage: TvCoachMessage | null` + `bpmFontSize: string`.
2. **Sparkline** draws on `<canvas>` via `useRef` + `useEffect`. Y-axis: `min-5` to `max+5`. Line color = zone color. Gradient fill 25% → 3% opacity. Renders at native pixel density.
3. **AthleteGrid** renders only connected athletes (no pre-rendered empty slots). Grid template uses inline `style` for dynamic cols/rows.
4. **BPM pulse animation**: CSS keyframe triggered via class toggle on bpm change.

### Reference Patterns

- `lib/hr/zones.ts` → ZONES for zone colors (import `REST_ZONE`, `ZONES`)
- burnapp `drawSparkline()` → port canvas logic to Sparkline.tsx

### Tests (~12)

- `components/tv/__tests__/AthleteCard.test.tsx` — 5: active state renders BPM+zone, inactive state shows "--", empty slot shows placeholder, memo skips re-render on same data, BPM font size applied
- `components/tv/__tests__/Sparkline.test.tsx` — 3: renders canvas, handles empty data, handles single data point
- `components/tv/__tests__/AthleteGrid.test.tsx` — 4: renders correct number of cards, applies grid dimensions, smooth transition class present, handles 0 athletes

---

## Part D: Orchestrator + Header + Overlays + Integration

**Status:** `[ ]`

**Scope:** TVDashboard orchestrator, TVHeader, ConnectionOverlay, CoachOverlay, CoachActivationBanner, and integration wiring.

**Execution:** Parallel agent (after Part B completes).

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `components/tv/TVDashboard.tsx` | Client Component | Orchestrator: connects hooks → components. Sets CSS custom properties for branding. |
| `components/tv/TVHeader.tsx` | Client Component | Logo, gym name, clock (live), session timer, connection status indicator (green/red/yellow dot) |
| `components/tv/ConnectionOverlay.tsx` | Client Component | Full-screen overlay on disconnect. Countdown timer. z-index 200. |
| `components/tv/CoachOverlay.tsx` | Client Component | Per-card overlay (8s animation). Progress bar. absolute inset-0 within card. |
| `components/tv/CoachActivationBanner.tsx` | Client Component | Full-screen "COACH AI ACTIVADO" banner (4.5s). Triggered once per session on first coach message. z-index 150. |

### Key Decisions

1. **TVDashboard** receives `gymConfig` as prop from server. Instantiates `useWebSocket(url)`, pipes messages to `useAthleteState`. Renders header, grid (or idle state), overlays.
2. **TVHeader** uses `useSessionTimer`. Clock via local `Date` + `setInterval(1000)`. Connection status from `useWebSocket.connected`.
3. **ConnectionOverlay** appears on `connected === false`. Shows reconnect countdown (`reconnectDelay / 1000`). Background `rgba(15, 23, 42, 0.92)`.
4. **CoachOverlay** auto-removes after 8s via `setTimeout` ref. Progress bar fills 0→100% over 7s. Styled with absolute positioning within card context.
5. **CoachActivationBanner** tracked via `useRef<boolean>(false)`. Set to `true` on first `coach-message` in session. Reset on `session-start`.
6. **Branding**: CSS custom properties `--brand-primary` and `--brand-secondary` set on root div. Used by header. Zone colors NEVER overridden.
7. **Idle states**: "Waiting for session" (connected, no session), "No athletes connected" (session active, empty athletes), both rendered by TVDashboard based on state.

### Reference Patterns

- `lib/ws/types.ts` → `TvCoachMessage` for overlay data
- burnapp `showCoachInCard()` → port 8s animation timing
- burnapp `showCoachActivation()` → port 4.5s banner timing
- burnapp `#noConnectionOverlay` → port overlay UX

### Tests (~15)

- `components/tv/__tests__/TVDashboard.test.tsx` — 4: renders header+grid when connected with session, shows idle when no session, shows connection overlay when disconnected, applies branding CSS vars
- `components/tv/__tests__/TVHeader.test.tsx` — 4: shows gym name+logo, shows clock, shows session timer, shows connection status indicator
- `components/tv/__tests__/ConnectionOverlay.test.tsx` — 3: shows on disconnect, displays countdown, hides on reconnect
- `components/tv/__tests__/CoachOverlay.test.tsx` — 2: renders message text + progress bar, auto-removes after 8s
- `components/tv/__tests__/CoachActivationBanner.test.tsx` — 2: shows on first coach message, does not show on subsequent messages in same session

---

## Test Summary

| Part | Scope | Tests |
|------|-------|------:|
| A | Foundation (route, types, error screen) | 8 |
| B | Hooks (WS, athletes, timer, grid) | 20 |
| C | Card + Grid + Sparkline | 12 |
| D | Orchestrator + Header + Overlays | 15 |
| **Total** | | **~55** |

---

## Execution Sequence

```
PHASE 1 — Tracking:     Mark [~] in INDEX.md + TASKS.md
PHASE 2 — Part A:       Foundation (lead, sequential) — ~8 tests
PHASE 3 — Part B:       Hooks (lead, sequential) — ~20 tests
PHASE 4 — Parts C+D:    2 parallel agents (isolation: "worktree")
PHASE 5 — Integration:  Lead merges, full test suite, tracking updates
```

---

## Anticipated Gotchas

1. **No `history` in WS messages** — must accumulate sparkline data client-side (Map per sensorId, cap 60 entries, shift old entries)
2. **`sensorId` is `number` not `string`** — Map key must be `number` in useAthleteState
3. **`vi.useFakeTimers()` + setInterval in hooks** — use `vi.advanceTimersByTimeAsync()` not `vi.runAllTimersAsync()`
4. **Canvas testing** — cannot visually test canvas draws; test that canvas ref is assigned and useEffect fires. Use `jest-canvas-mock` or mock `getContext('2d')`
5. **`@testing-library/react` auto-cleanup** — need explicit `afterEach(cleanup)` per known project gotcha
6. **WebSocket mock** — need to mock global `WebSocket` class for hook tests (not `ws` package — that's server-side)
7. **CSS custom properties** — Tailwind arbitrary values `bg-[var(--brand-primary)]` work in production but may not be testable via testing-library; test via inline `style` assertion
8. **Language normalization** — gym.language is "pt-BR" but server already normalizes in `getZoneForLang()` before sending to TV. TV receives already-localized zone names. No normalization needed client-side.
