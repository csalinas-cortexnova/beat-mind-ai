# BeatMind AI - Task List

> **Task Status Legend:**
> - `[ ]` Pending
> - `[~]` In Progress
> - `[x]` Completed

## 1. Database Schema & Multi-Tenancy [`specs/database_spec.md`](specs/database_spec.md)

### Schema Definitions
- [x] Create Drizzle schema file for `gyms` table with `subscriptionStatusEnum`
- [x] Create Drizzle schema file for `users` table
- [x] Create Drizzle schema file for `gym_memberships` table with `gymMembershipRoleEnum` and unique constraint
- [x] Create Drizzle schema file for `athletes` table
- [x] Create Drizzle schema file for `athlete_bands` table with unique constraint on `gym_id` and `sensor_id`
- [x] Create Drizzle schema file for `sessions` table with `sessionStatusEnum`
- [x] Create Drizzle schema file for `hr_readings` table with BIGSERIAL primary key
- [x] Create Drizzle schema file for `session_athletes` table with unique constraint on `session_id` and `athlete_id`
- [x] Create Drizzle schema file for `ai_coaching_messages` table
- [x] Create Drizzle schema file for `agents` table with `agentStatusEnum`
- [x] Create Drizzle schema file for `hr_bands` table with `hrBandStatusEnum`
- [x] Create schema barrel export file (`lib/db/schema/index.ts`)

### ORM & Configuration
- [x] Configure Drizzle ORM database client with node-postgres pool in `lib/db/index.ts`
- [x] Create `drizzle.config.ts` configuration file
- [x] Generate initial Drizzle migration from schema definitions

### Indexes & Constraints
- [x] Create index on `hr_readings (session_id, recorded_at DESC)`
- [x] Create index on `hr_readings (gym_id, recorded_at DESC)`
- [x] Create index on `hr_readings (athlete_id, recorded_at DESC)`
- [x] Create index on `sessions (gym_id, started_at DESC)`
- [x] Create partial index on `sessions (gym_id, status)` WHERE `status = 'active'`
- [x] Create partial index on `athletes (gym_id)` WHERE `is_active = true`
- [x] Create partial index on `athlete_bands (gym_id, sensor_id)` WHERE `is_active = true`
- [x] Create partial index on `gym_memberships (user_id)` WHERE `is_active = true`
- [x] Create index on `ai_coaching_messages (session_id, created_at DESC)`
- [x] Create index on `session_athletes (session_id)` and `(athlete_id)`
- [x] Create UNIQUE index on `users (clerk_user_id)` and `gyms (clerk_org_id)`
- [x] Add all foreign key constraints with correct ON DELETE behavior (CASCADE / SET NULL)

### Multi-Tenancy & Utilities
- [x] Implement `withGymScope()` utility function in `lib/utils/gym-scope.ts`
- [x] Create `requireGymContext()` helper in `lib/auth/guards.ts`
- [x] Create database seed file (`lib/db/seed.ts`) with sample data for development

### Partitioning & Maintenance (deferred to Phase 5)
- [ ] Create migration for `hr_readings` table partitioning by month
- [ ] Create automated partition management script (pg_cron or manual SQL)
- [ ] Implement archival process for old `hr_readings` partitions

### Tests
- [x] Write tests for `withGymScope()` utility
- [x] Write tests for multi-tenant query isolation
- [x] Write integration tests for schema and migrations

---

## 2. Authentication & Authorization [`specs/auth_spec.md`](specs/auth_spec.md)

### Clerk Setup
- [ ] Configure Clerk organization model with roles (`org:admin`, `org:trainer`, `org:athlete`)
- [ ] Define custom Clerk permissions (`org:gym:manage`, `org:trainers:manage`, etc.)
- [ ] Create SuperAdmin flag in Clerk user `publicMetadata` (`is_superadmin`)
- [ ] Set up `ClerkProvider` in `app/layout.tsx`
- [ ] Create `/sign-in` and `/sign-up` pages with Clerk components
- [ ] Create `/org-selection` page for users without active organization

### Middleware
- [ ] Implement `middleware.ts` with Clerk integration for route protection
- [ ] Create route matchers for public, superadmin, gym, and athlete routes
- [ ] Configure middleware to skip `/tv/*` and `/api/agent/*` routes

