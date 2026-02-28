# Spec 09 — Local Agent (Mini PC): Plan por Partes

> **Spec file:** [local_agent_spec.md](../local_agent_spec.md)
> **Priority:** 5
> **Total parts:** 5
> **Estimated tests:** ~120
> **Package:** Separate `agent/` directory within monorepo (standalone, no imports from main app)

## Context

**What already exists:**
- WebSocket server (Spec 08): `ws-server.ts` with ConnectionManager, GymStateManager, BatchWriter, AutoSession
- Agent WS handler: `lib/ws/agent-handler.ts` — auth via first message, `hr-data` streaming, heartbeat handling
- Agent HTTP endpoints: `app/api/agent/heartbeat/route.ts` and `app/api/agent/status/route.ts`
- Agent validation schemas: `lib/validations/agent.ts` (HeartbeatBodySchema, StatusBodySchema)
- WS protocol types: `lib/ws/types.ts` (AgentInbound, AgentOutbound messages)
- BurnApp reference code: `/Users/csarsalinas/AI Coding/burnapp/src/` (ant-reader.js, device-manager.js to port)

**What this spec builds:**
- Standalone agent package (`agent/`) — runs on mini PC at each gym
- ANT+ heart rate sensor reader (multi-dongle support)
- Device manager with three-state lifecycle + HR zone calculation
- VPS client with WebSocket + HTTP dual-channel communication + offline buffer
- Local dashboard (minimal HTTP server for gym staff)
- PM2 deployment config + setup/update scripts

**Out of scope:**
- Changes to the VPS WebSocket server (already complete)
- Changes to agent HTTP API endpoints (already complete)
- TV Dashboard (Spec 07)

## CRITICAL: Spec-vs-Reality Discrepancies

The spec was written BEFORE the WS server and API endpoints were implemented. This plan uses the **ACTUAL** server contracts. Key differences:

| Area | Spec Says | Actual Server |
|------|-----------|---------------|
| WS auth | Query params on URL | First message: `{ type: "agent-auth", agentId, secret }` → `{ type: "auth-ok", gymId }` |
| WS HR data | `hr-update` with `readings[]`, zones, sequenceNumber | `hr-data` with `devices: Record<sensorId, { bpm, deviceActive }>` |
| WS keepalive | VPS sends `ping` | Agent sends `{ type: "heartbeat" }` |
| HTTP heartbeat body | `HrBatchPayload` with readings array | `{ agentId, gymId, devices: Record<id, {bpm,beatTime,beatCount,deviceActive}>, timestamp }` |
| HTTP heartbeat response | `{ received, athleteMappings }` | `{ ok: true, sessionId: string \| null }` |
| HTTP status body | 11 fields | 6 fields: `{ agentId, gymId, status, softwareVersion, uptime, connectedSensors, ipAddress }` |
| HTTP status values | "online"/"degraded"/"offline" | "online"/"degraded"/"error" |
| Session management | Agent generates UUID locally, sends session-start/end | Server auto-creates sessions (heartbeat endpoint + auto-session WS module) |
| Incoming VPS msgs | athlete-mapping, config-update, force-session-end, ping | Only `auth-ok` after auth |

## Parallelization Graph

```
Part A: Foundation (types, config, logger, package setup) ← sequential
         │
    ┌────┼────┐
    v    v    v
Part B  Part C  Part D  ← 3 independent modules, parallel agents
ANT+   DevMgr  VpsClient
    └────┼────┘
         v
Part E: Orchestrator + Local Dashboard + Integration ← sequential
```

**Optimal execution:**
1. Part A sequentially (lead)
2. Parts B, C, D in parallel (3 agents with `isolation: "worktree"`)
3. Part E sequentially (lead) — merge + orchestrator + dashboard

---

## Part A: Foundation (~18 tests)

**Status:** `[ ]`

**Execution:** Sequential (lead). Must complete before B/C/D can start.

### Files to Create

| File | Description |
|------|-------------|
| `agent/package.json` | Deps: `ws`, `dotenv`, `ant-plus`, `usb`; devDeps: `vitest`, `typescript`, `@types/ws`, `bun-types` |
| `agent/tsconfig.json` | Strict, ESM, target ES2022, outDir ./dist |
| `agent/vitest.config.ts` | Environment: `node` (NOT jsdom) |
| `agent/.env.example` | All env vars with docs |
| `agent/src/types.ts` | All interfaces — **corrected for actual protocol** |
| `agent/src/config.ts` | `loadConfig()` + `requireEnv()` + `validateConfig()` |
| `agent/src/logger.ts` | Structured logger (debug/info/warn/error, debug suppressed in prod) |
| `agent/tests/config.test.ts` | 12 tests |
| `agent/tests/logger.test.ts` | 6 tests |

### Key Decisions

