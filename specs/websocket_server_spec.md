# WebSocket Server Specification

**Project:** BeatMind AI
**Version:** 1.0
**Date:** 2026-02-26
**Status:** Draft

---

## 1. Overview

BeatMind AI requires persistent WebSocket connections for real-time heart rate streaming from gym agents (mini PCs) to TV display clients. Next.js does not support persistent WebSocket connections in its route handlers -- HTTP route handlers are stateless and short-lived by design. Therefore, a **separate standalone WebSocket server process** (`ws-server.ts`) runs alongside the Next.js application on the same VPS.

Both processes share the same PostgreSQL database. Both are managed by PM2 as a single deployment unit with independent restart policies.

**Key responsibilities of the WebSocket server:**
- Accept inbound connections from local agents (mini PCs in gyms)
- Accept inbound connections from TV display clients (browsers)
- Authenticate each connection type using its respective auth mechanism
- Maintain in-memory state per gym (device data, athlete mappings, session info)
- Enrich raw sensor data with athlete profiles and HR zone calculations
- Broadcast enriched data to all TV clients for a given gym
- Batch-insert raw HR readings into PostgreSQL every 5 seconds
- Relay AI coaching messages to TV clients

---

## 2. Architecture

### 2.1 Process Model

```
VPS (single machine)
=============================================
|                                           |
|  PM2 Process Manager                      |
|  ├── next-app (Next.js 16, port 3000)     |
|  └── ws-server (ws-server.ts, port 3001)  |
|                                           |
|  Shared: PostgreSQL (localhost:5432)       |
=============================================
```

### 2.2 Technology

| Component        | Choice                        |
|------------------|-------------------------------|
| Runtime          | Node.js or Bun (TypeScript)   |
| WebSocket lib    | `ws` (npm package)            |
| HTTP server      | Node.js `http.createServer`   |
| Port             | 3001 (configurable via env)   |
| Process manager  | PM2                           |
| Database driver  | Shared Drizzle ORM config     |
| Language         | TypeScript (strict mode)      |

### 2.3 Entry Point

File: `ws-server.ts` (project root)

```typescript
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { ConnectionManager } from "./lib/ws/manager";
import { GymStateManager } from "./lib/ws/gym-state";
import { db } from "./lib/db";

const PORT = parseInt(process.env.WS_PORT || "3001", 10);

const httpServer = createServer((req, res) => {
  // Health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });
const gymState = new GymStateManager(db);
const connectionManager = new ConnectionManager(wss, gymState, db);

connectionManager.start();

httpServer.listen(PORT, () => {
  console.log(`[WS Server] Listening on port ${PORT}`);
});
```

### 2.4 File Structure

```
beat-mind-ai/
  ws-server.ts                  # Entry point for the WS process
  lib/
    ws/
      manager.ts                # Connection lifecycle management
      gym-state.ts              # In-memory gym state (devices, athletes, sessions)
      agent-handler.ts          # Handles agent WS messages
      tv-handler.ts             # Handles TV WS connections
      auth.ts                   # WS authentication logic
      types.ts                  # Shared WS message type definitions
      batch-writer.ts           # Batched HR data persistence
```

---

## 3. Connection Types

### 3.1 Agent Connection (Mini PC to VPS)

**Endpoint:** `ws://VPS:3001/ws/agent`
**Direction:** Agent initiates connection to VPS
**Purpose:** Stream real-time HR data from ANT+ sensors to the central platform

#### Authentication

Authentication occurs on the **first message** after connection is established. The connection is untrusted until authentication succeeds.

```
Agent connects to ws://VPS:3001/ws/agent
   |
   ├── Agent sends first message (must be auth):
   |   {
   |     "type": "auth",
   |     "agentId": "uuid-of-agent",
   |     "agentSecret": "secret-string"
   |   }
   |
   ├── Server validates against `agents` table in PostgreSQL:
   |   SELECT id, gym_id, status FROM agents
   |   WHERE id = $agentId AND agent_secret = $agentSecret AND status = 'active'
   |
   ├── SUCCESS: Server responds { "type": "auth-ok", "gymId": "..." }
   |   Connection is now authenticated and registered
   |
   └── FAILURE: Server sends { "type": "auth-error", "reason": "..." }
       Connection closed with code 4001
```