### Auth Guards
- [ ] Create `lib/auth/types.ts` with AuthenticatedUser, GymContext, AthleteContext, AgentContext, TvContext interfaces
- [ ] Create `requireSuperAdmin()` function in `lib/auth/guards.ts`
- [ ] Create `requireGymAccess()` function with optional gymId parameter
- [ ] Create `requireGymOwner()` function for owner-only operations
- [ ] Create `requireTrainer()` function for trainer-specific operations
- [ ] Create `requireAthlete()` function for athlete profile resolution
- [ ] Create API variants: `requireSuperAdminApi()`, `requireGymAccessApi()` returning JSON errors

### Agent Auth
- [ ] Create `lib/auth/agent-auth.ts` with `verifyAgentAuth()` for HTTP header-based authentication
- [ ] Create `verifyAgentWsAuth()` for WebSocket connection validation
- [ ] Implement bcrypt secret comparison and UUID format validation

### TV Auth
- [ ] Create `lib/auth/tv-auth.ts` with `verifyTvToken()` function
- [ ] Create `regenerateTvToken()` function

### Webhooks
- [ ] Set up Clerk webhook endpoint at `/api/webhooks/clerk` with svix verification
- [ ] Implement handlers for `user.created`, `user.updated`, `user.deleted`
- [ ] Implement handlers for `organization.created`
- [ ] Implement handlers for `organizationMembership.created`, `.updated`, `.deleted`

### Routing & Redirects
- [ ] Create `lib/auth/redirect.ts` with `redirectByRole()` function
- [ ] Create `/dashboard/page.tsx` with role-based redirect
- [ ] Create `/unauthorized` error page

### Rate Limiting
- [ ] Create `lib/rate-limit.ts` with Upstash Redis rate limiter instances
- [ ] Apply rate limits to all route groups (agent, superadmin, gym, athlete, webhooks)

### Security Headers
- [ ] Implement security headers in `next.config.ts` (X-Frame-Options, CSP, HSTS, etc.)

### Tests
- [ ] Create test suite for all auth guards
- [ ] Create test suite for agent auth
- [ ] Create test suite for TV token validation
- [ ] Create test suite for middleware route protection
- [ ] Create test suite for webhook handlers

---

## 3. REST API [`specs/api_spec.md`](specs/api_spec.md)

### Shared Utilities
- [ ] Create `lib/api/response.ts` with `ok()` and `error()` helpers
- [ ] Create `lib/api/validate.ts` with `validateBody()` and `validateQuery()` helpers
- [ ] Create `lib/api/pagination.ts` with pagination utilities
- [ ] Create `lib/api/rate-limit.ts` with rate limiting configuration
- [ ] Create comprehensive error code enumeration

### Zod Validation Schemas
- [ ] Create `lib/validations/common.ts` with UUID, email, phone, hexColor, timezone patterns
- [ ] Create `lib/validations/agent.ts` (AgentHeartbeatSchema, AgentStatusSchema)
- [ ] Create `lib/validations/gym.ts` (CreateGymSchema, UpdateGymSchema)
- [ ] Create `lib/validations/athlete.ts` (CreateAthleteSchema, UpdateAthleteSchema)
- [ ] Create `lib/validations/band.ts` (AssignBandSchema)
- [ ] Create `lib/validations/trainer.ts` (InviteTrainerSchema)
- [ ] Create `lib/validations/session.ts` (EndSessionSchema)
- [ ] Create `lib/validations/report.ts` (SendWhatsAppSchema)

### Agent Endpoints
- [ ] Implement `POST /api/agent/heartbeat` with auth, validation, HR zone computation, bulk insert
- [ ] Implement `POST /api/agent/status` with auth and status tracking

### SuperAdmin Endpoints
- [ ] Implement `GET /api/v1/superadmin/gyms` with pagination, filtering, search, aggregated stats
- [ ] Implement `POST /api/v1/superadmin/gyms` with Clerk Organization creation and invitation
- [ ] Implement `PATCH /api/v1/superadmin/gyms/[id]` with partial updates and subscription transitions
- [ ] Implement `GET /api/v1/superadmin/agents` with pagination and status filtering

