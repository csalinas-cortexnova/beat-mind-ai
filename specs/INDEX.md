# BeatMind AI - Specs Index

> **Status:** `[ ]` Pending | `[~]` In Progress | `[x]` Completed

| # | Spec | Status | File | Description |
|---|------|--------|------|-------------|
| 01 | Database Schema & Multi-Tenancy | [ ] | [database_spec.md](database_spec.md) | Drizzle schema, indexes, multi-tenant utilities, partitioning |
| 02 | Authentication & Authorization | [ ] | [auth_spec.md](auth_spec.md) | Clerk setup, middleware, auth guards, agent/TV auth, webhooks |
| 03 | REST API | [ ] | [api_spec.md](api_spec.md) | All endpoints: agent, superadmin, gym, athlete, reports |
| 04 | Security | [ ] | [security_spec.md](security_spec.md) | Credentials, tenant isolation, headers, CORS, DB roles, logging |
| 05 | SuperAdmin Dashboard | [ ] | [superadmin_dashboard_spec.md](superadmin_dashboard_spec.md) | Overview, gym management, agent monitoring, server actions |
| 06 | Gym Dashboard | [ ] | [gym_dashboard_spec.md](gym_dashboard_spec.md) | Settings, athletes, trainers, sessions, real-time features |
| 07 | TV Dashboard | [ ] | [tv_dashboard_spec.md](tv_dashboard_spec.md) | Full-screen HR display, WebSocket, animations, white-label |
| 08 | WebSocket Server | [ ] | [websocket_server_spec.md](websocket_server_spec.md) | Connection manager, gym state, batch writer, auto-session |
| 09 | Local Agent (Mini PC) | [ ] | [local_agent_spec.md](local_agent_spec.md) | ANT+ reader, device manager, VPS client, offline fallback |
| 10 | AI Coaching (Coach Pulse) | [ ] | [ai_coaching_spec.md](ai_coaching_spec.md) | OpenAI integration, real-time analysis, post-session summaries |
| 11 | Athlete Portal | [ ] | [athlete_portal_spec.md](athlete_portal_spec.md) | Dashboard, session history, progress charts, profile |
| 12 | Reports & WhatsApp | [ ] | [reports_whatsapp_spec.md](reports_whatsapp_spec.md) | Report generation, Twilio WhatsApp, calorie estimation |

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
