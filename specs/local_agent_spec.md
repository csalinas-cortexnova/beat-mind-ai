# Local Agent -- Technical Specification

**Version:** 1.0 | **Date:** 2026-02-26 | **Status:** Draft
**Module:** `agent/` (separate package within monorepo)

---

## 1. Overview

The Local Agent is a standalone Node.js/Bun process that runs on a mini PC installed at each gym. Its sole responsibilities are:

1. Read heart rate data from ANT+ USB dongles connected to athletes wearing HR chest straps.
2. Forward that data in real-time to the central VPS platform over WebSocket and HTTPS.
3. Provide a degraded-but-functional local TV dashboard when the internet connection is unavailable.

The agent is a direct TypeScript port of two proven modules from the burnapp MVP:

- **`burnapp/src/ant-reader.js`** -- ANT+ USB stick communication and HR scanner (394 lines)
- **`burnapp/src/device-manager.js`** -- Device state tracking, HR zone calculation, and sparkline history (218 lines)

Both files are ported to strict TypeScript with the following improvements:

- Multi-dongle support (burnapp supported a single dongle with 8 channels; BeatMind targets 2-3 dongles for 16-20 concurrent athletes).
- Network transport layer (`vps-client.ts`) to send data to the central VPS instead of serving it locally.
- Local buffering and resilience for offline scenarios.
- Session auto-detection logic.

---

## 2. Package Structure

```
agent/
  src/
    ant-reader.ts          # Port of burnapp ant-reader.js (ANT+ USB communication)
    device-manager.ts      # Port of burnapp device-manager.js (device state tracking)
    vps-client.ts          # NEW: sends data to VPS central (WebSocket + HTTPS)
    local-dashboard.ts     # Local HTTP server for TV fallback when offline
    config.ts              # Configuration loading and validation
    types.ts               # Shared TypeScript interfaces and types
    logger.ts              # Structured logging utility
    index.ts               # Entry point: wires all modules together
  tests/
    ant-reader.test.ts
    device-manager.test.ts
    vps-client.test.ts
    config.test.ts
  package.json
  tsconfig.json
  .env                     # AGENT_ID, GYM_ID, AGENT_SECRET, VPS_URL, VPS_WS_URL
  .env.example             # Template with all required variables documented
  ecosystem.config.js      # PM2 process configuration
```

### package.json Dependencies

```jsonc
{
  "name": "@beatmind/agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "build": "tsc",
    "test": "bun test",
    "lint": "eslint src/"
  },
  "dependencies": {
    "ant-plus": "^0.3.0",      // ANT+ USB communication
    "usb": "^2.14.0",          // Low-level USB access (peer dep of ant-plus)
    "ws": "^8.18.0",           // WebSocket client for VPS connection
    "dotenv": "^16.4.0"        // Environment variable loading
  },
  "devDependencies": {
    "@types/ws": "^8.5.0",
    "@types/node": "^20",
    "typescript": "^5",
    "eslint": "^9",
    "bun-types": "latest"
  }
}
```

### tsconfig.json

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "sourceMap": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

## 3. Shared Types (`types.ts`)

All interfaces used across modules are defined here. This is the source of truth for data shapes.

```typescript
// --- ANT+ Reader Types ---

export interface AntReaderConfig {
  stickType: "auto" | "garmin2" | "garmin3";
  deviceTimeoutMs: number;       // ms with no signal before device marked lost (default: 10000)
  reconnectDelayMs: number;      // ms before USB reconnect attempt (default: 5000)
  checkIntervalMs: number;       // ms between lost-device checks (default: 2000)
}

export interface RawHrData {
  DeviceID: number;
  ComputedHeartRate: number;
  BeatTime: number;
  BeatCount: number;
}

export interface SensorReading {
  sensorId: number;              // ANT+ DeviceID
  bpm: number;                   // ComputedHeartRate
  beatTime: number;              // Internal ANT+ beat timing
  beatCount: number;             // Cumulative beat counter
  timestamp: string;             // ISO 8601
  lastSeen: number;              // Unix ms
}

export interface AntReaderEvents {
  "stick-ready": { stickType: string; maxChannels: number; dongleIndex: number };
  "stick-error": { error: Error; dongleIndex: number };
  "stick-closed": { dongleIndex: number };
  "sensor-detected": { sensorId: number; dongleIndex: number };
  "hr-data": SensorReading;
  "sensor-lost": { sensorId: number; lastSeen: string };
}

// --- Device Manager Types ---

export interface DeviceState {
  sensorId: number;
  athleteName: string;           // "Athlete 1", "Athlete 2", ... (default label)
  athleteIndex: number;          // Sequential index for ordering on dashboard
  maxHr: number;                 // Max HR for zone calculation (default: 190)
  bpm: number;                   // Current heart rate
  beatTime: number;
  beatCount: number;
  timestamp: string;             // ISO 8601 of last reading
  lastSeen: number;              // Unix ms of last reading
  deviceActive: boolean;         // true if receiving data within timeout
  zone: number;                  // 0-5
  zoneName: string;              // "Rest", "Warmup", ..., "Max Effort"
  zoneColor: string;             // Hex color code
  hrMaxPercent: number;          // 0-100
  history: HistoryEntry[];       // Last 60s of BPM readings for sparkline
}

export interface HistoryEntry {
  hr: number;
  time: number;                  // Unix ms
}

export interface DeviceSnapshot {
  sensorId: number;
  athleteName: string;
  athleteIndex: number;
  bpm: number;
  zone: number;
  zoneName: string;
  zoneColor: string;
  hrMaxPercent: number;
  beatTime: number;
  beatCount: number;
  timestamp: string;
  deviceActive: boolean;
  history: number[];             // BPM values only (for sparkline rendering)
}

export type DeviceManagerEvents = {
  "device-update": DeviceSnapshot;
  "device-added": { sensorId: number; athleteName: string };
  "device-inactive": { sensorId: number; athleteName: string };
  "device-removed": { sensorId: number; athleteName: string };
};

// --- VPS Client Types ---

export interface VpsClientConfig {
  vpsUrl: string;                // HTTPS base URL (e.g., https://api.beatmind.ai)
  vpsWsUrl: string;              // WebSocket URL (e.g., wss://api.beatmind.ai/ws/agent)
  agentId: string;               // UUID
  agentSecret: string;           // Shared secret for auth
  gymId: string;                 // UUID
  wsSendIntervalMs: number;      // WebSocket send interval (default: 1000)
  httpBatchIntervalMs: number;   // HTTP batch interval (default: 5000)
  healthReportIntervalMs: number;// Health status report interval (default: 30000)
  maxBufferDurationMs: number;   // Max offline buffer duration (default: 600000 = 10min)
  reconnectBaseMs: number;       // Base reconnect delay (default: 1000)
  reconnectMaxMs: number;        // Max reconnect delay (default: 30000)
}

export interface HrBatchPayload {
  agentId: string;
  gymId: string;
  sessionId: string | null;
  timestamp: string;             // ISO 8601, when batch was assembled
  sequenceNumber: number;        // Monotonically increasing, for ordered delivery
  readings: SensorReadingWithZone[];
}

export interface SensorReadingWithZone extends SensorReading {
  zone: number;
  zoneName: string;
  zoneColor: string;
  hrMaxPercent: number;
  deviceActive: boolean;
}

export interface AgentStatusPayload {
  agentId: string;
  gymId: string;
  status: "online" | "degraded" | "offline";
  activeSensors: number;
  totalSensors: number;
  usbDonglesConnected: number;
  uptimeSeconds: number;
  softwareVersion: string;
  sessionId: string | null;
  sessionActive: boolean;
  bufferSize: number;            // Number of buffered readings during outage
  timestamp: string;
}

export interface WsMessage {
  type: "hr-update" | "session-start" | "session-end" | "agent-status";
  payload: HrBatchPayload | AgentStatusPayload | SessionEvent;
}

export interface SessionEvent {
  agentId: string;
  gymId: string;
  sessionId: string;
  event: "started" | "ended";
  timestamp: string;
  sensorCount: number;
}

// --- Config Types ---

export interface AgentConfig {
  agentId: string;
  gymId: string;
  agentSecret: string;
  vpsUrl: string;
  vpsWsUrl: string;
  antReader: AntReaderConfig;
  vpsClient: Omit<VpsClientConfig, "vpsUrl" | "vpsWsUrl" | "agentId" | "agentSecret" | "gymId">;
  deviceManager: {
    defaultMaxHr: number;
    historyDurationS: number;
    inactiveTimeoutMs: number;   // 30000 -- mark inactive after 30s no data
    removeTimeoutMs: number;     // 120000 -- remove device after 2min no data
  };
  session: {
    autoStartEnabled: boolean;
    autoEndTimeoutMs: number;    // 120000 -- end session after 2min no active sensors
  };
  localDashboard: {
    port: number;                // Default: 3333
    enabled: boolean;
  };
}
```