### Gym Endpoints
- [ ] Implement `GET /api/v1/gym/profile` with branding and TV token
- [ ] Implement `PATCH /api/v1/gym/profile` with branding, settings, and TV token regeneration
- [ ] Implement `GET /api/v1/gym/athletes` with pagination, search, active filter
- [ ] Implement `POST /api/v1/gym/athletes` with max limit enforcement and email uniqueness
- [ ] Implement `PATCH /api/v1/gym/athletes/[id]` with band deactivation on inactive
- [ ] Implement `POST /api/v1/gym/athletes/[id]/bands` with sensor assignment validation
- [ ] Implement `DELETE /api/v1/gym/athletes/[id]/bands`
- [ ] Implement `GET /api/v1/gym/trainers` (owner-only)
- [ ] Implement `POST /api/v1/gym/trainers` with Clerk invitation
- [ ] Implement `GET /api/v1/gym/sessions` with date range and status filtering
- [ ] Implement `GET /api/v1/gym/sessions/active` with real-time athlete data
- [ ] Implement `POST /api/v1/gym/sessions/[id]/end` with stats calculation and async jobs

### Athlete Endpoints
- [ ] Implement `GET /api/v1/athlete/profile` with gym info and weekly streak
- [ ] Implement `PATCH /api/v1/athlete/profile` with restricted fields
- [ ] Implement `GET /api/v1/athlete/sessions` with pagination
- [ ] Implement `GET /api/v1/athlete/sessions/[id]` with HR data, zones, AI messages
- [ ] Implement `GET /api/v1/athlete/progress` with weekly/monthly aggregations

### Report Endpoints
- [ ] Implement `GET /api/v1/reports/session/[id]` with dual auth (Clerk or token)
- [ ] Implement `POST /api/v1/reports/session/[id]/send-whatsapp` with retry logic

### Tests
- [ ] Create integration tests for all agent endpoints
- [ ] Create integration tests for all superadmin endpoints
- [ ] Create integration tests for all gym endpoints
- [ ] Create integration tests for all athlete endpoints
- [ ] Create integration tests for all report endpoints
- [ ] Create tests for pagination, validation errors, rate limiting, tenant isolation

---

## 4. Security [`specs/security_spec.md`](specs/security_spec.md)

### Credential Management
- [ ] Rotate all exposed credentials (Clerk keys, DATABASE_URL, OPENAI_API_KEY)
- [ ] Use BFG Repo-Cleaner to remove `.env.local` from git history
- [ ] Verify `.gitignore` contains `.env*`, `*.pem`, `*.key` entries
- [ ] Set `.env.local` file permissions to 600

### Tenant Isolation
- [ ] Create `withGymScope()` and `withGymScopeAnd()` utility functions
- [ ] Implement `getAuthenticatedGymId()` in `lib/auth/guards.ts`
- [ ] Enforce tenant isolation in all gym-scoped queries

### Input Validation
- [ ] Create Zod validation schemas for all API inputs
- [ ] Create input validation middleware

### Security Headers & CORS
- [ ] Configure CORS headers (specific origin, agent headers)
- [ ] Add all security headers (CSP, HSTS, X-Frame-Options, etc.)
- [ ] Disable `X-Powered-By` in `next.config.ts`

### WebSocket Security
- [ ] Implement agent auth timeout (5 seconds)
- [ ] Implement TV token validation in `verifyClient` callback
- [ ] Configure WebSocket `maxPayload` (64 KB)
- [ ] Implement per-connection rate limiting

### Database Security
- [ ] Create `beatmind_app` database role with limited privileges
- [ ] Create `beatmind_migrations` role for deployments
- [ ] Configure `DATABASE_URL` with `sslmode=require` for production

### Data Privacy
- [ ] Implement `deleteAthleteData()` function with atomic transaction
- [ ] Implement data retention policies (hr_readings 24 months, ai_coaching_messages 12 months)
- [ ] Add WhatsApp opt-in fields to athletes table

### Server Hardening
- [ ] Configure TLS (v1.2+) in reverse proxy
- [ ] Configure UFW firewall rules
- [ ] Create non-root `beatmind` user on VPS
- [ ] Configure PM2 processes as non-root user

### Logging
- [ ] Create structured logging utility in `lib/logger.ts`
- [ ] Implement audit logging for security-sensitive actions
- [ ] Ensure no PII (emails, phones, names, HR readings) in logs

### Error Handling
- [ ] Create custom 404, error boundary, and global error pages
- [ ] Ensure stack traces are stripped in production

### Tests
- [ ] Write tests for tenant isolation enforcement
- [ ] Write tests for security headers
- [ ] Write tests for rate limiting

---

## 5. SuperAdmin Dashboard [`specs/superadmin_dashboard_spec.md`](specs/superadmin_dashboard_spec.md)

