# Spec 12 — Reports & WhatsApp: Plan por Partes

> **Spec file:** [reports_whatsapp_spec.md](../../specs/reports_whatsapp_spec.md)
> **Priority:** Covers both Priority 9 (03H) and Priority 10 (12)
> **Total parts:** 4
> **Estimated tests:** ~52
> **Prerequisite:** Spec 01 (DB) [x], Spec 02 (Auth) [x], Spec 03 (API) [x], Spec 10 (AI Coaching) [x]

## Context

BeatMind AI auto-generates post-session reports for athletes with HR stats, zone breakdowns, calories, charts, and AI summaries. Athletes who opt in to WhatsApp receive a Twilio message 2 minutes after session end with a tokenized link to their report.

**What already exists (DO NOT recreate):**

| Item | File | Notes |
|------|------|-------|
| `athletes.gender` column | `lib/db/schema/athletes.ts` | Already in schema (varchar, nullable) |
| `session_athletes.reportToken` | `lib/db/schema/session-athletes.ts` | Already in schema |
| `session_athletes.whatsappSentAt` | `lib/db/schema/session-athletes.ts` | Already in schema |
| `session_athletes.whatsappStatus` | `lib/db/schema/session-athletes.ts` | Already in schema |
| `sessions.aiSummary` | `lib/db/schema/sessions.ts` | Already in schema |
| `SendWhatsAppSchema` | `lib/validations/report.ts` | Already created |
| `callOpenAI()` | `lib/ai/coach.ts` | Reusable for AI summary |
| `generatePostSessionSummary()` | `lib/ai/coach.ts` | Already wired to ws-server.ts onSessionEnd |
| `buildPostSessionSystemPrompt()` | `lib/ai/prompts.ts` | Already created |
| `downsampleHrData()` | `lib/utils/downsample.ts` | For chart rendering (500pt cap) |
| `getZone()` / `getZoneForLang()` | `lib/hr/zones.ts` | Zone constants and computation |
| ZONES / REST_ZONE constants | `lib/hr/zones.ts` | Zone colors, names (es/pt) |
| Middleware public patterns | `middleware.ts` | Need to ADD `/reports` + `/api/v1/reports` |

**What this spec builds:**

- Calorie estimation function (`estimateCalories`)
- Zone time calculation from HR readings (`calculateZoneTimes`)
- JWT report token system (generation + validation)
- Per-athlete stat calculation pipeline
- Report generation orchestrator
- Twilio WhatsApp client + template builder
- 2 API endpoints (03H report endpoints)
- Public report web page with charts (mobile-first, gym-branded)

## Parallelization Graph

```
Part A (Foundation) ─── sequential, lead (~20 tests)
         │
    ┌────┼────┐
    v    v    v
Part B  Part C  Part D  ← 3 parallel agents (isolation: "worktree")
WhatsApp Report   API Routes
+Pipeline Web Page (GET + POST)
```

---

## Part A: Foundation (HR Utilities + Report Infrastructure)

**Status:** `[ ]`

**Scope:** All utility modules that other parts depend on.

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `lib/hr/calories.ts` | Utility | `estimateCalories()` — Keytel primary formula (male/female) + fallback |
| `lib/reports/token.ts` | Utility | `generateReportToken()` + `validateReportToken()` — HMAC-SHA256 JWT, 30-day expiry |
| `lib/reports/stats.ts` | Utility | `calculateAthleteSessionStats()` — from hr_readings: avg/max/min HR, calories, zone times |

### Files to Modify

| File | Change |
|------|--------|
| `lib/hr/zones.ts` | Add `calculateZoneTimes()` function with 30s delta capping |
| `middleware.ts` | Add `/reports` and `/api/v1/reports` to `PUBLIC_PATTERNS` + `isPublicRoute` |

### Tests (~20)