---

## 4. ANT+ Reader (`ant-reader.ts`)

### Purpose

Communicates with one or more ANT+ USB dongles to receive heart rate data from all HR sensors within radio range. This is a TypeScript port of `burnapp/src/ant-reader.js` extended to support multiple dongles.

### Port Changes from burnapp

| burnapp (`ant-reader.js`) | BeatMind (`ant-reader.ts`) |
|---|---|
| Single dongle (1x GarminStick, 8 channels) | Multiple dongles (2-3x, each with 8 channels, 16-24 total) |
| `require('ant-plus')` / CommonJS | ESM import with TypeScript types |
| `console.log` with emoji | Structured logger (`logger.ts`) |
| `deviceId` field name | `sensorId` field name (aligned with DB schema) |
| Events: `data`, `device-found`, `device-lost` | Events: `hr-data`, `sensor-detected`, `sensor-lost` |
| `devices` Map managed internally | Devices Map moved fully to DeviceManager |
| No multi-dongle orchestration | `DongleManager` inner class handles per-dongle lifecycle |

### Class: `AntReader`

```typescript
import { EventEmitter } from "events";
import Ant from "ant-plus";
import usb from "usb";
import { logger } from "./logger";
import type { AntReaderConfig, RawHrData, SensorReading, AntReaderEvents } from "./types";

export class AntReader extends EventEmitter {
  private config: AntReaderConfig;
  private dongles: DongleInstance[];  // One per physical USB dongle
  private running: boolean;
  private knownSensors: Set<number>; // Track sensor IDs across all dongles

  constructor(config: AntReaderConfig);
  async start(): Promise<void>;
  stop(): void;
  isRunning(): boolean;
  getDongleCount(): number;
  getActiveDongleCount(): number;
}
```

### Initialization Flow

1. Enumerate USB devices, filter for ANT+ vendor/product IDs.
2. For each detected ANT+ dongle:
   a. Create a `GarminStick2` or `GarminStick3` instance (auto-detect per dongle, same logic as burnapp `_tryStick`).
   b. Register `startup` and `shutdown` event handlers.
   c. Call `stick.open()` with an 8-second timeout (same as burnapp).
   d. On successful `startup`, create an `Ant.HeartRateScanner` bound to that stick.
   e. Call `scanner.scan()` to begin listening.
3. Start periodic check interval (`checkIntervalMs`, default 2000ms) for lost devices and USB health.
4. Emit `stick-ready` for each successfully opened dongle.

### HR Data Flow

When the `HeartRateScanner` fires an `hbData` event:

1. Extract fields from the ANT+ library data object:
   - `data.DeviceID` -> `sensorId`
   - `data.ComputedHeartRate` -> `bpm`
   - `data.BeatTime` -> `beatTime`
   - `data.BeatCount` -> `beatCount`
2. Build a `SensorReading` object with current ISO timestamp and Unix ms.
3. If `sensorId` is not in `knownSensors`, add it and emit `sensor-detected`.
4. Emit `hr-data` with the `SensorReading`.

### Lost Device Detection

Ported from burnapp `_checkLostDevices()`. Runs every `checkIntervalMs` (2000ms):

1. Iterate `knownSensors`. For each sensor, the DeviceManager tracks `lastSeen`. The AntReader delegates timeout logic to the DeviceManager (see section 5).
2. USB health check: call `usb.getDeviceList()` and verify each dongle's vendor/product ID is still present. If a dongle disappears:
   a. Emit `stick-closed` for that dongle.
   b. Trigger reconnection for that specific dongle (not all dongles).

### USB Reconnection

Ported from burnapp `_handleDisconnect()`:

1. Clean up the dead stick's internal state (remove from `USBDriver.deviceInUse` array, stop endpoint polling, release interface) -- same logic as burnapp lines 349-362.
2. Mark all sensors on that dongle as potentially lost (emit `sensor-lost` for each).
3. Attempt reconnection after `reconnectDelayMs` (default 5000ms).
4. If reconnection fails, retry with the same delay (fixed interval, not exponential -- USB reconnection is hardware-dependent and exponential backoff adds no value here).
5. If reconnection succeeds, emit `stick-ready` and resume scanning.

### Multi-Dongle Deduplication

Multiple dongles in the same room will pick up the same sensor broadcasts. The AntReader deduplicates by `sensorId`:

- Maintain a `Map<sensorId, dongleIndex>` tracking which dongle "owns" each sensor.
- First dongle to report a sensor claims ownership.
- If the owning dongle disconnects, ownership transfers to the next dongle that reports data for that sensor.
- Only emit `hr-data` from the owning dongle to avoid duplicate readings.

---

## 5. Device Manager (`device-manager.ts`)

### Purpose

Maintains the enriched state of every connected HR sensor: current BPM, HR zone, sparkline history, and connection status. Consumes events from `AntReader` and provides snapshots for the VPS client and local dashboard.

### Port Changes from burnapp

| burnapp (`device-manager.js`) | BeatMind (`device-manager.ts`) |
|---|---|
| `require('./hr-zones')` | Import shared `lib/hr/zones.ts` from monorepo or inline port |
| `deviceId` field name | `sensorId` field name |
| `athleteName: "Atleta N"` | `athleteName: "Athlete N"` (English default) |
| `active` boolean only | Three states: `active`, `inactive` (30s), `removed` (2min) |
| No device removal | Auto-remove after `removeTimeoutMs` (120000ms) |
| `percentage` field | `hrMaxPercent` field (clearer naming) |
| `getZone()` from `hr-zones.js` | Inline zone calculation or import from shared lib |

### Class: `DeviceManager`

```typescript
import { EventEmitter } from "events";
import type {
  DeviceState, DeviceSnapshot, SensorReading,
  DeviceManagerEvents, AgentConfig
} from "./types";

export class DeviceManager extends EventEmitter {
  private devices: Map<number, DeviceState>;   // Map<sensorId, DeviceState>
  private deviceIndex: number;
  private config: AgentConfig["deviceManager"];
  private cleanupInterval: ReturnType<typeof setInterval> | null;

  constructor(config: AgentConfig["deviceManager"]);

  /** Wire up to AntReader events */
  attachToReader(reader: AntReader): void;

  /** Start periodic cleanup of inactive/stale devices */
  startCleanup(): void;

  /** Stop cleanup interval */
  stopCleanup(): void;

  /** Get snapshot of a single device */
  getDeviceSnapshot(sensorId: number): DeviceSnapshot | null;

  /** Get snapshot of ALL devices (for WS broadcast and HTTP batch) */
  getAllDevicesSnapshot(): { type: "hr-update"; devices: Record<number, DeviceSnapshot> };

  /** Get count of active (receiving data) devices */
  getActiveCount(): number;

  /** Get total device count (including inactive) */
  getTotalCount(): number;

  /** Get all devices as array (for batch payloads) */
  getDevicesArray(): DeviceSnapshot[];

  /** Update maxHr for a specific sensor (called when VPS sends athlete mapping) */
  setMaxHr(sensorId: number, maxHr: number): void;

  /** Update athlete name for a sensor (called when VPS sends athlete mapping) */
  setAthleteName(sensorId: number, name: string): void;

  /** Check if any device is active */
  hasActiveDevices(): boolean;
}
```

### Device Lifecycle

```
[sensor-detected] --> ACTIVE --> (30s no data) --> INACTIVE --> (2min no data) --> REMOVED
                        ^                            |
                        |                            |
                        +-- (data received) ---------+
```

**State transitions:**

| Transition | Trigger | Action |
|---|---|---|
| New -> Active | `sensor-detected` event from AntReader | Create `DeviceState`, assign index, emit `device-added` |
| Active -> Active | `hr-data` event | Update bpm, zone, history, reset `lastSeen` |
| Active -> Inactive | 30s since `lastSeen` (configurable via `inactiveTimeoutMs`) | Set `deviceActive = false`, emit `device-inactive` |
| Inactive -> Active | `hr-data` event received | Set `deviceActive = true`, resume updates |
| Inactive -> Removed | 120s since `lastSeen` (configurable via `removeTimeoutMs`) | Delete from Map, emit `device-removed` |

### HR Zone Calculation

Ported from burnapp `hr-zones.js`. Inline implementation within the agent package (no cross-package dependency at runtime):

```typescript
const HR_ZONES = [
  { zone: 1, name: "Warmup",     color: "#3b82f6", minPct: 0.50, maxPct: 0.60 },
  { zone: 2, name: "Fat Burn",   color: "#22c55e", minPct: 0.60, maxPct: 0.70 },
  { zone: 3, name: "Aerobic",    color: "#eab308", minPct: 0.70, maxPct: 0.80 },
  { zone: 4, name: "Anaerobic",  color: "#f97316", minPct: 0.80, maxPct: 0.90 },
  { zone: 5, name: "Max Effort", color: "#ef4444", minPct: 0.90, maxPct: 1.00 },
] as const;

const REST_ZONE = { zone: 0, name: "Rest", color: "#64748b" } as const;

function getZone(bpm: number, maxHr: number): {
  zone: number; zoneName: string; zoneColor: string; hrMaxPercent: number;
}
```

### Sparkline History

Each device maintains a rolling window of `{ hr, time }` entries for the last 60 seconds (configurable via `historyDurationS`). On every `hr-data` event:

1. Push `{ hr: bpm, time: Date.now() }` to `device.history`.
2. Evict entries older than `historyDurationS * 1000` ms from the front of the array.

When generating a snapshot, `history` is mapped to `number[]` (BPM values only) to minimize payload size.

### Periodic Cleanup

A `setInterval` running every 5 seconds checks all devices:

1. If `Date.now() - device.lastSeen > inactiveTimeoutMs` and `device.deviceActive === true`: transition to Inactive.
2. If `Date.now() - device.lastSeen > removeTimeoutMs`: remove from Map, emit `device-removed`.

---

## 6. VPS Client (`vps-client.ts`)

### Purpose

Manages all communication between the local agent and the central VPS. This module is entirely new (no burnapp equivalent). It handles:

1. Real-time WebSocket streaming (every 1s)
2. HTTPS batch persistence (every 5s)
3. Agent health status reporting (every 30s)
4. Offline buffering and reconnection
5. Session event notification

### Class: `VpsClient`