1. Agent is a standalone package — NO imports from `@/lib/*`
2. `types.ts` uses ACTUAL WS protocol types (`AgentAuthMessage`, `AgentHRDataMessage`, `AgentHeartbeatMessage`, `AuthOkMessage`) and ACTUAL HTTP schemas
3. Logger: structured JSON via console methods (same pattern as `lib/logger.ts` but independent copy)
4. Vitest environment: `node` (agent runs on mini PC, no DOM)

### Reference Files

- `lib/logger.ts` — logger pattern
- `lib/ws/types.ts` — WS protocol types
- `lib/validations/agent.ts` — HTTP body schemas

### Tests (18)

**config.test.ts (12):**
- `loadConfig()` returns valid config from env vars
- `loadConfig()` throws if VPS_URL missing
- `loadConfig()` throws if AGENT_ID missing
- `loadConfig()` throws if AGENT_SECRET missing
- `loadConfig()` throws if GYM_ID missing
- `loadConfig()` uses defaults for optional vars (WS_PORT, HTTP_INTERVAL, etc.)
- `loadConfig()` parses numeric env vars correctly
- `loadConfig()` rejects invalid numeric values
- `validateConfig()` rejects empty strings
- `validateConfig()` rejects invalid URLs
- `requireEnv()` returns value when set
- `requireEnv()` throws descriptive error when missing

**logger.test.ts (6):**
- Logger outputs JSON format
- Logger includes timestamp
- Logger includes level field
- Logger suppresses debug in production
- Logger shows debug in development
- Logger includes context fields when provided

---

## Part B: ANT+ Reader (~25 tests)

**Status:** `[ ]`

**Execution:** Parallel agent (after Part A completes).

### Files

- `agent/src/ant-reader.ts` — ANT+ sensor reader (multi-dongle)
- `agent/tests/ant-reader.test.ts` — 25 tests

### Port From

`burnapp/src/ant-reader.js` (454 lines)

### Port Changes

| From (BurnApp) | To (BeatMind Agent) |
|-----------------|---------------------|
| CommonJS (`require`) | ESM (`import`) |
| Single dongle | Multi-dongle enumeration via `usb.getDeviceList()` (vendor `0x0fcf`) |
| `deviceId` | `sensorId` |
| `console.log` | Structured logger |
| Event `data` | Event `hr-data` |
| Event `device-found` | Event `sensor-detected` |

### Key Features

- Multi-dongle enumeration via `usb.getDeviceList()` (vendor `0x0fcf`)
- Per-dongle reconnection (5s fixed interval)
- Sensor deduplication across dongles (`Map<sensorId, dongleIndex>`)
- Events: `stick-ready`, `stick-error`, `stick-closed`, `sensor-detected`, `hr-data`, `sensor-lost`

### Mocking Strategy

Full mock of `ant-plus` (GarminStick2/3, HeartRateScanner) and `usb.getDeviceList()`. Native C++ modules cannot be loaded in test — must be fully mocked.

### Tests (25)

- Discovers single ANT+ dongle
- Discovers multiple ANT+ dongles
- Handles zero dongles gracefully
- Opens stick successfully → emits `stick-ready`
- Handles stick open error → emits `stick-error`
- Retries stick connection after 5s on failure
- Starts HeartRateScanner after stick ready
- Receives HR data → emits `hr-data` with sensorId + bpm
- Deduplicates sensor across multiple dongles
- Tracks sensor → emits `sensor-detected`
- Detects sensor loss → emits `sensor-lost`
- Handles stick closed → emits `stick-closed`
- Reconnects after stick closed
- `start()` initializes all dongles
- `stop()` closes all sticks and scanners
- `stop()` clears reconnection timers
- `getConnectedSensors()` returns active sensor list
- `getSensorCount()` returns correct count
- Handles USB permission error
- Handles multiple HR events from same sensor
- Handles HR events with bpm=0 (sensor contact lost)
- Filters invalid bpm values (negative, >250)
- Handles rapid dongle disconnect/reconnect
- Emits events with correct payload shape
- Does not crash when stick already closed

---

## Part C: Device Manager (~22 tests)

**Status:** `[ ]`

**Execution:** Parallel agent (after Part A completes).

### Files

- `agent/src/device-manager.ts` — Device lifecycle + HR zone calculation
- `agent/tests/device-manager.test.ts` — 22 tests

### Port From

`burnapp/src/device-manager.js` (219 lines)

### Port Changes

| From (BurnApp) | To (BeatMind Agent) |
|-----------------|---------------------|
| `deviceId` | `sensorId` |
| `"Atleta N"` | `"Athlete N"` |
| Boolean active | Three-state lifecycle (Active → Inactive → Removed) |
| `percentage` | `hrMaxPercent` |
| External zone import | Inline HR zone calculation |