### Layout & Navigation
- [ ] Create SuperAdmin layout with sidebar navigation (Overview, Gyms, Agents)
- [ ] Create SuperAdmin sidebar component with icons and active state

### Overview Page
- [ ] Create overview page (`/superadmin`) with stats cards (total gyms, active gyms, athletes, sessions, agents)
- [ ] Create stats card grid component
- [ ] Build recent activity event feed

### Gym Management
- [ ] Create gym list page (`/superadmin/gyms`) with server-side paginated DataTable
- [ ] Implement gym list filtering by subscription status and search
- [ ] Create `DataTable` component with sorting, filtering, pagination
- [ ] Create `StatusBadge` component
- [ ] Build create gym page (`/superadmin/gyms/new`) with `GymForm` component
- [ ] Implement slug auto-generation from gym name
- [ ] Implement color picker for primary/secondary colors
- [ ] Create gym detail/edit page (`/superadmin/gyms/[id]`)
- [ ] Create subscription manager component with status transitions
- [ ] Create owner assignment modal with reassignment logic
- [ ] Create TV token manager component with masked display and regeneration
- [ ] Implement subscription side effects (suspension, cancellation, reactivation)

### Agent Management
- [ ] Create agents list page (`/superadmin/agents`) with hardware inventory table
- [ ] Create `AgentStatusIndicator` component (connected/disconnected/never_connected)
- [ ] Implement agent filtering by gym and status
- [ ] Implement agent list auto-refresh every 30 seconds
- [ ] Create agent detail panel with config viewer and heartbeat timeline

### Server Actions
- [ ] Create server actions: `createGymAction`, `updateGymAction`, `reassignOwnerAction`, `regenerateTvTokenAction`

### Tests
- [ ] Write unit tests for validation schemas and guard functions
- [ ] Write integration tests for all SuperAdmin API endpoints
- [ ] Write integration tests for Clerk Organization flows

---

## 6. Gym Dashboard [`specs/gym_dashboard_spec.md`](specs/gym_dashboard_spec.md)

### Layout & Navigation
- [ ] Create gym layout (`app/(platform)/gym/layout.tsx`) with sidebar, header, breadcrumbs
- [ ] Create gym sidebar with collapsible nav and active session indicator
- [ ] Implement permission checks to hide Owner-only elements from Trainer role

### Dashboard Overview
- [ ] Create dashboard overview page (`/gym`) with stats, active session banner, recent sessions

### Settings & Branding
- [ ] Create gym settings page (`/gym/settings`) with form and TV token management (Owner only)
- [ ] Create branding page (`/gym/branding`) with color picker, logo upload, live preview (Owner only)
- [ ] Implement `ColorPicker` component and `FileUpload` component

### Athlete Management
- [ ] Create athlete list page (`/gym/athletes`) with DataTable, search, filters, pagination
- [ ] Create athlete creation page (`/gym/athletes/new`) with form
- [ ] Create athlete edit page (`/gym/athletes/[id]`) with deactivate option
- [ ] Create `AthleteForm` reusable component
- [ ] Create band assignment page (`/gym/athletes/[id]/bands`)
- [ ] Implement max HR helper text ("220 - age")

### Trainer Management
- [ ] Create trainer management page (`/gym/trainers`) (Owner only)
- [ ] Create `InviteTrainerModal` component
- [ ] Implement trainer removal flow

### Session Management
- [ ] Create session history page (`/gym/sessions`) with DataTable, date range, filters
- [ ] Create live session view page (`/gym/sessions/active`) with WebSocket and athlete cards
- [ ] Create `StartSessionModal` with class type selector
- [ ] Create session detail page (`/gym/sessions/[id]`) with AI summary and per-athlete stats
- [ ] Implement `SessionTimer` component for active sessions
- [ ] Implement `AthleteCard` for real-time HR display with sparkline and coach overlay
- [ ] Implement `HrTimeChart` and `ZoneDistributionChart` for session detail

### Reports
- [ ] Create reports overview page (`/gym/reports`) with recent sessions and bulk send

### Real-Time Features
- [ ] Implement client-side WebSocket connection with auto-reconnect (exponential backoff)
- [ ] Implement WebSocket disconnection banner
- [ ] Implement AI coaching overlay on athlete cards (8-second fade)

### Shared Components
- [ ] Create `StatCard`, `DataTable`, `ConfirmModal` reusable components
- [ ] Implement toast notification system
- [ ] Implement empty states for all list pages

