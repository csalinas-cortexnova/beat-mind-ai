# BeatMind AI - Specs Index

> **Status:** `[ ]` Pending | `[~]` In Progress | `[x]` Completed

## Priority Queue

| Priority | Spec | Status | Plan | Notes |
|----------|------|--------|------|-------|
| 1 | 05 SuperAdmin Dashboard | [~] | [5 partes](plans/spec-05-superadmin-dashboard.md) | First UI, all API deps ready |
| 2 | 04 Security (Code-Level) | [x] | [4 partes](plans/spec-04-security.md) | Rate limiting, error pages, logging, data deletion |
| 3 | 08 WebSocket Server | [x] | completed | Real-time infra for TV + Agent |
| 4 | 06 Gym Dashboard | [ ] | [6 partes](plans/spec-06-gym-dashboard.md) | Main gym UI, needs WS |
| 5 | 09 Local Agent | [ ] | [5 partes](plans/spec-09-local-agent.md) | Mini PC, needs WS |
| 6 | 07 TV Dashboard | [ ] | [4 partes](plans/spec-07-tv-dashboard.md) | Full-screen HR display, needs WS |
| 7 | 10 AI Coaching | [x] | completed | OpenAI integration, needs WS |
| 8 | 11 Athlete Portal | [ ] | [4 partes](plans/spec-11-athlete-portal.md) | Standalone athlete UI |
| 9 | 03H Report Endpoints | [x] | included in Spec 12 | Deferred from Spec 03, covered by Spec 12 Part D |
| 10 | 12 Reports & WhatsApp | [x] | [4 partes](plans/spec-12-reports-whatsapp.md) | Twilio, calorie calc, report gen |
| — | 04 Security (Infra) | [x] | [4 partes](plans/spec-04-security-infra.md) | VPS hardening, DB roles, firewall — pre-deploy |

> **Rule:** Always pick Priority 1 (top of queue). When done, remove it and shift up.
> Plans marked `[Pending]` need to be created before execution.

## Spec Catalog

| # | Spec | Status | File | Description |
|---|------|--------|------|-------------|
| 01 | Database Schema & Multi-Tenancy | [x] | [database_spec.md](done/database_spec.md) | Drizzle schema, indexes, multi-tenant utilities, partitioning |
| 02 | Authentication & Authorization | [x] | [auth_spec.md](done/auth_spec.md) | Clerk setup, middleware, auth guards, agent/TV auth, webhooks |
| 03 | REST API | [x] | [api_spec.md](api_spec.md) | Agent, superadmin, gym, athlete endpoints done (605 tests). Report endpoints deferred to Spec 12 |
| 04 | Security | [x] | [security_spec.md](done/security_spec.md) | Credentials, tenant isolation, headers, CORS, DB roles, logging |
| 05 | SuperAdmin Dashboard | [~] | [superadmin_dashboard_spec.md](superadmin_dashboard_spec.md) | Overview, gym management, agent monitoring, server actions |
| 06 | Gym Dashboard | [ ] | [gym_dashboard_spec.md](gym_dashboard_spec.md) | Settings, athletes, trainers, sessions, real-time features |
| 07 | TV Dashboard | [ ] | [tv_dashboard_spec.md](tv_dashboard_spec.md) | Full-screen HR display, WebSocket, animations, white-label |
| 08 | WebSocket Server | [x] | [websocket_server_spec.md](done/websocket_server_spec.md) | Connection manager, gym state, batch writer, auto-session |
| 09 | Local Agent (Mini PC) | [ ] | [local_agent_spec.md](local_agent_spec.md) | ANT+ reader, device manager, VPS client, offline fallback |
| 10 | AI Coaching (Coach Pulse) | [x] | [ai_coaching_spec.md](done/ai_coaching_spec.md) | OpenAI integration, real-time analysis, post-session summaries |
| 11 | Athlete Portal | [ ] | [athlete_portal_spec.md](athlete_portal_spec.md) | Dashboard, session history, progress charts, profile |
| 12 | Reports & WhatsApp | [x] | [reports_whatsapp_spec.md](done/reports_whatsapp_spec.md) | Report generation, Twilio WhatsApp, calorie estimation |

## Dependencies

```
01 Database ──► 02 Auth ──► 03 API ──► 05 SuperAdmin
                  │                      06 Gym Dashboard
                  │                      11 Athlete Portal
                  ▼
               04 Security (cross-cutting, apply throughout)

01 Database ──► 08 WebSocket Server ──► 07 TV Dashboard
                       │                09 Local Agent
                       ▼
                    10 AI Coaching ──► 12 Reports & WhatsApp
```

## Recommended Build Order

1. **Spec 01** — Database (foundation for everything)
2. **Spec 02** — Auth (required by all protected routes)
3. **Spec 04** — Security (apply as you build, not after)
4. **Spec 03** — API (shared utilities + endpoints)
5. **Spec 05** — SuperAdmin Dashboard
6. **Spec 08** — WebSocket Server
7. **Spec 06** — Gym Dashboard
8. **Spec 09** — Local Agent
9. **Spec 07** — TV Dashboard
10. **Spec 10** — AI Coaching
11. **Spec 11** — Athlete Portal
12. **Spec 12** — Reports & WhatsApp