```typescript
import WebSocket from "ws";
import type {
  VpsClientConfig, HrBatchPayload, AgentStatusPayload,
  WsMessage, SessionEvent, SensorReadingWithZone
} from "./types";

export class VpsClient {
  private config: VpsClientConfig;
  private ws: WebSocket | null;
  private wsConnected: boolean;
  private httpAvailable: boolean;
  private buffer: SensorReadingWithZone[];  // Offline buffer
  private sequenceNumber: number;
  private reconnectAttempts: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null;
  private wsSendInterval: ReturnType<typeof setInterval> | null;
  private httpBatchInterval: ReturnType<typeof setInterval> | null;
  private healthReportInterval: ReturnType<typeof setInterval> | null;
  private startTime: number;
  private currentSessionId: string | null;
  private pendingReadings: SensorReadingWithZone[];  // Accumulator between sends

  constructor(config: VpsClientConfig);

  /** Initialize WebSocket connection and start all intervals */
  async connect(): Promise<void>;

  /** Gracefully disconnect */
  disconnect(): void;

  /** Queue a sensor reading for sending */
  queueReading(reading: SensorReadingWithZone): void;

  /** Notify VPS of session start */
  async notifySessionStart(sessionId: string, sensorCount: number): Promise<void>;

  /** Notify VPS of session end */
  async notifySessionEnd(sessionId: string, sensorCount: number): Promise<void>;

  /** Check if VPS is reachable (WS or HTTP) */
  isConnected(): boolean;

  /** Get current buffer size */
  getBufferSize(): number;

  /** Get uptime in seconds */
  getUptimeSeconds(): number;
}
```

### Authentication

All requests to the VPS include authentication headers:

```
X-Agent-Id: <AGENT_ID>        // UUID identifying this agent
X-Agent-Secret: <AGENT_SECRET> // Shared secret (rotatable by SuperAdmin)
X-Gym-Id: <GYM_ID>            // UUID of the gym this agent belongs to
```

The WebSocket handshake includes these as query parameters (headers are not widely supported in WS clients):

```
wss://api.beatmind.ai/ws/agent?agentId=<AGENT_ID>&secret=<AGENT_SECRET>&gymId=<GYM_ID>
```

### WebSocket Connection

**Connect:**

1. Create `new WebSocket(config.vpsWsUrl + auth query params)`.
2. On `open`: set `wsConnected = true`, reset `reconnectAttempts = 0`, flush buffer.
3. On `message`: handle commands from VPS (athlete mapping updates, config changes, force session end).
4. On `close` / `error`: set `wsConnected = false`, trigger reconnection.

**Auto-reconnect with exponential backoff:**

```typescript
private getReconnectDelay(): number {
  const delay = Math.min(
    this.config.reconnectBaseMs * Math.pow(2, this.reconnectAttempts),
    this.config.reconnectMaxMs
  );
  this.reconnectAttempts++;
  return delay;
}
// Sequence: 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s, ...
```

**Send (every 1s via `wsSendInterval`):**

1. Collect all readings accumulated in `pendingReadings` since last send.
2. Build a `WsMessage` of type `hr-update` with `HrBatchPayload`.
3. Assign and increment `sequenceNumber`.
4. If `wsConnected`, send as JSON over WebSocket.
5. If not connected, push readings to `buffer`.

### HTTPS Batch POST (Backup/Persistence)

**Endpoint:** `POST {vpsUrl}/api/agent/heartbeat`

**Interval:** Every 5 seconds.

**Payload:** `HrBatchPayload` (same schema as WebSocket, but batched over a 5s window).

```typescript
// Request
POST /api/agent/heartbeat
Headers:
  Content-Type: application/json
  X-Agent-Id: <AGENT_ID>
  X-Agent-Secret: <AGENT_SECRET>
  X-Gym-Id: <GYM_ID>

Body: {
  "agentId": "uuid",
  "gymId": "uuid",
  "sessionId": "uuid" | null,
  "timestamp": "2026-02-26T14:30:00.000Z",
  "sequenceNumber": 42,
  "readings": [
    {
      "sensorId": 12345,
      "bpm": 142,
      "beatTime": 1024,
      "beatCount": 500,
      "timestamp": "2026-02-26T14:30:00.500Z",
      "lastSeen": 1740580200500,
      "zone": 3,
      "zoneName": "Aerobic",
      "zoneColor": "#eab308",
      "hrMaxPercent": 75,
      "deviceActive": true
    }
  ]
}

// Response
200 OK
{
  "received": true,
  "athleteMappings": {          // Optional: VPS can push sensor-to-athlete mappings
    "12345": { "name": "Carlos M.", "maxHr": 185 },
    "67890": { "name": "Ana R.", "maxHr": 195 }
  }
}
```

The HTTP batch serves as the persistence mechanism. Even if WebSocket is working, the HTTP batch is always sent to guarantee data is persisted. The VPS deduplicates using `sequenceNumber`.

### Health Status Report

**Endpoint:** `POST {vpsUrl}/api/agent/status`

**Interval:** Every 30 seconds.

```typescript
// Request
POST /api/agent/status
Headers:
  Content-Type: application/json
  X-Agent-Id: <AGENT_ID>
  X-Agent-Secret: <AGENT_SECRET>

Body: {
  "agentId": "uuid",
  "gymId": "uuid",
  "status": "online",           // "online" | "degraded" | "offline"
  "activeSensors": 12,
  "totalSensors": 15,
  "usbDonglesConnected": 2,
  "uptimeSeconds": 3600,
  "softwareVersion": "0.1.0",
  "sessionId": "uuid",
  "sessionActive": true,
  "bufferSize": 0,
  "timestamp": "2026-02-26T14:30:00.000Z"
}

// Response
200 OK
{
  "acknowledged": true,
  "commands": []                // Future: remote commands (restart, update, etc.)
}
```

**Status determination:**
- `"online"`: All dongles connected, VPS reachable via WS.
- `"degraded"`: At least one dongle disconnected OR VPS reachable only via HTTP (WS down).
- `"offline"`: VPS unreachable (buffering locally).

### Offline Buffer

When both WebSocket and HTTP are unavailable:

1. All readings are pushed to an in-memory circular buffer.
2. Buffer capacity: `maxBufferDurationMs / wsSendIntervalMs` entries (default: 600000 / 1000 = 600 batches, approximately 10 minutes of data).
3. When buffer is full, oldest entries are evicted (FIFO).
4. Each buffered entry retains its original `timestamp` and `sequenceNumber`.
5. On reconnection (WS or HTTP), the buffer is flushed in order:
   - HTTP: send buffered batches in chunks of 50 readings per request.
   - WS: send buffered batches one per frame, throttled to avoid overwhelming the connection.
6. Buffer flush is non-blocking; new real-time data continues to flow while buffer drains.

### Incoming Messages from VPS

The VPS can send messages to the agent over the WebSocket:

| Message Type | Purpose | Payload |
|---|---|---|
| `athlete-mapping` | Push sensor-to-athlete mappings | `{ mappings: Record<sensorId, { name, maxHr }> }` |
| `config-update` | Update agent configuration | `{ config: Partial<AgentConfig> }` |
| `force-session-end` | Force end current session | `{ sessionId: string }` |
| `ping` | Keepalive from VPS | `{}` |