### Key Features

- Three-state lifecycle: Active → Inactive (30s no data) → Removed (2min no data)
- Inline HR zone calculation (same constants as `lib/hr/zones.ts`, English zone names)
- 60s rolling sparkline history
- Events: `device-update`, `device-added`, `device-inactive`, `device-removed`
- API: `attachToReader()`, `getAllDevicesSnapshot()`, `getActiveCount()`, `setMaxHr()`, `setAthleteName()`

### Reference

- `lib/hr/zones.ts` — Zone constants to inline (do NOT import, agent is standalone)

### Tests (22)

- Creates new device on first HR data
- Emits `device-added` for new sensor
- Updates existing device with new HR data
- Emits `device-update` on HR data
- Calculates HR zone correctly (zone 1-5 boundaries)
- Calculates hrMaxPercent from maxHr
- Uses default maxHr (220 - assumed age) when not set
- `setMaxHr()` updates zone calculation
- `setAthleteName()` updates device name
- Marks device inactive after 30s no data
- Emits `device-inactive` event
- Removes device after 2min no data
- Emits `device-removed` event
- Reactivates inactive device on new data
- Maintains 60s sparkline history
- Trims sparkline beyond 60 entries
- `getAllDevicesSnapshot()` returns all devices
- `getActiveCount()` counts only active devices
- `attachToReader()` wires events correctly
- Handles rapid HR updates (debounce)
- Handles bpm=0 (marks as no contact, keeps device)
- `stop()` clears all timers and state

---

## Part D: VPS Client (~30 tests)

**Status:** `[ ]`

**Execution:** Parallel agent (after Part A completes).

### Files

- `agent/src/vps-client.ts` — WebSocket + HTTP dual-channel VPS communication
- `agent/tests/vps-client.test.ts` — 30 tests

### Port From

Entirely new (no BurnApp equivalent). Uses ACTUAL server contracts.

### Three Communication Channels

**1. WebSocket (1s interval):**
- Connect to `/ws/agent`
- Send `{ type: "agent-auth", agentId, secret }` as first message
- Receive `{ type: "auth-ok", gymId }` on success
- Stream `{ type: "hr-data", devices: Record<sensorId, { bpm, deviceActive }> }` every 1s
- Send `{ type: "heartbeat" }` every 25s as keepalive
- Exponential backoff reconnect: 1s → 2s → 4s → 8s → 16s → 30s (max)

**2. HTTP Heartbeat (5s interval):**
- `POST /api/agent/heartbeat`
- Body: `{ agentId, gymId, devices: Record<id, {bpm, beatTime, beatCount, deviceActive}>, timestamp }`
- Headers: `X-Agent-Id`, `X-Agent-Secret`, `X-Gym-Id`
- Response: `{ ok: true, sessionId: string | null }`
- Always runs (backup persistence path, independent of WS)

**3. HTTP Status (30s interval):**
- `POST /api/agent/status`
- Body: `{ agentId, gymId, status, softwareVersion, uptime, connectedSensors, ipAddress }`
- Headers: `X-Agent-Id`, `X-Agent-Secret`, `X-Gym-Id`
- Status values: `"online"` / `"degraded"` / `"error"`

### Offline Buffer

- Circular buffer (600 entries = 10min at 1s interval)
- FIFO eviction when full
- Flush buffered data on WS reconnect

### Mocking Strategy

- Mock `ws` WebSocket class (connect, send, close, events)
- Mock `fetch` for HTTP endpoints
- `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` (NOT `vi.runAllTimersAsync()` — infinite loop gotcha with setInterval)

### Reference Files

- `lib/ws/types.ts` — WS protocol message types
- `lib/ws/agent-handler.ts` — Server-side agent handler (to understand expected messages)
- `app/api/agent/heartbeat/route.ts` — HTTP heartbeat endpoint
- `app/api/agent/status/route.ts` — HTTP status endpoint
- `lib/validations/agent.ts` — Validation schemas for HTTP bodies

### Tests (30)

**WebSocket (12):**
- Connects to correct WS URL
- Sends auth message as first message after connect
- Handles `auth-ok` response → marks connected
- Handles auth failure (close code 4001) → does not retry immediately
- Handles auth failure (close code 4002) → agent not found
- Handles auth failure (close code 4003) → gym mismatch
- Sends `hr-data` message every 1s when connected
- Sends `heartbeat` keepalive every 25s
- Reconnects with exponential backoff on disconnect
- Backoff resets after successful connection
- Caps backoff at 30s
- Flushes offline buffer on reconnect

**HTTP Heartbeat (8):**
- Sends heartbeat POST every 5s
- Includes correct headers (X-Agent-Id, X-Agent-Secret, X-Gym-Id)
- Includes device data in body
- Handles successful response
- Handles network error gracefully (no crash)
- Handles 401 response (invalid credentials)
- Continues sending even when WS is connected (dual-channel)
- Sends empty devices when no sensors connected