### Post-Session Pipeline
- [ ] Create server-side job to calculate `session_athletes` stats
- [ ] Create server-side job for AI summary generation
- [ ] Create delayed WhatsApp delivery job (2 minutes after session end)
- [ ] Implement auto-session logic (auto-start/auto-end)

### Tests
- [ ] Write integration tests for all gym API endpoints
- [ ] Write component tests for forms, modals, and data display

---

## 7. TV Dashboard [`specs/tv_dashboard_spec.md`](specs/tv_dashboard_spec.md)

### Route Setup
- [ ] Create `app/tv/[gymId]/layout.tsx` (minimal, no Clerk, full viewport)
- [ ] Create `app/tv/[gymId]/page.tsx` server component with token validation
- [ ] Create `TVErrorScreen` component for invalid token states
- [ ] Configure Clerk middleware to skip `/tv/*` routes

### TypeScript Types
- [ ] Create `types/tv.ts` with GymConfig, AthleteData, CoachMessage, WebSocketMessage types

### Core Components
- [ ] Create `TVDashboard.tsx` main client component (orchestrator)
- [ ] Create `TVHeader.tsx` with gym name, logo, clock, session timer, connection status
- [ ] Create `AthleteGrid.tsx` with dynamic CSS grid
- [ ] Create `AthleteCard.tsx` with BPM, zone, sparkline, signal indicator, 3 states (active/inactive/empty)
- [ ] Create `Sparkline.tsx` canvas component (60-second rolling window, zone-colored)
- [ ] Create `CoachOverlay.tsx` per-card AI overlay (8-second animation with progress bar)
- [ ] Create `CoachActivationBanner.tsx` full-screen "COACH AI ACTIVADO" (4.5-second animation)
- [ ] Create `ConnectionOverlay.tsx` for disconnected state with reconnection countdown

### Hooks
- [ ] Implement `useWebSocket.ts` with auto-reconnect (exponential backoff: 1s → 30s max)
- [ ] Implement `useAthleteState.ts` with Map-based state and change detection
- [ ] Implement `useSessionTimer.ts` for elapsed time (HH:MM:SS)
- [ ] Implement `useGridLayout.ts` for dynamic column/row calculation (1-20 athletes)

### HR Zone Utilities
- [ ] Create `lib/hr/zones.ts` with zone constants, colors, and localized names (es/pt)
- [ ] Implement UUID validation utility

### Animations & Styling
- [ ] Implement BPM pulse animation on data updates
- [ ] Implement grid layout smooth transitions (0.3s)
- [ ] Implement card entry/exit animations (fade + scale)
- [ ] Implement zone bar, zone badge, signal dot styling
- [ ] Implement BPM font scaling based on athlete count (8rem → 3rem)
- [ ] Implement white-label branding via CSS custom properties

### Idle/Error States
- [ ] Implement "Waiting for session" state
- [ ] Implement "No athletes connected" state
- [ ] Implement connection status indicator (green/red/yellow)

### Performance
- [ ] Wrap `AthleteCard` in `React.memo` with custom comparison
- [ ] Implement sparkline canvas optimization (devicePixelRatio, resize handling)
- [ ] Cap sparkline history at 60 data points
- [ ] Ensure < 16ms WebSocket message processing

### Tests
- [ ] Test WebSocket message parsing for all 3 message types
- [ ] Test grid layout calculation for 1-20 athletes
- [ ] Test token validation (valid, invalid, missing)
- [ ] Test reconnection and connection status transitions
- [ ] Test coach overlay and activation banner animations
- [ ] Test branding application and fallback defaults

---

## 8. WebSocket Server [`specs/websocket_server_spec.md`](specs/websocket_server_spec.md)

### Entry Point
- [ ] Create `ws-server.ts` entry point with HTTP server and WebSocket listener on port 3001
- [ ] Implement `/health` HTTP endpoint returning status, connections, metrics

### Connection Manager
- [ ] Create `ConnectionManager` class in `lib/ws/manager.ts`
- [ ] Implement `handleAgentConnection()` with 5-second auth timeout
- [ ] Implement `handleTVConnection()` with token validation on upgrade
- [ ] Implement `broadcastToGym()` method
- [ ] Implement agent replacement logic (close old connection, accept new)
- [ ] Implement periodic health monitoring (30-second interval)