On receiving `athlete-mapping`, the VpsClient calls `deviceManager.setAthleteName()` and `deviceManager.setMaxHr()` for each mapped sensor.

---

## 7. Local Dashboard Fallback (`local-dashboard.ts`)

### Purpose

When the internet connection is down, the gym TV can point to the mini PC's local IP to display a basic version of the heart rate dashboard. This is not a full React app -- it is a minimal HTML page served by a built-in HTTP server.

### Class: `LocalDashboard`

```typescript
import { createServer, type Server } from "http";
import type { DeviceManager } from "./device-manager";

export class LocalDashboard {
  private server: Server | null;
  private port: number;
  private deviceManager: DeviceManager;
  private active: boolean;         // Whether the dashboard is actively serving
  private vpsAvailable: boolean;   // Tracks if VPS is reachable

  constructor(port: number, deviceManager: DeviceManager);

  /** Start the local HTTP server */
  start(): void;

  /** Stop the local HTTP server */
  stop(): void;

  /** Update VPS availability status (called by VpsClient) */
  setVpsAvailable(available: boolean): void;
}
```

### Endpoints

| Route | Description |
|---|---|
| `GET /` | Serves the dashboard HTML page |
| `GET /api/devices` | Returns JSON with current device snapshots |
| `GET /api/status` | Returns agent status (online/offline, sensor count) |
| `GET /health` | Simple health check (returns 200) |

### Dashboard Page (`/`)

A single self-contained HTML file with inline CSS and JavaScript (no build step, no external dependencies):

- Grid layout for up to 20 athlete cards (4 columns x 5 rows).
- Each card displays: BPM (large number), HR zone color background, athlete name (or "Athlete N"), zone name.
- Polls `/api/devices` every 1 second via `fetch()`.
- If VPS is available, shows a banner: "VPS Connected -- Use main TV URL for full experience".
- If VPS is unavailable, shows: "Offline Mode -- Displaying local data".

### Auto-Switch Behavior

1. The dashboard always runs on `config.localDashboard.port` (default 3333).
2. When VPS is available, the `/` page shows a redirect suggestion to the main TV URL.
3. When VPS goes down, the `/` page automatically starts showing live local data.
4. The TV in the gym can be configured to load `http://<mini-pc-ip>:3333` as a fallback URL (browser bookmark or second tab).

---

## 8. Configuration (`config.ts`)

### Purpose

Loads and validates all configuration from environment variables and provides typed defaults.

### Implementation

```typescript
import { config as loadDotenv } from "dotenv";
import { join } from "path";
import type { AgentConfig } from "./types";

export function loadConfig(): AgentConfig {
  loadDotenv({ path: join(__dirname, "..", ".env") });

  const config: AgentConfig = {
    // --- Required (fail on missing) ---
    agentId:     requireEnv("AGENT_ID"),
    gymId:       requireEnv("GYM_ID"),
    agentSecret: requireEnv("AGENT_SECRET"),
    vpsUrl:      requireEnv("VPS_URL"),
    vpsWsUrl:    requireEnv("VPS_WS_URL"),

    // --- ANT+ Reader ---
    antReader: {
      stickType:        (process.env.ANT_STICK_TYPE as "auto" | "garmin2" | "garmin3") || "auto",
      deviceTimeoutMs:  parseInt(process.env.DEVICE_TIMEOUT_MS || "10000"),
      reconnectDelayMs: parseInt(process.env.USB_RECONNECT_DELAY_MS || "5000"),
      checkIntervalMs:  parseInt(process.env.DEVICE_CHECK_INTERVAL_MS || "2000"),
    },

    // --- VPS Client ---
    vpsClient: {
      wsSendIntervalMs:      parseInt(process.env.WS_SEND_INTERVAL_MS || "1000"),
      httpBatchIntervalMs:   parseInt(process.env.HTTP_BATCH_INTERVAL_MS || "5000"),
      healthReportIntervalMs: parseInt(process.env.HEALTH_REPORT_INTERVAL_MS || "30000"),
      maxBufferDurationMs:   parseInt(process.env.MAX_BUFFER_DURATION_MS || "600000"),
      reconnectBaseMs:       parseInt(process.env.RECONNECT_BASE_MS || "1000"),
      reconnectMaxMs:        parseInt(process.env.RECONNECT_MAX_MS || "30000"),
    },

    // --- Device Manager ---
    deviceManager: {
      defaultMaxHr:      parseInt(process.env.DEFAULT_MAX_HR || "190"),
      historyDurationS:  parseInt(process.env.HISTORY_DURATION_S || "60"),
      inactiveTimeoutMs: parseInt(process.env.INACTIVE_TIMEOUT_MS || "30000"),
      removeTimeoutMs:   parseInt(process.env.REMOVE_TIMEOUT_MS || "120000"),
    },

    // --- Session ---
    session: {
      autoStartEnabled:  process.env.AUTO_SESSION_ENABLED !== "false",
      autoEndTimeoutMs:  parseInt(process.env.AUTO_SESSION_END_TIMEOUT_MS || "120000"),
    },

    // --- Local Dashboard ---
    localDashboard: {
      port:    parseInt(process.env.LOCAL_DASHBOARD_PORT || "3333"),
      enabled: process.env.LOCAL_DASHBOARD_ENABLED !== "false",
    },
  };

  validateConfig(config);
  return config;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function validateConfig(config: AgentConfig): void {
  // Validate UUIDs format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(config.agentId)) throw new Error("AGENT_ID must be a valid UUID");
  if (!uuidRegex.test(config.gymId)) throw new Error("GYM_ID must be a valid UUID");

  // Validate URLs
  if (!config.vpsUrl.startsWith("http")) throw new Error("VPS_URL must start with http(s)://");
  if (!config.vpsWsUrl.startsWith("ws")) throw new Error("VPS_WS_URL must start with ws(s)://");

  // Validate numeric ranges
  if (config.deviceManager.defaultMaxHr < 100 || config.deviceManager.defaultMaxHr > 250) {
    throw new Error("DEFAULT_MAX_HR must be between 100 and 250");
  }
}
```

### .env.example