| Test File | Count | Covers |
|-----------|------:|--------|
| `lib/hr/__tests__/calories.test.ts` | 6 | Male formula, female formula, fallback, zero duration, negative guard, rounding |
| `lib/hr/__tests__/zones-times.test.ts` | 4 | Zone time calculation, delta capping at 30s, empty readings, single reading |
| `lib/reports/__tests__/token.test.ts` | 5 | Generate valid token, validate valid, reject expired, reject tampered, reject malformed |
| `lib/reports/__tests__/stats.test.ts` | 5 | Full stat calculation, multiple athletes, no readings, zone time aggregation, calories |

---

## Part B: WhatsApp Integration + Report Pipeline

**Status:** `[ ]`

**Scope:** Twilio WhatsApp client, template builder, and the report generation orchestrator.

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `lib/whatsapp/client.ts` | Service | Twilio wrapper: `sendWhatsAppMessage()` with retry |
| `lib/whatsapp/templates.ts` | Utility | `buildSessionReportTemplate()` — ordered params |
| `lib/reports/generate.ts` | Orchestrator | `generateSessionReport()` — 5-step pipeline |

### Tests (~14)

| Test File | Count | Covers |
|-----------|------:|--------|
| `lib/whatsapp/__tests__/client.test.ts` | 5 | Send success, retry on failure, retry success, both fail, invalid phone |
| `lib/whatsapp/__tests__/templates.test.ts` | 2 | Correct param order, all params stringified |
| `lib/reports/__tests__/generate.test.ts` | 7 | Full pipeline, no readings skip, WhatsApp skips, AI reuse, athlete_count |

---

## Part C: Report Web Page

**Status:** `[ ]`

**Scope:** Public report page with gym branding, stats, and Recharts charts.

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `app/reports/session/[sessionId]/[athleteId]/page.tsx` | Server Component | Token validation, data fetching |
| `app/reports/session/[sessionId]/[athleteId]/ReportView.tsx` | Client Component | Charts + stats + AI summary |
| `components/reports/ZoneDistributionChart.tsx` | Client Component | Recharts horizontal BarChart |
| `components/reports/HrTimelineChart.tsx` | Client Component | Recharts LineChart with zone bands |
| `components/reports/GymHeader.tsx` | Server Component | Logo + gym name + branding |

### Tests (~8)

| Test File | Count | Covers |
|-----------|------:|--------|
| `app/reports/session/[sessionId]/[athleteId]/__tests__/page.test.tsx` | 4 | Valid/invalid/expired/missing token |
| `components/reports/__tests__/ZoneDistributionChart.test.tsx` | 2 | Renders zones, handles zeros |
| `components/reports/__tests__/HrTimelineChart.test.tsx` | 2 | Renders line chart, empty data |

---

## Part D: API Routes (03H Report Endpoints)

**Status:** `[ ]`

**Scope:** Both report API endpoints (deferred from Spec 03).

### Files to Create

| File | Type | Description |
|------|------|-------------|
| `app/api/v1/reports/session/[id]/route.ts` | API Route | GET with dual auth (Clerk OR token) |
| `app/api/v1/reports/session/[id]/send-whatsapp/route.ts` | API Route | POST manual WhatsApp trigger |

### Tests (~12)

| Test File | Count | Covers |
|-----------|------:|--------|
| `app/api/v1/reports/session/[id]/__tests__/route.test.ts` | 7 | GET Clerk/token auth, invalid, 404, filter, hrReadings, 403 |
| `app/api/v1/reports/session/[id]/send-whatsapp/__tests__/route.test.ts` | 5 | POST success, skip, 404, 400, 403 |

---

## Test Summary

| Part | Tests |
|------|------:|
| A | 20 |
| B | 14 |
| C | 8 |
| D | 12 |
| **Total** | **~54** |

## Execution Sequence

```
PHASE 1 — Tracking:      Mark [~] in INDEX.md + TASKS.md
PHASE 2 — Part A:        Foundation (lead, sequential) — ~20 tests
PHASE 3 — Parts B/C/D:   3 parallel agents with isolation: "worktree"
PHASE 4 — Integration:   Lead merges, full test suite, tracking updates
```