### Gym State Manager
- [ ] Create `GymStateManager` class in `lib/ws/gym-state.ts`
- [ ] Implement state initialization from database (gym config, athlete mappings, active session)
- [ ] Implement `processHRData()` to enrich raw data with athlete profiles and HR zones
- [ ] Implement periodic athlete mapping refresh (every 5 minutes)
- [ ] Implement cache invalidation endpoint for band assignment updates
- [ ] Implement gym state eviction after 10 minutes of inactivity

### Handlers
- [ ] Create `agent-handler.ts` for agent auth, hr-data, heartbeat messages
- [ ] Create `tv-handler.ts` for TV connections, init message, ping/pong
- [ ] Implement agent disconnect handling with 60-second offline timer
- [ ] Implement TV pong timeout detection (60s) with termination

### Batch Writer
- [ ] Create `BatchWriter` class in `lib/ws/batch-writer.ts`
- [ ] Implement `enqueue()` and `flush()` (every 5 seconds)
- [ ] Implement buffer overflow handling (drop oldest 50% if > 1000)
- [ ] Implement `shutdown()` for graceful final flush

### Internal HTTP Endpoints
- [ ] Implement `/internal/broadcast` for AI coaching messages
- [ ] Implement `/internal/session-event` for session lifecycle events
- [ ] Implement `X-Internal-Secret` header validation

### Auto-Session Logic
- [ ] Implement auto-session creation on 30 seconds of sustained HR data
- [ ] Implement auto-session end on 2 minutes of no active sensors

### Validation & Types
- [ ] Create Zod schemas for all WS message types (auth, hr-data, heartbeat, session events)
- [ ] Create `lib/ws/types.ts` with all message type definitions

### PM2 & Graceful Shutdown
- [ ] Create `ecosystem.config.js` with PM2 configuration for both processes
- [ ] Implement graceful shutdown (SIGINT/SIGTERM): stop connections, flush data, close DB

### Error Handling
- [ ] Implement handlers for malformed JSON, unknown types, missing fields, out-of-range BPM
- [ ] Implement database error recovery (buffer in memory, retry on reconnect)
- [ ] Implement structured JSON logging

### Environment Variables
- [ ] Configure WS_PORT, WS_INTERNAL_SECRET, WS_PING_INTERVAL, WS_PONG_TIMEOUT, WS_AUTH_TIMEOUT, WS_BATCH_FLUSH_INTERVAL, WS_BATCH_MAX_BUFFER

### Tests
- [ ] Test agent authentication (valid, invalid, timeout)
- [ ] Test TV token validation and rejection
- [ ] Test HR data processing and enrichment pipeline
- [ ] Test batch writer flush behavior
- [ ] Test auto-session creation and termination
- [ ] Test graceful shutdown with pending data flush
- [ ] Test broadcast to multiple TV clients per gym

---

## 9. Local Agent (Mini PC) [`specs/local_agent_spec.md`](specs/local_agent_spec.md)

### Package Setup
- [ ] Create `agent/` directory structure with `src/`, `tests/`, config files
- [ ] Create `agent/package.json` with dependencies (ant-plus, usb, ws, dotenv)
- [ ] Create `agent/tsconfig.json` with strict mode
- [ ] Create `agent/.env.example` with all documented variables

### Core Modules
- [ ] Implement `agent/src/ant-reader.ts` - ANT+ USB communication with multi-dongle support
- [ ] Implement multi-dongle deduplication, USB health check, reconnection
- [ ] Implement `agent/src/device-manager.ts` - device state tracking, HR zone calculation
- [ ] Implement device state transitions (new → active → inactive → removed)
- [ ] Implement sparkline history (rolling 60-second window)
- [ ] Implement `agent/src/vps-client.ts` - WebSocket + HTTPS to VPS
- [ ] Implement auto-reconnect with exponential backoff (1s → 30s max)
- [ ] Implement WebSocket send interval (1s) and HTTPS batch POST (5s)
- [ ] Implement offline buffering (circular buffer, max 10 minutes)
- [ ] Implement buffer flush on reconnection
- [ ] Implement `agent/src/local-dashboard.ts` - offline TV fallback HTTP server
- [ ] Create inline HTML dashboard (no build step, no external dependencies)

### Orchestration
- [ ] Implement `agent/src/index.ts` entry point wiring all modules
- [ ] Implement session auto-start/auto-end logic
- [ ] Implement graceful shutdown handlers (SIGINT, SIGTERM)

### Types & Config
- [ ] Create `agent/src/types.ts` with all TypeScript interfaces
- [ ] Create `agent/src/config.ts` with env var loading and validation
- [ ] Create `agent/src/logger.ts` with structured logging