```bash
# === Required ===
AGENT_ID=                          # UUID assigned by SuperAdmin when registering this agent
GYM_ID=                            # UUID of the gym this agent belongs to
AGENT_SECRET=                      # Shared secret for API authentication
VPS_URL=https://app.beatmind.ai    # Central platform HTTPS URL
VPS_WS_URL=wss://app.beatmind.ai/ws/agent  # Central platform WebSocket URL

# === ANT+ USB (optional) ===
ANT_STICK_TYPE=auto                # auto | garmin2 | garmin3
DEVICE_TIMEOUT_MS=10000            # ms before sensor marked as lost
USB_RECONNECT_DELAY_MS=5000        # ms before USB reconnect attempt
DEVICE_CHECK_INTERVAL_MS=2000      # ms between device health checks

# === VPS Communication (optional) ===
WS_SEND_INTERVAL_MS=1000           # WebSocket send frequency
HTTP_BATCH_INTERVAL_MS=5000        # HTTP batch frequency
HEALTH_REPORT_INTERVAL_MS=30000    # Health report frequency
MAX_BUFFER_DURATION_MS=600000      # Max offline buffer (10 min)
RECONNECT_BASE_MS=1000             # WS reconnect base delay
RECONNECT_MAX_MS=30000             # WS reconnect max delay

# === Device Manager (optional) ===
DEFAULT_MAX_HR=190                 # Default max HR when athlete mapping unknown
HISTORY_DURATION_S=60              # Sparkline history window in seconds
INACTIVE_TIMEOUT_MS=30000          # Mark sensor inactive after 30s no data
REMOVE_TIMEOUT_MS=120000           # Remove sensor after 2min no data

# === Session (optional) ===
AUTO_SESSION_ENABLED=true          # Auto-start/end sessions
AUTO_SESSION_END_TIMEOUT_MS=120000 # End session after 2min no active sensors

# === Local Dashboard (optional) ===
LOCAL_DASHBOARD_PORT=3333          # Port for local TV fallback
LOCAL_DASHBOARD_ENABLED=true       # Enable/disable local dashboard
```

---

## 9. Session Auto-Detection

### Purpose

Automatically start and end gym sessions based on sensor activity, removing the need for manual intervention by trainers.

### Implementation

Session logic lives in `index.ts` (the orchestrator), not in a separate module.

### Auto-Start

```
Trigger: First sensor detected (device-added event from DeviceManager)
         AND no session is currently active
         AND autoStartEnabled is true
```

**Flow:**

1. DeviceManager emits `device-added`.
2. Orchestrator checks: `currentSessionId === null && config.session.autoStartEnabled`.
3. Generate a local session UUID (`crypto.randomUUID()`).
4. Set `currentSessionId`.
5. Call `vpsClient.notifySessionStart(sessionId, sensorCount)`.
6. VPS creates a `sessions` row with `status = 'active'`.
7. If VPS is unreachable, the session start event is buffered and sent on reconnection.
8. Log: `"Session auto-started: {sessionId} with {n} sensors"`.

### Auto-End

```
Trigger: DeviceManager.getActiveCount() === 0
         AND currentSessionId !== null
         AND condition persists for autoEndTimeoutMs (120000ms = 2 minutes)
```

**Flow:**

1. When `getActiveCount()` drops to 0, start a countdown timer (`autoEndTimer`).
2. If any sensor becomes active before the timer fires, cancel the timer.
3. When the timer fires (2 minutes of zero active sensors):
   a. Call `vpsClient.notifySessionEnd(sessionId, 0)`.
   b. VPS updates the session row: `status = 'completed'`, `ended_at = NOW()`, calculates `duration_seconds`.
   c. Set `currentSessionId = null`.
   d. Reset `autoEndTimer`.
   e. Log: `"Session auto-ended: {sessionId} after 2min inactivity"`.

### Session Events over WebSocket

```typescript
// Session start
{
  "type": "session-start",
  "payload": {
    "agentId": "uuid",
    "gymId": "uuid",
    "sessionId": "uuid",
    "event": "started",
    "timestamp": "2026-02-26T14:00:00.000Z",
    "sensorCount": 1
  }
}

// Session end
{
  "type": "session-end",
  "payload": {
    "agentId": "uuid",
    "gymId": "uuid",
    "sessionId": "uuid",
    "event": "ended",
    "timestamp": "2026-02-26T15:05:00.000Z",
    "sensorCount": 0
  }
}
```

---

## 10. Entry Point (`index.ts`)

### Purpose

Wires all modules together and manages the agent lifecycle.

### Implementation