**HTTP Status (5):**
- Sends status POST every 30s
- Includes correct 6-field body
- Reports "online" when WS connected + sensors active
- Reports "degraded" when WS disconnected but HTTP working
- Reports "error" on persistent failures

**Offline Buffer (5):**
- Buffers HR data when WS disconnected
- Evicts oldest entries when buffer full (600 max)
- Flushes buffer in order on reconnect
- Clears buffer after successful flush
- Does not buffer when WS connected

---

## Part E: Orchestrator + Local Dashboard + Integration (~25 tests)

**Status:** `[ ]`

**Execution:** Sequential (lead). Runs after Parts B/C/D are merged.

### Files to Create

| File | Description |
|------|-------------|
| `agent/src/local-dashboard.ts` | Minimal HTTP server (no Express): `/`, `/api/devices`, `/api/status`, `/health` |
| `agent/src/index.ts` | Entry point: load config → init modules → wire together → signal handlers |
| `agent/ecosystem.config.js` | PM2 config for agent process (bun interpreter, 256M limit) |
| `agent/setup.sh` | Initial deployment script |
| `agent/update.sh` | Remote update script |
| `agent/udev/99-ant-usb.rules` | Linux USB permissions for ANT+ dongles |
| `agent/tests/local-dashboard.test.ts` | 10 tests |
| `agent/tests/index.test.ts` | 15 tests |

### Key Decisions

1. Local dashboard is self-contained HTML (inline CSS/JS, no build step, polls `/api/devices` every 1s)
2. Orchestrator does NOT manage sessions — server handles it via auto-session
3. Wiring: AntReader → DeviceManager → VpsClient.sendHRData()
4. Graceful shutdown: SIGINT/SIGTERM → stop all modules in order (VPS → DeviceManager → AntReader → Dashboard)

### Tests (25)

**local-dashboard.test.ts (10):**
- Starts HTTP server on configured port
- Serves HTML dashboard on GET /
- Returns device list on GET /api/devices
- Returns agent status on GET /api/status
- Returns 200 on GET /health
- Returns 404 for unknown routes
- Includes CORS headers for local access
- Dashboard HTML includes auto-refresh script
- `stop()` closes HTTP server
- Handles port-in-use error

**index.test.ts (15):**
- Loads config from environment
- Initializes AntReader
- Initializes DeviceManager
- Initializes VpsClient
- Initializes LocalDashboard
- Wires AntReader → DeviceManager (attachToReader)
- Wires DeviceManager events → VpsClient.sendHRData
- Starts all modules in correct order
- Handles SIGINT gracefully
- Handles SIGTERM gracefully
- Stops modules in reverse order on shutdown
- Logs startup summary
- Handles AntReader initialization failure
- Handles VpsClient connection failure (continues with HTTP only)
- Handles config validation failure (exits with code 1)

---

## Test Summary

| Part | Files | Tests |
|------|-------|------:|
| A — Foundation | config.test.ts, logger.test.ts | 18 |
| B — ANT+ Reader | ant-reader.test.ts | 25 |
| C — Device Manager | device-manager.test.ts | 22 |
| D — VPS Client | vps-client.test.ts | 30 |
| E — Orchestrator + Dashboard | local-dashboard.test.ts, index.test.ts | 25 |
| **Total** | | **~120** |

## Execution Sequence

```
PHASE 1 — Tracking:      Mark [~] in INDEX.md + TASKS.md
PHASE 2 — Part A:        Foundation (lead, sequential) — ~18 tests
PHASE 3 — Parts B/C/D:   3 parallel agents with isolation: "worktree"
PHASE 4 — Part E:        Merge + orchestrator + dashboard (lead) — ~25 tests
PHASE 5 — Tracking:      Mark [x], move spec to done/, log COMPLETED
```

## Anticipated Gotchas

1. **`ant-plus`/`usb` are native C++ modules** — must be fully mocked in tests, may have Bun compatibility issues at runtime (test with Node fallback)
2. **`vi.runAllTimersAsync()` infinite loops with active setInterval** — use `vi.advanceTimersByTimeAsync()` in steps instead
3. **Agent tests must run independently from main app** — separate `vitest.config.ts` in `agent/`, separate `bun run test` script
4. **WS mock needs to simulate close codes** (4001, 4002, 4003) for auth failure tests
5. **`hrMaxPercent` is decimal** — insert as String(), not number (learned from Spec 03)
6. **Module-level setInterval** — export manual trigger for tests, don't rely on timer auto-cleanup
7. **Bun binary path** — may not be in PATH on mini PC, use `~/.bun/bin/bun` in PM2 config