### Deployment
- [ ] Create `agent/ecosystem.config.js` for PM2
- [ ] Create `agent/setup.sh` for initial mini PC deployment
- [ ] Create `agent/update.sh` for remote updates
- [ ] Create `agent/src/udev/99-ant-usb.rules` for Linux USB permissions

### Tests
- [ ] Create `agent/tests/ant-reader.test.ts` (mock ant-plus, multi-dongle, reconnection)
- [ ] Create `agent/tests/device-manager.test.ts` (zones, state transitions, cleanup)
- [ ] Create `agent/tests/vps-client.test.ts` (WS, HTTP, backoff, buffering)
- [ ] Create `agent/tests/config.test.ts` (env validation)

---

## 10. AI Coaching System (Coach Pulse) [`specs/ai_coaching_spec.md`](specs/ai_coaching_spec.md)

### TypeScript Types
- [ ] Create `lib/ai/types.ts` with CoachingConfig, AthleteSummary, AnalysisResult, PostSessionAthleteStats, SessionTimerState interfaces

### Prompt Engineering
- [ ] Create `lib/ai/prompts.ts` with `buildSystemPrompt()` (es/pt language support)
- [ ] Create `buildUserPrompt()` with athlete summary data formatting
- [ ] Create `buildPostSessionSystemPrompt()` and `buildPostSessionUserPrompt()`

### Coach Service
- [ ] Create `lib/ai/coach.ts` with OpenAI client singleton (10s timeout, 0 retries)
- [ ] Implement `getCoachingConfig()` from env vars and gym settings
- [ ] Implement `startCoachingTimer()` and `stopCoachingTimer()`
- [ ] Implement `runAnalysisCycle()` with warmup period check
- [ ] Implement `fetchAndSummarize()` - query hr_readings, compute per-athlete summaries
- [ ] Implement per-athlete calculations: avgBpm, min/max, trend (rising/falling/stable), timeByZone
- [ ] Implement `callOpenAI()` with error handling for all failure types
- [ ] Implement coaching message storage in `ai_coaching_messages` table
- [ ] Implement WebSocket broadcast of coaching messages

### Post-Session Summary
- [ ] Implement `generatePostSessionSummary()` triggered on session end
- [ ] Implement post-session stats collection from `session_athletes`
- [ ] Store summary in `sessions.ai_summary`

### HR Zone Utilities
- [ ] Create `lib/hr/zones.ts` with zone constants, colors, localized names (es/pt)
- [ ] Implement zone calculation function

### Integration
- [ ] Wire coaching service to `ws-server.ts` for timer lifecycle management
- [ ] Wire `onFirstHrDataForSession` → `startCoachingTimer()`
- [ ] Wire `onSessionEnd` → `generatePostSessionSummary()` + `stopCoachingTimer()`

### Environment Variables
- [ ] Configure OPENAI_API_KEY, OPENAI_MODEL, AI_ANALYSIS_INTERVAL_MS, AI_WARMUP_MS, AI_ANALYSIS_MINUTES

### Tests
- [ ] Test `fetchAndSummarize()` with no data, multiple athletes, diverse zones
- [ ] Test trend calculation edge cases
- [ ] Test OpenAI error handling for each failure type
- [ ] Test analysis cycle during/after warmup period
- [ ] Test timer start/stop lifecycle
- [ ] Test language support (es/pt)

---

## 11. Athlete Portal [`specs/athlete_portal_spec.md`](specs/athlete_portal_spec.md)

### Auth & Layout
- [ ] Create `requireAthlete()` auth guard resolving userId, athleteId, gymId
- [ ] Create `(platform)/athlete/layout.tsx` with sidebar navigation and mobile responsiveness

### Dashboard (`/athlete`)
- [ ] Create dashboard page with Last Session Card, Stats Row, Recent Sessions
- [ ] Create `StatCard.tsx`, `SessionCard.tsx`, `WeeklyStreakBadge.tsx` components
- [ ] Implement `calculateWeeklyStreak()` utility function

### Session History (`/athlete/sessions`)
- [ ] Create session history page with paginated list
- [ ] Create `SessionList.tsx`, `SessionListItem.tsx` components
- [ ] Create `Pagination.tsx` component
- [ ] Create `EmptyState.tsx` reusable component