```typescript
import { loadConfig } from "./config";
import { AntReader } from "./ant-reader";
import { DeviceManager } from "./device-manager";
import { VpsClient } from "./vps-client";
import { LocalDashboard } from "./local-dashboard";
import { logger } from "./logger";
import type { AgentConfig, SensorReadingWithZone } from "./types";

async function main(): Promise<void> {
  logger.info("BeatMind Agent starting...");

  // 1. Load and validate configuration
  const config = loadConfig();
  logger.info(`Agent ${config.agentId} for gym ${config.gymId}`);

  // 2. Initialize modules
  const antReader = new AntReader(config.antReader);
  const deviceManager = new DeviceManager(config.deviceManager);
  const vpsClient = new VpsClient({
    ...config.vpsClient,
    vpsUrl: config.vpsUrl,
    vpsWsUrl: config.vpsWsUrl,
    agentId: config.agentId,
    agentSecret: config.agentSecret,
    gymId: config.gymId,
  });

  // 3. Wire modules together
  deviceManager.attachToReader(antReader);
  deviceManager.startCleanup();

  // 4. Forward enriched data to VPS client
  deviceManager.on("device-update", (snapshot) => {
    const reading: SensorReadingWithZone = {
      sensorId: snapshot.sensorId,
      bpm: snapshot.bpm,
      beatTime: snapshot.beatTime,
      beatCount: snapshot.beatCount,
      timestamp: snapshot.timestamp,
      lastSeen: Date.now(),
      zone: snapshot.zone,
      zoneName: snapshot.zoneName,
      zoneColor: snapshot.zoneColor,
      hrMaxPercent: snapshot.hrMaxPercent,
      deviceActive: snapshot.deviceActive,
    };
    vpsClient.queueReading(reading);
  });

  // 5. Session auto-detection
  let currentSessionId: string | null = null;
  let autoEndTimer: ReturnType<typeof setTimeout> | null = null;

  deviceManager.on("device-added", () => {
    if (!currentSessionId && config.session.autoStartEnabled) {
      currentSessionId = crypto.randomUUID();
      vpsClient.notifySessionStart(currentSessionId, deviceManager.getActiveCount());
      logger.info(`Session auto-started: ${currentSessionId}`);
    }
    // Cancel auto-end timer if a new device appears
    if (autoEndTimer) {
      clearTimeout(autoEndTimer);
      autoEndTimer = null;
    }
  });

  deviceManager.on("device-inactive", () => {
    checkAutoEnd();
  });

  deviceManager.on("device-removed", () => {
    checkAutoEnd();
  });

  function checkAutoEnd(): void {
    if (!currentSessionId || !config.session.autoStartEnabled) return;
    if (deviceManager.getActiveCount() > 0) return;
    if (autoEndTimer) return; // Timer already running

    autoEndTimer = setTimeout(() => {
      if (currentSessionId && deviceManager.getActiveCount() === 0) {
        vpsClient.notifySessionEnd(currentSessionId, 0);
        logger.info(`Session auto-ended: ${currentSessionId}`);
        currentSessionId = null;
      }
      autoEndTimer = null;
    }, config.session.autoEndTimeoutMs);
  }

  // 6. Start local dashboard (if enabled)
  let localDashboard: LocalDashboard | null = null;
  if (config.localDashboard.enabled) {
    localDashboard = new LocalDashboard(config.localDashboard.port, deviceManager);
    localDashboard.start();
  }

  // 7. Connect to VPS
  await vpsClient.connect();

  // 8. Update local dashboard with VPS availability
  if (localDashboard) {
    // Polled from vpsClient state
    setInterval(() => {
      localDashboard!.setVpsAvailable(vpsClient.isConnected());
    }, 5000);
  }

  // 9. Start ANT+ reading
  await antReader.start();

  // 10. Graceful shutdown
  const shutdown = (): void => {
    logger.info("Shutting down...");
    antReader.stop();
    deviceManager.stopCleanup();
    vpsClient.disconnect();
    localDashboard?.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.on("uncaughtException", (err) => {
    logger.error(`Uncaught exception: ${err.message}`, err.stack);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
  });

  logger.info("BeatMind Agent running.");
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`, err.stack);
  process.exit(1);
});
```

---

## 11. Error Handling and Resilience

### USB Disconnect

| Scenario | Behavior |
|---|---|
| Dongle physically removed | `usb.getDeviceList()` check detects absence within 2s. Stick resources cleaned up (same logic as burnapp lines 349-362). Reconnect attempted every 5s. |
| Dongle driver crash | `stick.on('shutdown')` fires. Same cleanup and reconnect flow. |
| All dongles lost | Agent continues running (VPS client keeps sending health reports with `usbDonglesConnected: 0`). Local dashboard shows "No sensors connected". |
| Dongle reconnected | Auto-detected on next USB enumeration cycle. Scanner restarts. Sensors re-appear via normal `sensor-detected` flow. |

### Network Loss

| Scenario | Behavior |
|---|---|
| VPS unreachable (WS + HTTP) | All readings buffered in memory (up to 10 min). Health report marked `status: "offline"`. Local dashboard activates. |
| WebSocket drops, HTTP works | Readings sent via HTTP batch (every 5s). WS reconnects with exponential backoff. Health report marked `status: "degraded"`. |
| Intermittent connectivity | Buffer flushes on each successful connection. Sequence numbers ensure order. VPS deduplicates by `sequenceNumber`. |
| DNS failure | Same as VPS unreachable. Reconnect attempts continue. |

### Data Integrity

- **Sequence numbers:** Every batch (WS and HTTP) carries a monotonically increasing `sequenceNumber`. The VPS uses this to:
  - Detect gaps (missing batches).
  - Deduplicate (same batch received via WS and HTTP).
  - Reorder (buffered data arriving after real-time data).
- **Timestamps:** All readings carry the original `timestamp` from when the sensor data was received, not when it was sent.
- **Idempotency:** HTTP batch POST is idempotent. Resending the same `sequenceNumber` is a no-op on the VPS.

### Process Crash

- PM2 auto-restarts the process on crash (see Deployment section).
- On restart, the agent:
  1. Loads config from `.env`.
  2. Reconnects to USB dongles (fresh scan).
  3. Reconnects to VPS (fresh WebSocket + health report).
  4. If a session was active before crash, VPS detects the gap in heartbeats (30s+ without health report) and can mark the session as interrupted. The agent starts fresh with no session; if sensors are active, a new session auto-starts.

### Logging (`logger.ts`)

Structured logging with levels and timestamps:

```typescript
export const logger = {
  info(message: string): void {
    console.log(`[${new Date().toISOString()}] [INFO] ${message}`);
  },
  warn(message: string): void {
    console.warn(`[${new Date().toISOString()}] [WARN] ${message}`);
  },
  error(message: string, stack?: string): void {
    console.error(`[${new Date().toISOString()}] [ERROR] ${message}`);
    if (stack) console.error(stack);
  },
  debug(message: string): void {
    if (process.env.LOG_LEVEL === "debug") {
      console.log(`[${new Date().toISOString()}] [DEBUG] ${message}`);
    }
  },
};
```

---

## 12. Deployment

### PM2 Configuration (`ecosystem.config.js`)

```javascript
module.exports = {
  apps: [
    {
      name: "beatmind-agent",
      script: "src/index.ts",
      interpreter: "bun",
      cwd: "/home/beatmind/agent",
      env: {
        NODE_ENV: "production",
      },
      // Restart policy
      autorestart: true,
      max_restarts: 50,
      min_uptime: "10s",
      restart_delay: 5000,
      // Logging
      log_file: "/home/beatmind/logs/agent.log",
      error_file: "/home/beatmind/logs/agent-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      // Resource limits
      max_memory_restart: "256M",
    },
  ],
};
```

### Auto-Start on Boot

```bash
# Install PM2 startup script (run once during initial setup)
pm2 startup systemd -u beatmind --hp /home/beatmind

# Start the agent and save the process list
pm2 start ecosystem.config.js
pm2 save
```

### Remote Update Mechanism

The agent supports remote updates triggered by the SuperAdmin via the VPS:

1. VPS sends a `config-update` message over WebSocket with `{ action: "update" }`.
2. Agent executes a predefined update script:

```bash
#!/bin/bash
# /home/beatmind/update.sh
set -e

cd /home/beatmind/agent

# Pull latest code
git pull origin main

# Install dependencies
bun install --frozen-lockfile

# Restart the agent
pm2 restart beatmind-agent

echo "Update complete: $(git rev-parse --short HEAD)"
```

3. The update script is invoked by the agent as a child process. The agent itself is restarted by PM2 after the `pm2 restart` command in the script.

### Hardware Requirements

| Component | Specification |
|---|---|
| Mini PC | x86_64 or ARM64, 2GB+ RAM, Linux (Ubuntu/Debian) |
| USB Ports | 1-3 USB 2.0+ ports for ANT+ dongles |
| ANT+ Dongles | Garmin USB-ANT Stick (USB2 or USB-m) or compatible |
| Network | Ethernet (preferred) or Wi-Fi for VPS connection |
| Storage | 8GB+ (OS + agent + logs) |
| Display Output | HDMI (for local TV dashboard fallback) |

### USB Driver Setup (Linux)

```bash
# Allow non-root access to ANT+ USB devices
sudo tee /etc/udev/rules.d/99-ant-usb.rules << 'EOF'
# Garmin ANT+ USB Stick (USB2)
SUBSYSTEM=="usb", ATTR{idVendor}=="0fcf", ATTR{idProduct}=="1008", MODE="0666"
# Garmin ANT+ USB-m Stick
SUBSYSTEM=="usb", ATTR{idVendor}=="0fcf", ATTR{idProduct}=="1009", MODE="0666"
EOF

