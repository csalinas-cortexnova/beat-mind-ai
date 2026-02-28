# Spec 04 — Security (Code-Level): Plan por Partes

> **Spec file:** [security_spec.md](../../specs/security_spec.md)
> **Priority:** 2 (second in queue)
> **Total parts:** 4
> **Estimated tests:** ~55-65
> **Status:** COMPLETED (660 total tests, 55 new)

## Context

BeatMind AI handles biometric HR data across multiple gyms. Specs 01-03 built the foundation (DB, auth, API) with 605 tests, but several code-level security features were missing: rate limiting, CORS, error pages, structured logging, and athlete data deletion. This spec addressed those gaps before UI work begins (Spec 05).

**Already implemented (NOT re-done):**
- Auth guards (`lib/auth/guards.ts`) — all roles covered
- Security headers (`next.config.ts`) — CSP, X-Frame, HSTS, etc.
- Tenant isolation (`lib/utils/gym-scope.ts`) — withGymScope enforced
- Input validation (`lib/validations/*.ts`) — Zod schemas on all endpoints
- Agent/TV auth — bcrypt + UUID token
- Error codes (`lib/api/errors.ts`) — includes RATE_LIMITED

**Out of scope (infrastructure, deferred):**
- DB roles/SSL (Spec 04 Infra)
- WebSocket security (Spec 08)
- Server hardening, firewall (pre-deploy)
- Credential rotation (manual procedure, documented in spec)

## Parallelization Graph

```
Part A (Core Utilities)          Part B (CORS + Error Pages)
  rate-limit.ts                    next.config.ts CORS
  logger.ts                        not-found.tsx
  .gitignore                       error.tsx
       │                           global-error.tsx
       │
  ┌────┴────┐
  ▼         ▼
Part C    Part D
Rate Limit  Athlete
Application Deletion
```

---

## Part A: Core Utilities — COMPLETED

**Files created:**
- `lib/api/rate-limit.ts` — In-memory Map rate limiter, functional API, 5 configs, cleanup sweep, `_resetStore()` for tests
- `lib/api/__tests__/rate-limit.test.ts` — 14 tests
- `lib/logger.ts` — JSON logger, debug/info/warn/error, debug suppressed in production
- `lib/__tests__/logger.test.ts` — 10 tests

**Files modified:**
- `.gitignore` — Added `*.key`, `*.cert`

**Key decisions:**
- Rate limiter uses in-memory Map (not Upstash Redis) — no external deps
- Functional API (not class) — matches codebase style
- Logger outputs JSON via console.log/error/warn — PM2 captures stdout/stderr
- Cleanup sweep via setInterval(60s) with .unref()

---

## Part B: CORS + Error Pages — COMPLETED

**Files created:**
- `app/not-found.tsx` — Custom 404 with home link
- `app/error.tsx` — Error boundary showing digest only (no stack/message)
- `app/global-error.tsx` — Root error boundary with inline styles (outside root layout)
- `app/__tests__/not-found.test.tsx` — 2 tests
- `app/__tests__/error.test.tsx` — 4 tests
- `app/__tests__/global-error.test.tsx` — 2 tests

**Files modified:**
- `next.config.ts` — CORS headers for `/api/:path*` (Allow-Origin from NEXT_PUBLIC_APP_URL)

---

## Part C: Rate Limiting Application — COMPLETED

**Files modified:**
- `middleware.ts` — IP-based (10/min) for /api/*, user-based (100/min) for /api/v1/*, getClientIp() helper
- `app/api/agent/heartbeat/route.ts` — 20 req/sec per agent
- `app/api/agent/status/route.ts` — 2 req/min per agent

**Tests added:**
- `__tests__/middleware.test.ts` — +7 tests (getClientIp + rate limit configs)
- `app/api/agent/__tests__/heartbeat.test.ts` — +3 tests (rate limiting)
- `app/api/agent/__tests__/status.test.ts` — +3 tests (rate limiting)

---

## Part D: Athlete Data Deletion — COMPLETED

**Files created:**
- `lib/data/athlete-deletion.ts` — `deleteAthleteData()` atomic transaction, FK-safe order, audit logging
- `lib/data/__tests__/athlete-deletion.test.ts` — 10 tests

**Deletion order (FK-safe):**
1. hr_readings (athlete_id + gym_id)
2. session_athletes (athlete_id)
3. athlete_bands (athlete_id + gym_id)
4. athletes (id + gym_id)
5. Audit log via log.info()

---

## Key Decisions Logged

1. Rate limiter uses in-memory Map, not Upstash Redis
2. Rate limiter is functional API (not class) — matches codebase style
3. V1 API rate limiting centralized in middleware.ts (not per-route)
4. Agent rate limiting in route handlers (unique configs + custom auth)
5. Logger is console.log(JSON.stringify(...)) — no external deps
6. Athlete deletion skips JSONB anonymization for v1
7. Audit logging via structured logger (no audit_log table yet)
8. global-error.tsx uses inline styles (renders outside root layout)
9. CORS Allow-Origin uses NEXT_PUBLIC_APP_URL env var

## Gotchas Discovered

- @testing-library/react auto-cleanup not working — need explicit afterEach(cleanup)
- Module-level setInterval uses real timers — export _runCleanup() for test assertions
- __tests__/ dir at root can't use require("../lib/...") — must use static imports with vitest aliases