**Auth timeout:** If no auth message is received within 5 seconds of connection, close with code 4002.

#### Messages: Agent to Server

**HR Data (every 1 second):**

```typescript
interface AgentHRDataMessage {
  type: "hr-data";
  timestamp: string;               // ISO 8601
  devices: {
    [sensorId: string]: {
      bpm: number;                 // Current heart rate (0 if no signal)
      beatTime: number;            // Time of last beat in ms
      beatCount: number;           // Cumulative beat counter
      deviceActive: boolean;       // Whether sensor is transmitting
    };
  };
}
```

**Heartbeat (every 30 seconds):**

```typescript
interface AgentHeartbeatMessage {
  type: "heartbeat";
  status: "online";
  timestamp: string;               // ISO 8601
  meta?: {
    cpuUsage?: number;
    memoryUsage?: number;
    uptimeSeconds?: number;
    softwareVersion?: string;
    connectedSensors?: number;
  };
}
```

#### Messages: Server to Agent

**Auth Response:**

```typescript
interface AuthOkMessage {
  type: "auth-ok";
  gymId: string;
}

interface AuthErrorMessage {
  type: "auth-error";
  reason: string;
}
```

**Configuration Update (optional, future):**

```typescript
interface ConfigUpdateMessage {
  type: "config-update";
  config: Record<string, unknown>;
}
```

### 3.2 TV Connection (VPS to TV Display)

**Endpoint:** `ws://VPS:3001/ws/tv/[gymId]?token=TOKEN`
**Direction:** TV browser client initiates connection to VPS
**Purpose:** Receive enriched HR data and AI coaching messages for display

#### Authentication

Authentication occurs at connection time via query parameter. The token is validated before the WebSocket upgrade completes.

```
TV connects to ws://VPS:3001/ws/tv/abc-gym-id?token=TOKEN
   |
   ├── Server extracts gymId from URL path and token from query string
   |
   ├── Server validates against `gyms` table:
   |   SELECT id, name, slug, primary_color, secondary_color, logo_url
   |   FROM gyms
   |   WHERE id = $gymId AND tv_access_token = $token
   |     AND subscription_status = 'active'
   |
   ├── SUCCESS: WebSocket upgrade proceeds
   |   Server sends initial state: { "type": "init", gymConfig: {...}, currentDevices: {...} }
   |
   └── FAILURE: HTTP 401 returned, WebSocket upgrade rejected
```

#### Messages: Server to TV

**HR Update (every 1 second, when agent is connected):**

```typescript
interface TVHRUpdateMessage {
  type: "hr-update";
  timestamp: string;
  sessionId: string | null;
  devices: {
    [sensorId: string]: {
      bpm: number;
      beatTime: number;
      beatCount: number;
      deviceActive: boolean;
      // Enriched fields (from athlete profile + HR zone calculation)
      athleteId: string | null;
      athleteName: string | null;
      hrZone: number;               // 1-5
      hrZoneName: string;           // "Rest", "Fat Burn", "Cardio", "Hard", "Peak"
      hrZoneColor: string;          // "#3B82F6", "#22C55E", "#EAB308", "#F97316", "#EF4444"
      hrMaxPercent: number;         // 0-100, percentage of athlete's max HR
      maxHR: number;                // Athlete's configured max HR
    };
  };
}
```

**AI Coaching (periodic, during active sessions):**

```typescript
interface TVAICoachingMessage {
  type: "ai-coaching";
  sessionId: string;
  analysis: string;                  // Coach Pulse message text
  athleteId?: string;                // If message targets a specific athlete
  athleteName?: string;
  model: string;                     // e.g. "gpt-4o-mini"
  timestamp: string;
}
```

**Session Events:**

```typescript
interface TVSessionEventMessage {
  type: "session-event";
  event: "started" | "ended" | "paused";
  sessionId: string;
  classType?: string;                // "spinning", "pilates", "cycling"
  trainerName?: string;
  timestamp: string;
}
```

**Initial State (sent once on connection):**