sudo udevadm control --reload-rules
sudo udevadm trigger
```

### Initial Setup Script

```bash
#!/bin/bash
# /home/beatmind/setup.sh -- Run once on new mini PC

set -e

# 1. Clone repository
git clone https://github.com/your-org/beat-mind-ai.git /home/beatmind/repo
ln -s /home/beatmind/repo/agent /home/beatmind/agent

# 2. Install dependencies
cd /home/beatmind/agent
bun install

# 3. Configure environment
cp .env.example .env
echo "Edit .env with the credentials provided by SuperAdmin"

# 4. Setup USB rules
sudo cp udev/99-ant-usb.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules

# 5. Install PM2 globally
bun install -g pm2

# 6. Start agent
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u beatmind --hp /home/beatmind

# 7. Create log directory
mkdir -p /home/beatmind/logs

echo "Setup complete. Verify with: pm2 status"
```

---

## 13. Data Flow Summary

```
                          MINI PC (Local Agent)
  +-----------------------------------------------------------------+
  |                                                                 |
  |  [ANT+ Dongle 1] --+                                           |
  |  [ANT+ Dongle 2] --+--> AntReader --> DeviceManager             |
  |  [ANT+ Dongle 3] --+     (USB)         (state, zones,          |
  |                                          history)               |
  |                              |                                  |
  |                              v                                  |
  |                         VpsClient ---------> [VPS Central]      |
  |                          |  |  |              WS (1s)           |
  |                          |  |  |              HTTP (5s)         |
  |                          |  |  |              Health (30s)      |
  |                          |  |  |                                |
  |                          |  |  +---> Buffer (offline, 10min)    |
  |                          |  |                                   |
  |                          |  +------> Session auto-detect        |
  |                          |                                      |
  |                          v                                      |
  |                    LocalDashboard                               |
  |                    (HTTP :3333)                                  |
  |                    [TV Fallback]                                 |
  |                                                                 |
  +-----------------------------------------------------------------+
```

### Timing Budget (Target: < 2s end-to-end latency)

| Step | Time |
|---|---|
| ANT+ radio -> USB dongle | ~50ms |
| USB dongle -> AntReader (hbData event) | ~10ms |
| AntReader -> DeviceManager (zone calc, history) | ~1ms |
| DeviceManager -> VpsClient (queue reading) | ~1ms |
| VpsClient accumulate (up to 1s window) | 0-1000ms |
| WebSocket send to VPS | ~50ms |
| VPS process + broadcast to TV | ~50ms |
| **Total** | **~160ms - 1160ms** |

The dominant factor is the 1-second WebSocket send interval. In the worst case (reading arrives just after a send), latency is ~1.16s. In the best case (reading arrives just before a send), latency is ~160ms. Average: ~660ms. Well within the 2s target.

---

## 14. Testing Strategy

### Unit Tests

| File | What to test |
|---|---|
| `ant-reader.test.ts` | Mock `ant-plus` library; verify event emission for sensor detection, HR data, and sensor loss; verify multi-dongle deduplication; verify USB reconnection flow. |
| `device-manager.test.ts` | Verify state transitions (active/inactive/removed); verify zone calculation matches burnapp `hr-zones.js` output; verify sparkline history window; verify cleanup intervals. |
| `vps-client.test.ts` | Mock `ws` library; verify WebSocket send interval; verify HTTP batch format; verify offline buffering and flush; verify exponential backoff timing; verify sequence number monotonicity. |
| `config.test.ts` | Verify required env var validation; verify defaults; verify UUID format validation; verify URL format validation. |

### Integration Tests

- **ANT+ Simulation:** Use a mock USB device or recorded ANT+ data to verify the full pipeline from AntReader through DeviceManager to VpsClient.
- **VPS Communication:** Start a local mock WS/HTTP server and verify the agent connects, authenticates, sends data, handles disconnection, and reconnects.
- **Session Auto-Detection:** Simulate sensor appearance/disappearance and verify session start/end events are sent correctly.
- **Offline Buffer:** Disconnect mock VPS, accumulate readings, reconnect, and verify all buffered data is flushed with correct sequence numbers.

### Hardware Tests (Manual)

- Connect 1 dongle with 1 HR strap: verify basic data flow.
- Connect 2 dongles with 10+ HR straps: verify multi-dongle deduplication and channel capacity.
- Unplug dongle during operation: verify reconnection and sensor recovery.
- Disconnect network cable: verify local buffering and dashboard fallback.
- Kill the process: verify PM2 restart and session recovery.

---

## 15. Migration Notes from burnapp

### Files to Port

| burnapp Source | BeatMind Target | Changes Required |
|---|---|---|
| `src/ant-reader.js` (453 lines) | `agent/src/ant-reader.ts` | TypeScript types, multi-dongle support, rename `deviceId` to `sensorId`, rename events, remove standalone execution block, structured logging. |
| `src/device-manager.js` (218 lines) | `agent/src/device-manager.ts` | TypeScript types, add inactive/remove lifecycle states, rename fields (`percentage` -> `hrMaxPercent`, `active` -> `deviceActive`), inline zone calculation, add `device-removed` event, add periodic cleanup. |
| `src/hr-zones.js` (107 lines) | `agent/src/device-manager.ts` (inline) | Inline the `getZone()` function and zone constants directly into device-manager. English zone names. No separate file needed at agent level. The web platform will have its own shared `lib/hr/zones.ts`. |

### Key Behavioral Differences

| Aspect | burnapp | BeatMind Agent |
|---|---|---|
| Data destination | Local WebSocket to dashboard HTML | VPS via WS + HTTPS |
| Max athletes | 8 (1 dongle, 8 channels) | 16-20 (2-3 dongles) |
| Athlete names | "Atleta N" (hardcoded) | "Athlete N" default, overridden by VPS mapping |
| Session management | Manual via n8n webhooks | Auto-detect + VPS notification |
| Offline behavior | Not handled (everything local) | Local buffer + fallback dashboard |
| Zone language | Spanish | English (localization done on VPS/frontend) |
| Device timeout | 10s (single timeout) | 30s inactive, 2min remove (two-tier) |
| Logging | Console with emoji | Structured with ISO timestamps and levels |