### Session Detail (`/athlete/sessions/[id]`)
- [ ] Create session detail page with stats, charts, AI messages
- [ ] Create `HrLineChart.tsx` (Recharts LineChart with zone reference lines)
- [ ] Create `ZoneBarChart.tsx` (Recharts horizontal bar chart with zone colors)
- [ ] Create AI coaching messages list component
- [ ] Implement LTTB downsampling utility for large HR datasets

### Progress (`/athlete/progress`)
- [ ] Create progress page with weekly/monthly trend charts
- [ ] Create `PeriodToggle.tsx` component
- [ ] Create sessions count, avg HR trend, calories trend charts
- [ ] Create `ZoneEvolutionChart.tsx` (Recharts StackedBarChart)

### Profile (`/athlete/profile`)
- [ ] Create profile page with editable form
- [ ] Create `ProfileForm.tsx` client component
- [ ] Create `athleteProfileSchema` Zod validation (name, age, weight, maxHr, phone E.164, whatsappOptIn)
- [ ] Implement max HR helper (220 - age estimate)

### Formatting Utilities
- [ ] Create duration formatting (seconds → mm:ss)
- [ ] Create date formatting (relative + absolute)
- [ ] Create zone percentage calculations

### Tests
- [ ] Unit tests for `calculateWeeklyStreak()`, validation schema, zone calculations, LTTB, formatting
- [ ] Integration tests for `requireAthlete()` guard and all API endpoints
- [ ] Component tests for StatCard, ProfileForm, Pagination

---

## 12. Reports & WhatsApp [`specs/reports_whatsapp_spec.md`](specs/reports_whatsapp_spec.md)

### HR Utilities
- [ ] Create `lib/hr/calories.ts` with `estimateCalories()` (primary Keytel formula + fallback)
- [ ] Create `lib/hr/zones.ts` with `getZone()` and `calculateZoneTimes()` with delta capping

### Report Generation
- [ ] Create `lib/reports/generate.ts` orchestrator: `generateSessionReport()` (5-step pipeline)
- [ ] Create `lib/reports/stats.ts` with `calculateAthleteSessionStats()` (avg/max/min HR, calories, zone times)
- [ ] Create `lib/reports/ai-summary.ts` with OpenAI gpt-4o-mini integration
- [ ] Create `lib/reports/token.ts` with JWT report token generation/validation (HMAC-SHA256, 30-day expiry)

### Report Web Page
- [ ] Create `app/reports/session/[sessionId]/[athleteId]/page.tsx` server component with token validation
- [ ] Create `ReportView.tsx` client component (GymHeader, SessionInfo, Stats, Charts, AiSummary, Footer)
- [ ] Implement ZoneDistributionChart (Recharts horizontal bar chart)
- [ ] Implement HrTimelineChart (Recharts line chart with zone bands, LTTB downsampling for 500+ points)
- [ ] Implement responsive/mobile-first design and print CSS support

### WhatsApp Integration
- [ ] Create `lib/whatsapp/client.ts` Twilio wrapper with retry logic
- [ ] Create `lib/whatsapp/templates.ts` with `buildSessionReportTemplate()`
- [ ] Create WhatsApp template in Twilio Console (`session_report`, Spanish, UTILITY)
- [ ] Implement WhatsApp send flow: eligibility checks, token generation, message sending
- [ ] Implement retry policy (1 retry after 30s on failure)
- [ ] Implement skip conditions (no opt-in, no phone, invalid phone, already sent)
- [ ] Implement 2-minute delayed scheduling (setTimeout)
- [ ] Implement idempotency (cancel pending jobs on re-end)

### Database Migrations
- [ ] Add `athletes.gender` column (VARCHAR(10), nullable)
- [ ] Add `session_athletes.report_token`, `whatsapp_sent_at`, `whatsapp_status` columns
- [ ] Update Drizzle schema with new columns

### Environment Variables
- [ ] Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
- [ ] Configure REPORT_TOKEN_SECRET, NEXT_PUBLIC_APP_URL

### Error Handling
- [ ] Handle all report generation failure scenarios (no data, OpenAI failure, DB failure)
- [ ] Handle report page errors (invalid token, expired token, generating state)
- [ ] Implement phone number masking in logs

### Tests
- [ ] Unit tests for calorie estimation (male, female, fallback, edge cases)
- [ ] Unit tests for zone detection and time calculation
- [ ] Unit tests for template builder and report token generation
- [ ] Integration tests for report pipeline, WhatsApp flow, retry, skip conditions
- [ ] Integration tests for report API endpoints