```typescript
interface TVInitMessage {
  type: "init";
  gymConfig: {
    gymId: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    language: string;                // "es" | "pt"
  };
  currentDevices: TVHRUpdateMessage["devices"];
  activeSession: {
    sessionId: string;
    classType: string;
    startedAt: string;
    trainerName: string | null;
  } | null;
}
```

#### Messages: TV to Server

TV clients are primarily receive-only. The only message type supported from TV is a keepalive pong (handled automatically by the `ws` library's ping/pong mechanism). No application-level messages are expected from TV clients.

---

## 4. Gym State Manager

**File:** `lib/ws/gym-state.ts`

The Gym State Manager maintains an in-memory representation of each gym's current real-time state. This avoids querying the database on every 1-second HR update cycle.

### 4.1 State Structure

```typescript
interface GymState {
  gymId: string;
  gymConfig: {
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    language: string;
    timezone: string;
  };

  // Sensor-to-athlete mapping (loaded from athlete_bands table)
  sensorAthleteMap: Map<number, AthleteProfile>;

  // Current device readings (updated every 1s)
  currentDevices: Map<number, EnrichedDeviceData>;

  // Active session info
  activeSession: {
    sessionId: string;
    classType: string;
    startedAt: Date;
    trainerId: string | null;
    trainerName: string | null;
  } | null;

  // Metadata
  lastAgentHeartbeat: Date | null;
  agentStatus: "online" | "offline";
  loadedAt: Date;
}

interface AthleteProfile {
  athleteId: string;
  name: string;
  age: number | null;
  weightKg: number | null;
  maxHR: number;                    // Default 190 if not set
}

interface EnrichedDeviceData {
  sensorId: number;
  bpm: number;
  beatTime: number;
  beatCount: number;
  deviceActive: boolean;
  athleteId: string | null;
  athleteName: string | null;
  hrZone: number;
  hrZoneName: string;
  hrZoneColor: string;
  hrMaxPercent: number;
  maxHR: number;
  lastUpdated: Date;
}
```

### 4.2 Lifecycle

1. **Initialization:** When the first connection (agent or TV) for a gym arrives, the gym state is loaded from the database:
   - Gym profile from `gyms` table
   - Sensor-to-athlete mappings from `athlete_bands` joined with `athletes` (where `is_active = true`)
   - Active session from `sessions` table (where `status = 'active'`)

2. **Update:** On each `hr-data` message from the agent:
   - Iterate over all devices in the message
   - Look up athlete profile from `sensorAthleteMap`
   - Calculate HR zone, zone name, zone color, and % max HR using `lib/hr/zones.ts`
   - Update `currentDevices` map
   - Mark devices not present in the latest message as `deviceActive: false` after 5 seconds of absence

3. **Refresh:** The sensor-to-athlete mapping is refreshed:
   - On explicit cache invalidation (triggered when gym owner updates athlete-band assignments via the Next.js API)
   - Every 5 minutes as a safety net (periodic reload from DB)
   - Refresh is triggered via an internal HTTP endpoint on the WS server or a PostgreSQL LISTEN/NOTIFY channel

4. **Eviction:** Gym state is evicted from memory when:
   - No agent and no TV connections exist for that gym for 10 minutes
   - This prevents unbounded memory growth

### 4.3 HR Zone Calculation

The enrichment logic uses the shared `lib/hr/zones.ts` utility:

```typescript
function calculateHRZone(bpm: number, maxHR: number): {
  zone: number;          // 1-5
  zoneName: string;
  zoneColor: string;
  maxPercent: number;    // 0-100
} {
  const percent = Math.round((bpm / maxHR) * 100);

  if (percent < 60) return { zone: 1, zoneName: "Rest", zoneColor: "#3B82F6", maxPercent: percent };
  if (percent < 70) return { zone: 2, zoneName: "Fat Burn", zoneColor: "#22C55E", maxPercent: percent };
  if (percent < 80) return { zone: 3, zoneName: "Cardio", zoneColor: "#EAB308", maxPercent: percent };
  if (percent < 90) return { zone: 4, zoneName: "Hard", zoneColor: "#F97316", maxPercent: percent };
  return { zone: 5, zoneName: "Peak", zoneColor: "#EF4444", maxPercent: percent };
}
```

---

## 5. Connection Manager

**File:** `lib/ws/manager.ts`

The Connection Manager is responsible for the full lifecycle of all WebSocket connections and acts as the central coordinator between agents, TV clients, and the Gym State Manager.

### 5.1 Internal Data Structures

```typescript
class ConnectionManager {
  // All agent connections, keyed by gymId (one agent per gym)
  private agentConnections: Map<string, AgentConnection>;

  // All TV connections, keyed by gymId -> Set of TV connections
  private tvConnections: Map<string, Set<TVConnection>>;

  // Reference to gym state manager
  private gymState: GymStateManager;

  // Reference to batch writer
  private batchWriter: BatchWriter;

  // Reference to database
  private db: Database;
}

interface AgentConnection {
  ws: WebSocket;
  gymId: string;
  agentId: string;
  connectedAt: Date;
  lastMessageAt: Date;
  authenticated: boolean;
}

interface TVConnection {
  ws: WebSocket;
  gymId: string;
  connectedAt: Date;
  lastPongAt: Date;
}
```

### 5.2 Connection Routing

When a new WebSocket connection arrives, the URL path determines the handler:

```typescript
wss.on("connection", (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);

  if (url.pathname === "/ws/agent") {
    this.handleAgentConnection(ws, req);
  } else if (url.pathname.startsWith("/ws/tv/")) {
    this.handleTVConnection(ws, req, url);
  } else {
    ws.close(4000, "Unknown endpoint");
  }
});
```

### 5.3 Agent Connection Lifecycle

```
1. Agent connects to /ws/agent
2. Start 5s auth timer
3. Wait for first message
4. If first message is not { type: "auth" } -> close 4001
5. Validate agentId + agentSecret against DB
6. If invalid -> send auth-error, close 4001
7. If valid:
   a. Cancel auth timer
   b. Send auth-ok with gymId
   c. Register in agentConnections map
   d. Initialize gym state (if not already loaded)
   e. Update agents.last_heartbeat and agents.status = 'online' in DB
   f. Start listening for hr-data and heartbeat messages
8. On each hr-data message:
   a. Pass to GymStateManager.processHRData(gymId, devices)
   b. Get enriched data back
   c. Broadcast enriched data to all TV connections for this gym
   d. Queue raw data for batch insert
9. On each heartbeat message:
   a. Update agents.last_heartbeat in DB
   b. Update GymState.lastAgentHeartbeat
10. On disconnect:
    a. Remove from agentConnections
    b. Start 60s offline timer
    c. If no reconnect within 60s:
       - Update agents.status = 'offline' in DB
       - Mark GymState.agentStatus = 'offline'
       - Notify superadmin (via DB flag or webhook)
```

### 5.4 TV Connection Lifecycle

```
1. TV connects to /ws/tv/[gymId]?token=TOKEN
2. Extract gymId from URL path, token from query string
3. Validate token against gyms.tv_access_token in DB
4. If invalid -> reject upgrade with HTTP 401
5. If valid:
   a. Complete WebSocket upgrade
   b. Add to tvConnections set for this gymId
   c. Initialize gym state (if not already loaded)
   d. Send "init" message with gym config + current device state + active session
   e. Start ping interval (every 30s)
6. On pong received:
   a. Update lastPongAt timestamp
7. On disconnect:
   a. Remove from tvConnections set
   b. If no more connections for this gym, start eviction timer
8. On ping timeout (no pong for 60s):
   a. Close connection
   b. Clean up as in disconnect
```

### 5.5 Broadcasting

```typescript
broadcastToGym(gymId: string, message: object): void {
  const tvs = this.tvConnections.get(gymId);
  if (!tvs || tvs.size === 0) return;

  const payload = JSON.stringify(message);

  for (const tv of tvs) {
    if (tv.ws.readyState === WebSocket.OPEN) {
      tv.ws.send(payload);
    }
  }
}
```

### 5.6 Health Monitoring

A periodic health check runs every 30 seconds:

```typescript
setInterval(() => {
  // Ping all TV connections
  for (const [gymId, tvs] of this.tvConnections) {
    for (const tv of tvs) {
      if (Date.now() - tv.lastPongAt.getTime() > 60_000) {
        tv.ws.terminate();
        tvs.delete(tv);
        continue;
      }
      tv.ws.ping();
    }
  }

  // Check agent connections
  for (const [gymId, agent] of this.agentConnections) {
    if (Date.now() - agent.lastMessageAt.getTime() > 60_000) {
      agent.ws.terminate();
      this.handleAgentDisconnect(gymId, agent.agentId);
    }
  }
}, 30_000);
```

---

## 6. Data Flow

### 6.1 Real-Time HR Pipeline (Target Latency: < 2 seconds)

```
HR Band
  -> ANT+ Dongle (USB)
  -> ant-reader.ts on Mini PC
  -> device-manager.ts aggregates devices
  -> vps-client.ts sends via WebSocket every 1s
  -> WS Server receives on /ws/agent
  -> GymStateManager.processHRData():
       - Maps sensor_id -> athlete profile
       - Calculates HR zone, zone name, zone color, % max HR
       - Updates in-memory currentDevices
  -> ConnectionManager.broadcastToGym():
       - Serializes enriched data as TVHRUpdateMessage
       - Sends to all TV WebSocket clients for this gym
  -> TV React app receives and renders athlete cards
```

### 6.2 Database Persistence (Batch Insert)

**File:** `lib/ws/batch-writer.ts`

Raw HR readings are NOT written to the database on every 1-second tick. Instead, they are buffered and batch-inserted every 5 seconds to reduce database load.

```typescript
class BatchWriter {
  private buffer: Map<string, HRReading[]>;   // Keyed by gymId
  private flushInterval: NodeJS.Timer;

  constructor(db: Database) {
    this.buffer = new Map();
    this.flushInterval = setInterval(() => this.flush(), 5_000);
  }

  enqueue(gymId: string, readings: HRReading[]): void {
    const existing = this.buffer.get(gymId) || [];
    existing.push(...readings);
    this.buffer.set(gymId, existing);
  }

  private async flush(): Promise<void> {
    for (const [gymId, readings] of this.buffer) {
      if (readings.length === 0) continue;

      try {
        // Batch insert using Drizzle
        await db.insert(hrReadings).values(readings);
        this.buffer.set(gymId, []);
      } catch (error) {
        console.error(`[BatchWriter] Failed to flush for gym ${gymId}:`, error);
        // Readings stay in buffer for next attempt
        // If buffer exceeds 1000 readings, drop oldest
        if (readings.length > 1000) {
          this.buffer.set(gymId, readings.slice(-500));
          console.warn(`[BatchWriter] Buffer overflow for gym ${gymId}, dropped oldest readings`);
        }
      }
    }
  }

  shutdown(): Promise<void> {
    clearInterval(this.flushInterval);
    return this.flush(); // Final flush on shutdown
  }
}
```

**HRReading shape (matches `hr_readings` table):**

```typescript
interface HRReading {
  sessionId: string | null;
  gymId: string;
  athleteId: string | null;
  sensorId: number;
  heartRateBpm: number;
  hrZone: number;
  hrZoneName: string;
  hrZoneColor: string;
  hrMaxPercent: number;
  beatTime: number;
  beatCount: number;
  deviceActive: boolean;
  recordedAt: Date;
}
```

### 6.3 AI Coaching Message Flow

AI coaching messages are generated by the Next.js application (server-side, using the OpenAI API) and need to reach TV clients through the WebSocket server. Two mechanisms are supported:

**Option A: Direct HTTP call from Next.js to WS Server (preferred)**

```
Next.js AI service (runs on timer during active session)
  -> Queries hr_readings for recent data
  -> Calls OpenAI API
  -> Stores message in ai_coaching_messages table
  -> POST http://localhost:3001/internal/broadcast
     Body: {
       gymId: "...",
       message: { type: "ai-coaching", analysis: "...", ... }
     }
  -> WS Server receives internal HTTP request
  -> Broadcasts to all TV clients for that gym
```

The internal HTTP endpoint is only accessible from localhost (bound to 127.0.0.1 or validated via a shared internal secret).

```typescript
// In ws-server.ts HTTP handler
if (req.url === "/internal/broadcast" && req.method === "POST") {
  const internalSecret = req.headers["x-internal-secret"];
  if (internalSecret !== process.env.WS_INTERNAL_SECRET) {
    res.writeHead(403);
    res.end();
    return;
  }

  // Parse body and broadcast
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const { gymId, message } = JSON.parse(body);
    connectionManager.broadcastToGym(gymId, message);
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
  });
}
```

**Option B: PostgreSQL LISTEN/NOTIFY (alternative)**

```
Next.js AI service stores message in ai_coaching_messages
  -> PostgreSQL trigger fires NOTIFY on channel 'ai_coaching'
  -> WS Server listens on 'ai_coaching' channel
  -> Receives notification with message payload
  -> Broadcasts to all TV clients for that gym
```

Option A is simpler and recommended for the initial implementation. Option B can be adopted later if the architecture grows to require more decoupling.

### 6.4 Session Events

Session start/end events originate from either the Next.js app (manual start/end by trainer) or the WS server itself (auto-session logic).

**Auto-session logic (in WS server):**

```
On first hr-data with bpm > 0 for a gym with no active session:
  -> Wait for 30s of sustained data from at least 1 sensor
  -> Create session in DB (status: 'active', class_type: 'auto')
  -> Update GymState.activeSession
  -> Broadcast { type: "session-event", event: "started" } to TVs

On 2 minutes of no active sensors (all bpm = 0 or no data):
  -> End session in DB (status: 'completed', ended_at, duration_seconds)
  -> Calculate session_athletes stats
  -> Clear GymState.activeSession
  -> Broadcast { type: "session-event", event: "ended" } to TVs
  -> Trigger post-session pipeline (reports, WhatsApp) via Next.js API call
```

**Manual session events (from Next.js API):**

The Next.js API calls the WS server's internal HTTP endpoint to notify it of manual session start/end:

```
POST http://localhost:3001/internal/session-event
Body: { gymId: "...", event: "started"|"ended", sessionId: "...", classType: "..." }
```

---

## 7. Scaling Considerations

### 7.1 Projected Load

| Metric                       | Value                           |
|------------------------------|---------------------------------|
| Target gyms (Year 1)        | 10                              |
| Connections per gym          | 1 agent + 1-3 TVs = 2-4        |
| Total concurrent connections | ~40-50                          |
| Messages per second (in)     | 10 (one hr-data per gym/sec)    |
| Messages per second (out)    | 10-30 (broadcast to TVs)        |
| Memory per gym state         | ~50 KB (20 athletes + devices)  |
| Total memory for state       | ~500 KB (10 gyms)               |

### 7.2 Single-Process Sufficiency

At the projected scale (50 connections, 40 messages/second), a single Node.js/Bun process on a modest VPS (2 CPU, 4 GB RAM) is more than sufficient. The `ws` library can handle thousands of concurrent connections.

No clustering, load balancing, or Redis pub/sub is needed at this scale.

### 7.3 Future Scaling Path (100+ gyms)

If BeatMind scales beyond a single VPS:

1. **Horizontal scaling:** Multiple WS server instances behind a load balancer with sticky sessions (by gymId)
2. **State coordination:** Redis pub/sub for cross-instance broadcasting
3. **Connection routing:** Consistent hashing to route gyms to specific WS instances
4. **Database:** Read replicas for gym state lookups, write primary for HR inserts

This is not needed for the initial implementation and should not be built prematurely.

---

## 8. Error Handling

### 8.1 Authentication Errors

| Scenario                     | Action                                          | WS Close Code |
|------------------------------|--------------------------------------------------|----------------|
| Agent: invalid credentials   | Send `auth-error`, close connection              | 4001           |
| Agent: auth timeout (5s)     | Close connection silently                        | 4002           |
| Agent: already connected gym | Close OLD connection, accept new one             | 4003           |
| TV: invalid token            | Reject HTTP upgrade with 401                     | N/A            |
| TV: gym subscription inactive| Reject HTTP upgrade with 403                     | N/A            |

### 8.2 Message Errors

| Scenario                     | Action                                          |
|------------------------------|--------------------------------------------------|
| Malformed JSON               | Log warning with connection ID, ignore message  |
| Unknown message type         | Log warning, ignore message                     |
| Missing required fields      | Log warning, ignore message                     |
| BPM out of range (< 0 or > 250) | Clamp to valid range, log warning           |

### 8.3 Database Errors

| Scenario                     | Action                                          |
|------------------------------|--------------------------------------------------|
| DB connection lost           | Buffer HR readings in memory (up to 1000/gym)   |
| DB connection restored       | Flush buffered readings                          |
| Batch insert fails           | Retain in buffer, retry on next flush cycle      |
| Buffer overflow              | Drop oldest 50% of readings, log error           |
| Gym state load fails         | Retry 3 times with 1s delay, close connection if persistent |

### 8.4 Connection Errors

| Scenario                     | Action                                          |
|------------------------------|--------------------------------------------------|
| Agent disconnect (unexpected)| Start 60s offline timer                          |
| Agent offline > 60s          | Update DB status to 'offline', notify superadmin |
| TV disconnect                | Remove from broadcast set, clean up              |
| TV pong timeout (60s)        | Terminate connection, clean up                   |
| WS server crash              | PM2 auto-restarts, agents/TVs auto-reconnect     |

### 8.5 Logging

All log entries include:

```typescript
interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  component: "agent-handler" | "tv-handler" | "gym-state" | "batch-writer" | "connection-manager";
  gymId?: string;
  agentId?: string;
  message: string;
  data?: Record<string, unknown>;
}
```

Use structured JSON logging (e.g., `pino` or `winston`) for production log aggregation.

---

## 9. PM2 Configuration

**File:** `ecosystem.config.js` (project root)

```javascript
module.exports = {
  apps: [
    {
      name: "beatmind-next",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/var/www/beat-mind-ai",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      max_memory_restart: "512M",
      error_file: "/var/log/beatmind/next-error.log",
      out_file: "/var/log/beatmind/next-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
    },
    {
      name: "beatmind-ws",
      script: "ws-server.ts",
      interpreter: "bun",                // Or "node" with ts-node/tsx
      cwd: "/var/www/beat-mind-ai",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        WS_PORT: "3001",
      },
      max_memory_restart: "256M",
      error_file: "/var/log/beatmind/ws-error.log",
      out_file: "/var/log/beatmind/ws-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,
    },
  ],
};
```

### 9.1 PM2 Commands

```bash
# Start both processes
pm2 start ecosystem.config.js

# Restart WS server only
pm2 restart beatmind-ws

# View logs
pm2 logs beatmind-ws --lines 100

# Monitor
pm2 monit

# Save process list for auto-start on reboot
pm2 save
pm2 startup
```

### 9.2 Graceful Shutdown

The WS server handles `SIGINT` and `SIGTERM` for graceful shutdown:

```typescript
async function gracefulShutdown(signal: string) {
  console.log(`[WS Server] Received ${signal}, shutting down gracefully...`);

  // 1. Stop accepting new connections
  wss.close();

  // 2. Flush pending HR data to database
  await batchWriter.shutdown();

  // 3. Close all existing connections with a "going away" message
  for (const client of wss.clients) {
    client.close(1001, "Server shutting down");
  }

  // 4. Close database connection
  await db.close();

  console.log("[WS Server] Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
```

---

## 10. Security

### 10.1 Transport Layer

| Environment | Protocol | Notes                                    |
|-------------|----------|------------------------------------------|
| Development | `ws://`  | Plain WebSocket, localhost only           |
| Production  | `wss://` | TLS termination at reverse proxy (Nginx) |

**Nginx configuration for WSS:**

```nginx
# WebSocket proxy
location /ws/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Timeouts
    proxy_read_timeout 86400;     # 24h (keep connection alive)
    proxy_send_timeout 86400;
}
```

### 10.2 Agent Authentication

- Agent credentials (`agentId` + `agentSecret`) are stored in the `agents` table
- `agentSecret` is a random 64-character hex string, generated when the agent is provisioned
- Credentials are transmitted in the first WebSocket message (not in URL or headers, to avoid logging exposure)
- Each agent is bound to exactly one gym (`gym_id` FK)
- An agent can only send data for its assigned gym

### 10.3 TV Authentication

- TV token is a UUID v4 stored in `gyms.tv_access_token`
- Token is passed as a query parameter: `?token=TOKEN`
- Token can be regenerated by the gym owner from the settings page (invalidates all existing TV connections)
- Token does not expire (long-lived, since TVs run continuously)
- Token validation includes checking that the gym's subscription is active

### 10.4 Internal API Security

- The `/internal/broadcast` and `/internal/session-event` endpoints on the WS server are protected by:
  - Binding the HTTP server to `127.0.0.1` only (not exposed externally), OR
  - Requiring an `X-Internal-Secret` header that matches `process.env.WS_INTERNAL_SECRET`
- Nginx must NOT proxy requests to `/internal/*` paths

### 10.5 Rate Limiting

| Connection Type | Rate Limit                           | Action on Violation          |
|-----------------|--------------------------------------|------------------------------|
| Agent           | Max 2 messages/second                | Log warning, drop excess     |
| Agent           | Max 50 devices per hr-data message   | Truncate to 50, log warning  |
| TV (inbound)    | Max 1 message/second (keepalive)     | Drop excess silently         |
| Connections     | Max 10 connections per IP per minute | Reject with HTTP 429         |

### 10.6 Input Validation

All incoming WebSocket messages are validated before processing:

```typescript
import { z } from "zod";

const AgentAuthSchema = z.object({
  type: z.literal("auth"),
  agentId: z.string().uuid(),
  agentSecret: z.string().min(32).max(128),
});

const AgentHRDataSchema = z.object({
  type: z.literal("hr-data"),
  timestamp: z.string().datetime(),
  devices: z.record(
    z.string(),
    z.object({
      bpm: z.number().int().min(0).max(250),
      beatTime: z.number().min(0),
      beatCount: z.number().int().min(0),
      deviceActive: z.boolean(),
    })
  ),
});

const AgentHeartbeatSchema = z.object({
  type: z.literal("heartbeat"),
  status: z.literal("online"),
  timestamp: z.string().datetime(),
  meta: z.object({
    cpuUsage: z.number().optional(),
    memoryUsage: z.number().optional(),
    uptimeSeconds: z.number().optional(),
    softwareVersion: z.string().optional(),
    connectedSensors: z.number().optional(),
  }).optional(),
});
```

---

## Appendix A: Environment Variables

```bash
# WebSocket Server
WS_PORT=3001                              # Port for the WS server
WS_INTERNAL_SECRET=<random-64-char-hex>   # Shared secret for Next.js -> WS internal calls
WS_PING_INTERVAL=30000                    # Ping interval in ms (default 30s)
WS_PONG_TIMEOUT=60000                     # Pong timeout in ms (default 60s)
WS_AUTH_TIMEOUT=5000                      # Agent auth timeout in ms (default 5s)
WS_BATCH_FLUSH_INTERVAL=5000              # HR data batch flush interval in ms (default 5s)
WS_BATCH_MAX_BUFFER=1000                  # Max buffered readings per gym before dropping

# Shared with Next.js
DATABASE_URL=postgresql://...             # PostgreSQL connection string
NODE_ENV=production
```

## Appendix B: WebSocket Close Codes

| Code | Meaning                                    | Used By |
|------|--------------------------------------------|---------|
| 1000 | Normal closure                             | Both    |
| 1001 | Server going away (shutdown)               | Server  |
| 1006 | Abnormal closure (connection lost)         | Both    |
| 4000 | Unknown endpoint                           | Server  |
| 4001 | Authentication failed                      | Server  |
| 4002 | Authentication timeout                     | Server  |
| 4003 | Replaced by new connection                 | Server  |

## Appendix C: Monitoring and Observability

The WS server exposes a `/health` HTTP endpoint for monitoring:

```json
GET http://localhost:3001/health

Response:
{
  "status": "ok",
  "uptime": 86400,
  "connections": {
    "agents": 8,
    "tvs": 12
  },
  "gyms": {
    "active": 8,
    "totalDevices": 45
  },
  "batchWriter": {
    "bufferedReadings": 120,
    "lastFlush": "2026-02-26T10:00:00Z"
  },
  "database": {
    "connected": true,
    "latencyMs": 2
  }
}
```

PM2 can be configured to poll this endpoint and trigger alerts if the response is not 200 or if specific metrics exceed thresholds.
