# TV Dashboard Specification

**Module:** TV Dashboard (`/tv/[gymId]`)
**Version:** 1.0
**Date:** 2026-02-26
**Status:** Draft
**PRD Reference:** Section 4.3 - TV Dashboard
**Migration Source:** `burnapp/dashboard/index.html`

---

## 1. Overview

The TV Dashboard is a full-screen, real-time heart rate monitoring display designed for gym TVs and large screens. It shows live BPM data, HR zones, sparklines, and AI coaching overlays for up to 20 athletes simultaneously.

This module is a complete rewrite of burnapp's `dashboard/index.html` (vanilla JS, single-gym, 8 athletes max, local WebSocket) into a React component architecture within the BeatMind AI platform (multi-tenant, 20 athletes, centralized VPS WebSocket, white-label branding).

**Key differences from burnapp:**

| Aspect | burnapp (legacy) | BeatMind AI (new) |
|--------|-----------------|-------------------|
| Rendering | Vanilla JS, DOM manipulation | React 19, component-based |
| Max athletes | 8 (4x2 grid) | 20 (4x5 dynamic grid) |
| WebSocket | Local (same machine, port 8080) | Remote VPS (`ws://VPS/ws/tv/[gymId]`) |
| Auth | None (local network) | UUID token query param |
| Branding | Hardcoded "HeartPulse Monitor" | White-label per gym |
| AI overlay | 8s overlay on card (coach-overlay CSS) | Same UX, React component |
| Sparkline | Canvas 2D, manual draw | Canvas 2D via dedicated component |
| Styling | Inline CSS | Tailwind CSS 4 |

---

## 2. Access Control

The TV Dashboard is a **public route** that does NOT use Clerk authentication. Auth is handled via a UUID token passed as a query parameter.

### Token Lifecycle

1. **Generation:** When a gym is created, a `tv_access_token` (UUID v4) is stored in the `gyms` table.
2. **Regeneration:** Gym Owner can regenerate the token from `/gym/settings`. This immediately invalidates the previous token.
3. **Usage:** The token is appended to the TV URL as a query parameter: `/tv/[gymId]?token=TOKEN`.
4. **Validation:** Server-side validation on page load. The token is also sent to the WebSocket server on connection.

### Token Validation Flow

```
Browser requests /tv/[gymId]?token=TOKEN
  |
  v
Next.js Server Component (page.tsx)
  |
  v
Query: SELECT id, name, slug, logo_url, primary_color, secondary_color, language
       FROM gyms
       WHERE id = [gymId] AND tv_access_token = [TOKEN]
  |
  +-- No match --> Render 403 error page ("Invalid or expired token")
  |
  +-- Match --> Render TV Dashboard client component with gym config as props
```

### Security Considerations

- Tokens are UUID v4 (122 bits of entropy) -- brute force is infeasible.
- No session or cookie is set. Every page load validates the token.
- Token regeneration is the only revocation mechanism; there is no expiry TTL.
- Rate limit on page load: 10 requests per minute per IP to prevent token enumeration.
- The `gymId` in the URL must be a valid UUID format (validated before DB query).

---

## 3. Route Structure

### File: `app/tv/[gymId]/page.tsx`

This route lives outside the `(platform)` route group and does NOT inherit the Clerk auth layout.

```
app/
  tv/
    [gymId]/
      page.tsx          -- Server Component: validates token, fetches gym config
      layout.tsx         -- Minimal layout: no nav, no Clerk, full viewport
      error.tsx          -- Error boundary
      loading.tsx        -- Skeleton loading state
```

### Layout: `app/tv/[gymId]/layout.tsx`

```tsx
export const metadata = {
  title: "BeatMind AI - Live Monitor",
  robots: "noindex, nofollow",
};

export default function TVLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-900 text-slate-200">
      {children}
    </div>
  );
}
```

### Page: `app/tv/[gymId]/page.tsx`

```tsx
interface TVPageProps {
  params: Promise<{ gymId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function TVPage({ params, searchParams }: TVPageProps) {
  const { gymId } = await params;
  const { token } = await searchParams;

  // Validate UUID format
  if (!isValidUUID(gymId) || !token || !isValidUUID(token)) {
    return <TVErrorScreen message="Invalid access link" />;
  }

  // Validate token against database
  const gym = await db
    .select({
      id: gyms.id,
      name: gyms.name,
      slug: gyms.slug,
      logoUrl: gyms.logoUrl,
      primaryColor: gyms.primaryColor,
      secondaryColor: gyms.secondaryColor,
      language: gyms.language,
      timezone: gyms.timezone,
    })
    .from(gyms)
    .where(and(eq(gyms.id, gymId), eq(gyms.tvAccessToken, token)))
    .limit(1);

  if (gym.length === 0) {
    return <TVErrorScreen message="Invalid or expired access token" />;
  }

  return <TVDashboard gymConfig={gym[0]} />;
}
```

### Component Location

```
components/
  tv/
    TVDashboard.tsx           -- Main client component (orchestrator)
    TVHeader.tsx              -- Header bar (gym name, clock, connection status, session timer)
    AthleteGrid.tsx           -- Dynamic grid container
    AthleteCard.tsx           -- Individual athlete card
    Sparkline.tsx             -- Canvas-based HR sparkline
    CoachOverlay.tsx          -- AI coaching overlay on athlete card
    CoachActivationBanner.tsx -- Full-screen "COACH AI ACTIVADO" banner
    ConnectionOverlay.tsx     -- Disconnected/reconnecting overlay
    TVErrorScreen.tsx         -- Error states (invalid token, etc.)
    LeaderboardView.tsx       -- P2: Leaderboard mode
    hooks/
      useWebSocket.ts         -- WebSocket connection with auto-reconnect
      useAthleteState.ts      -- Athlete data state management
      useSessionTimer.ts      -- Session elapsed time
      useGridLayout.ts        -- Dynamic grid column/row calculation
```

---

## 4. Features by Priority

### P0 - Must Have (Phase 3, Weeks 7-9)

#### 4.1 Dynamic Athlete Grid

A responsive grid that automatically adjusts its layout based on the number of connected athletes.

- Maximum 20 simultaneous athletes.
- Grid recalculates when athletes connect or disconnect.
- Smooth transitions when grid dimensions change.
- Cards fill available space uniformly (all cards are the same size at any given time).
- See Section 7 for detailed grid layout logic.

#### 4.2 Athlete Card

Each connected athlete is displayed as a card with:

| Element | Position | Details |
|---------|----------|---------|
| Athlete name | Top left | Real name from athlete profile (via `athlete_bands` mapping). Fallback: "Athlete N" |
| Signal indicator | Top right | Green dot when receiving data, gray after timeout |
| BPM value | Center, large | Font size scales with card size. Tabular numerals. Color matches current HR zone. Pulse animation on each update. |
| BPM label | Below BPM | Static "BPM" text, small, muted |
| Zone badge | Bottom left | "Z{n} {zoneName}" with zone background color at 20% opacity |
| % max HR | Bottom right | "{n}% HRmax", muted color |
| Sparkline | Background, bottom area | 60-second rolling window, see Section 4.4 |
| Zone bar | Top edge, 4px | Full width, colored by current zone |

The card background has a subtle gradient tinted by the current HR zone color at low opacity (approximately 5-10%), transitioning smoothly when zones change.

#### 4.3 HR Zones with Colors

Five zones based on percentage of max HR, plus a rest zone:

| Zone | Name | Range | Color | Hex |
|------|------|-------|-------|-----|
| 0 | Rest | < 50% | Gray | `#64748B` |
| 1 | Warm-up | 50-60% | Blue | `#3B82F6` |
| 2 | Fat Burn | 60-70% | Green | `#22C55E` |
| 3 | Aerobic | 70-80% | Yellow | `#EAB308` |
| 4 | Threshold | 80-90% | Orange | `#F97316` |
| 5 | Maximum | 90-100% | Red | `#EF4444` |

Zone names are displayed in the gym's configured language (Spanish or Portuguese). The zone calculation logic is ported from `burnapp/src/hr-zones.js` as a shared utility at `lib/hr/zones.ts`.

#### 4.4 Sparkline (60-second Rolling Window)

Each athlete card includes a sparkline rendered on a `<canvas>` element showing the last 60 seconds of heart rate data.

**Specifications:**
- Rolling window: 60 data points (1 per second).
- Line color: matches current HR zone color.
- Fill: gradient from zone color at 25% opacity (top) to 3% opacity (bottom).
- Line width: 1.5px (scaled by `devicePixelRatio`).
- Y-axis range: dynamically calculated from `min(values) - 5` to `max(values) + 5`.
- Canvas renders at native pixel density (`canvas.width = rect.width * devicePixelRatio`).
- New data points push to the array; oldest points are shifted out when length exceeds 60.

**Implementation:**

```tsx
// components/tv/Sparkline.tsx
"use client";

interface SparklineProps {
  data: number[];       // Up to 60 BPM values
  color: string;        // Current zone hex color
  className?: string;
}
```

The component uses a `useRef` for the canvas and a `useEffect` that redraws on every `data` or `color` change. The drawing logic is ported directly from burnapp's `drawSparkline()` function.

#### 4.5 Coach AI Overlay on Card

When an AI coaching message targets specific athletes, a semi-transparent overlay slides over their cards.

**UX (matching burnapp behavior):**

1. Overlay fades in over 0.48s (6% of 8s animation).
2. Displays for approximately 6.5s at full opacity.
3. Fades out over 1.44s (18% of 8s animation).
4. Total visible duration: 8 seconds.
5. A progress bar at the bottom fills from 0% to 100% over 7 seconds (starting after 0.5s delay).

**Overlay content (top to bottom):**
- Header: coach icon + "COACH PULSE" label (gradient gold text)
- Message text: AI analysis text, centered, medium-large font
- Progress bar: thin bar with gold gradient fill

**Overlay style:**
- Background: `rgba(15, 23, 42, 0.94)` (slate-900 at 94% opacity)
- Positioned `absolute inset-0` within the card
- `z-index: 10` within the card context
- Border radius matches the card (16px / `rounded-2xl`)

**Targeting logic:**
- If the AI message includes `athleteId` or `athletes[]` with sensor IDs, overlay appears only on matching cards.
- If no specific athletes are referenced, overlay appears on ALL active cards.
- If a card already has an active overlay, the previous one is removed and replaced.

#### 4.6 WebSocket Connection with Auto-Reconnect

The TV Dashboard connects to the centralized VPS WebSocket server. See Section 5 for the full protocol specification.

**Connection parameters:**
- URL: `ws://{VPS_HOST}/ws/tv/{gymId}?token={TOKEN}`
- The `VPS_HOST` is provided as an environment variable `NEXT_PUBLIC_WS_URL`.

**Auto-reconnect with exponential backoff:**
- Initial delay: 1 second
- Multiplier: 2x
- Maximum delay: 30 seconds
- Sequence: 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s...
- Reset to 0 attempts on successful connection.
- Display reconnection status to the user (see Section 9).

**Implementation: `hooks/useWebSocket.ts`**

```tsx
interface UseWebSocketOptions {
  url: string;
  onMessage: (data: WebSocketMessage) => void;
  onConnectionChange: (connected: boolean) => void;
}

interface UseWebSocketReturn {
  connected: boolean;
  reconnectAttempt: number;
  reconnectDelay: number;
}
```

The hook manages a single `WebSocket` instance via `useRef`. It opens the connection on mount, sets up `onopen`, `onmessage`, `onclose`, and `onerror` handlers, and cleans up on unmount. Reconnection is scheduled via `setTimeout` stored in a ref that is cleared on unmount.

#### 4.7 Token-Based Auth (No Clerk)

- The TV route does not import or use any Clerk components or middleware.
- The Clerk middleware in `middleware.ts` must be configured to skip `/tv/*` routes:

```tsx
// middleware.ts
export default clerkMiddleware({
  publicRoutes: ["/tv(.*)"],
});
```

- The token is validated server-side in the page component (see Section 3).
- The token is also passed to the WebSocket server for connection authentication.

---

### P1 - Should Have (Phase 3, Weeks 7-9)

#### 4.8 White-Label Branding

The TV Dashboard reflects each gym's brand identity.

**Customizable elements:**
- **Gym logo:** Displayed in the header (left side). Falls back to a default BeatMind AI icon if no logo is configured.
- **Gym name:** Displayed next to the logo in the header.
- **Primary color:** Used for header accents, connection status border, and other UI highlights.
- **Secondary color:** Used for subtle backgrounds and secondary text accents.

**How colors are applied:**
- Gym config is fetched server-side and passed as props to the client component.
- CSS custom properties are set on the root container:

```tsx
<div
  style={{
    "--brand-primary": gymConfig.primaryColor || "#3B82F6",
    "--brand-secondary": gymConfig.secondaryColor || "#1E293B",
  } as React.CSSProperties}
>
```

- Tailwind classes reference these via `bg-[var(--brand-primary)]` or inline styles.
- HR zone colors are NEVER overridden by branding -- they remain fixed for clinical consistency.

#### 4.9 Session Timer

Displays elapsed time since the session started.

**Behavior:**
- The timer starts when a `session-event` message with `event: "started"` is received via WebSocket.
- Format: `HH:MM:SS` (tabular numerals for stable width).
- Displayed in the header, right area.
- Resets when a `session-event` message with `event: "ended"` is received.
- Between sessions (no active session), displays "--:--:--" or is hidden.

**Implementation: `hooks/useSessionTimer.ts`**

```tsx
function useSessionTimer(sessionStartedAt: string | null): string {
  // Returns formatted "HH:MM:SS" string, updated every second via setInterval
  // Returns "--:--:--" when sessionStartedAt is null
}
```

#### 4.10 Banner "COACH AI ACTIVADO"

A full-screen overlay that appears once when the first AI coaching message is received during a session.

**Behavior (matching burnapp):**
- Triggers once per session (tracked via a boolean ref).
- Total duration: 4.5 seconds.
- Animation sequence:
  1. Fade in background overlay (0 to 88% opacity over 0.4s)
  2. Card pops in with scale (0.7 to 1.05 to 1.0 over 0.8s)
  3. Icon pulses 3 times (1s each, starting at 0.4s)
  4. Progress bar fills from 0% to 100% over 3s (starting at 0.5s delay)
  5. Everything fades out (0.75s to 1.0s mark of 4s animation)

**Content:**
- Large coach icon (robot icon or custom SVG)
- "COACH AI ACTIVADO" title (gold gradient text, uppercase, bold)
- Subtitle: "Monitoring {athleteName}" (or gym name if no specific athlete)
- Thin progress bar with gold gradient fill

**Implementation:**
- Rendered as a portal or fixed-position div at `z-index: 150`.
- `pointer-events: none` so it does not block any underlying interaction.
- Automatically removed from DOM after animation completes.

---

### P2 - Nice to Have (Phase 5, Weeks 13-14)

#### 4.11 Leaderboard Mode

An alternative display mode that ranks athletes by performance metrics.

**Ranking criteria (configurable):**
- Calories burned (estimated)
- Time in zones 4-5 (seconds)

**Display:**
- Full-screen list view replacing the grid.
- Each row: rank number, athlete name, BPM, zone color indicator, metric value.
- Top 3 athletes highlighted with gold/silver/bronze accents.
- Auto-updates every 5 seconds.
- Toggle between grid mode and leaderboard mode via a timer or manual control from the gym dashboard.

**Data source:** Calculated client-side from accumulated HR data received via WebSocket.

---

## 5. WebSocket Protocol

### Connection

```
ws://{VPS_HOST}/ws/tv/{gymId}?token={TOKEN}
```

- The server validates `gymId` and `token` on connection upgrade. If invalid, the connection is rejected with HTTP 403.
- On successful connection, the server adds this client to the gym's broadcast room.
- The server sends an initial `session-event` message if a session is currently active.

### Messages: Server to Client

#### 5.1 `hr-update`

Sent every 1 second. Contains the current state of all connected sensors for the gym.

```json
{
  "type": "hr-update",
  "timestamp": "2026-02-26T14:30:00.000Z",
  "sessionId": "uuid-of-active-session",
  "devices": {
    "12345": {
      "sensorId": 12345,
      "bpm": 142,
      "zone": 3,
      "zoneName": "Aerobico",
      "zoneColor": "#EAB308",
      "maxPercent": 74,
      "athleteName": "Carlos Rodriguez",
      "athleteId": "uuid-of-athlete",
      "maxHr": 192,
      "active": true,
      "history": [135, 137, 139, 140, 142, 142, 141, 143, 142]
    },
    "12346": {
      "sensorId": 12346,
      "bpm": 168,
      "zone": 4,
      "zoneName": "Umbral anaerobico",
      "zoneColor": "#F97316",
      "maxPercent": 88,
      "athleteName": "Maria Santos",
      "athleteId": "uuid-of-athlete",
      "maxHr": 191,
      "active": true,
      "history": [160, 162, 164, 165, 167, 168]
    }
  }
}
```

**Field descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `sensorId` | `number` | ANT+ sensor device ID |
| `bpm` | `number` | Current heart rate in beats per minute |
| `zone` | `number` | HR zone (0-5) |
| `zoneName` | `string` | Localized zone name |
| `zoneColor` | `string` | Hex color for the zone |
| `maxPercent` | `number` | Current HR as percentage of athlete's max HR (0-100) |
| `athleteName` | `string` | Real name from athlete profile, or fallback "Athlete N" |
| `athleteId` | `string \| null` | UUID of the mapped athlete, or null if sensor is unmapped |
| `maxHr` | `number` | Athlete's configured max HR |
| `active` | `boolean` | `false` if sensor has not sent data in the last 10 seconds |
| `history` | `number[]` | Last N BPM readings (up to 60) for the sparkline |

**Notes:**
- `devices` is a dictionary keyed by `sensorId` (string).
- Devices that disconnect are sent with `active: false` for 30 seconds, then removed from the payload.
- `history` array is maintained server-side. The TV dashboard uses it directly for the sparkline without local accumulation (the server is the source of truth for the rolling window).

#### 5.2 `ai-coaching`

Sent periodically when the AI coaching system generates a message (every 15-60 seconds during active sessions, after 60-second warmup).

```json
{
  "type": "ai-coaching",
  "timestamp": "2026-02-26T14:30:15.000Z",
  "sessionId": "uuid-of-active-session",
  "analysis": "Carlos, gran ritmo en zona 3! Mantene esa intensidad. Maria, estas volando en zona 4, controla la respiracion!",
  "athletes": [
    { "sensorId": 12345, "athleteId": "uuid", "athleteName": "Carlos Rodriguez" },
    { "sensorId": 12346, "athleteId": "uuid", "athleteName": "Maria Santos" }
  ],
  "messageId": "uuid-of-ai-message"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `analysis` | `string` | The AI-generated coaching message text |
| `athletes` | `array` | Athletes referenced in the message (for overlay targeting) |
| `messageId` | `string` | UUID of the stored `ai_coaching_messages` record |

**Client handling:**
1. If this is the first `ai-coaching` message in the session, show the "COACH AI ACTIVADO" banner.
2. Show the coach overlay on the targeted athlete cards (see Section 4.5).
3. Optionally show a toast at the bottom of the screen with the full message.

#### 5.3 `session-event`

Sent when a training session starts or ends.

```json
{
  "type": "session-event",
  "event": "started",
  "sessionId": "uuid-of-session",
  "startedAt": "2026-02-26T14:00:00.000Z",
  "classType": "spinning",
  "trainerName": "Coach Pedro"
}
```

```json
{
  "type": "session-event",
  "event": "ended",
  "sessionId": "uuid-of-session",
  "endedAt": "2026-02-26T15:00:00.000Z",
  "duration": 3600
}
```

| Field | Type | Description |
|-------|------|-------------|
| `event` | `"started" \| "ended"` | Session lifecycle event |
| `sessionId` | `string` | UUID of the session |
| `startedAt` | `string` | ISO 8601 timestamp (only on "started") |
| `endedAt` | `string` | ISO 8601 timestamp (only on "ended") |
| `classType` | `string` | Type of class: "spinning", "pilates", "cycling", etc. (only on "started") |
| `trainerName` | `string` | Name of the trainer running the session (only on "started") |
| `duration` | `number` | Duration in seconds (only on "ended") |

**Client handling:**
- `"started"`: Start the session timer, reset the "COACH AI ACTIVADO" flag, clear any stale athlete data.
- `"ended"`: Stop the session timer, optionally display a "Session ended" message, clear athletes after a brief delay.

### Connection Lifecycle

```
1. Client opens WebSocket with token
2. Server validates token
   - Invalid: close with code 4001 "Unauthorized"
   - Valid: accept connection, join gym broadcast room
3. Server sends initial state:
   - If active session: session-event "started" + hr-update with current data
   - If no active session: no initial message (client shows idle state)
4. Server sends hr-update every 1s while session is active
5. Server sends ai-coaching periodically
6. Client detects disconnect (onclose)
7. Client begins exponential backoff reconnect
8. On reconnect, server resends current state (step 3)
```

### Auto-Reconnect Implementation

```tsx
// hooks/useWebSocket.ts (pseudocode)

const INITIAL_DELAY = 1000;
const MAX_DELAY = 30000;
const BACKOFF_MULTIPLIER = 2;

function calculateDelay(attempt: number): number {
  return Math.min(INITIAL_DELAY * Math.pow(BACKOFF_MULTIPLIER, attempt), MAX_DELAY);
}

// On close:
//   reconnectAttempt++
//   delay = calculateDelay(reconnectAttempt)
//   setTimeout(connect, delay)

// On open:
//   reconnectAttempt = 0
```

### Connection Status Indicator

Displayed in the header:

| State | Visual | Text |
|-------|--------|------|
| Connected | Green dot (animated pulse) | "Connected" |
| Disconnected | Red dot | "Disconnected" |
| Reconnecting | Yellow dot (animated blink) | "Reconnecting in {N}s..." |

---

## 6. Athlete Card Component

### Component: `AthleteCard.tsx`

```tsx
"use client";

interface AthleteCardProps {
  sensorId: string;
  bpm: number;
  zone: number;
  zoneName: string;
  zoneColor: string;
  maxPercent: number;
  athleteName: string;
  athleteId: string | null;
  active: boolean;
  history: number[];
  coachMessage: CoachMessage | null;
}
```

### Layout Structure

```
+--------------------------------------------------+
| [Zone Bar - 4px, full width, zone color]         |
|                                                  |
|  [Avatar] Athlete Name              [Signal Dot] |
|                                                  |
|                                                  |
|              142                                 |  <-- Large BPM, zone-colored
|              BPM                                 |
|                                                  |
|  [Z3 Aerobic]                    [74% HRmax]     |
|  [~~~~~~~~~~~~ Sparkline ~~~~~~~~~~~~~~~~]       |
+--------------------------------------------------+
```

### States

#### Active State
- Full-color card with zone-tinted background gradient.
- Zone bar at top, colored by current zone.
- BPM text color matches zone color.
- Border: 2px solid, zone color.
- Box shadow: zone color at 25% opacity, 20px spread.
- Signal indicator: green dot with subtle glow.

#### Inactive State (No Data for 30+ Seconds)
- Card remains in grid but visually grayed out.
- BPM shows "--" in gray (`#4B5563`).
- Zone badge shows "No signal" in red.
- Signal indicator: gray dot, no glow.
- Zone bar: gray (`#334155`).
- No sparkline (or flat line at last known value).
- Transition to inactive: smooth 0.4s transition on all color properties.

#### Empty Slot State
- Only shown when the grid has more slots than connected athletes (e.g., 3 athletes in a 2x2 grid = 1 empty slot).
- Displays placeholder icon and "Waiting for athlete..." text.
- Muted colors, no border accent.

### BPM Pulse Animation

On each BPM update, the BPM number plays a brief scale animation:

```css
@keyframes pulse {
  0% { transform: scale(1); }
  30% { transform: scale(1.08); }
  100% { transform: scale(1); }
}
```

Duration: 0.6s, ease-out. Triggered by toggling a CSS class (remove, force reflow, re-add).

### AI Coaching Overlay

The overlay is rendered as a sibling element within the card (not inside `card-content`) so that it is not destroyed when card data updates.

```
+--------------------------------------------------+
|                                                  |
|  [Robot Icon] COACH PULSE                        |
|                                                  |
|    "Carlos, gran ritmo en zona 3!                |
|     Mantene esa intensidad."                     |
|                                                  |
|  [======= progress bar ==========          ]     |
+--------------------------------------------------+
```

**Implementation detail:**
- The overlay is positioned `absolute inset-0` within the card.
- It has `z-index: 10` (local to the card stacking context).
- Background: `rgba(15, 23, 42, 0.94)`.
- The progress bar fills from left to right over 7 seconds (gold gradient).
- After 8 seconds, the overlay is unmounted from the React tree.
- A `setTimeout` ref handles removal; cleanup runs on unmount.

### Entry/Exit Animations

**When an athlete connects (new sensor detected):**
- Card transitions from empty/placeholder to active state.
- Fade in + slight scale up (0.95 to 1.0) over 0.3s.

**When an athlete disconnects (sensor removed from payload after 30s inactive):**
- Card transitions from inactive to empty/placeholder state.
- Fade out over 0.3s.
- Grid reflows smoothly (CSS grid transition).

### Font Scaling

BPM font size scales based on the number of athletes (i.e., card size):

| Athletes | Grid | BPM Font Size |
|----------|------|---------------|
| 1 | 1x1 | `8rem` |
| 2-4 | 2x2 | `5rem` |
| 5-9 | 3x3 | `4rem` |
| 10-16 | 4x4 | `3.5rem` |
| 17-20 | 4x5 | `3rem` |

Other text elements (name, zone, percentage) scale proportionally using Tailwind responsive utilities or CSS `clamp()`.

---

## 7. Grid Layout Logic

### Component: `AthleteGrid.tsx`

The grid dynamically adjusts its columns and rows based on the number of connected athletes.

### Grid Breakpoints

| Athletes | Columns | Rows | CSS Grid Template |
|----------|---------|------|-------------------|
| 1 | 1 | 1 | `grid-cols-1 grid-rows-1` |
| 2 | 2 | 1 | `grid-cols-2 grid-rows-1` |
| 3-4 | 2 | 2 | `grid-cols-2 grid-rows-2` |
| 5-6 | 3 | 2 | `grid-cols-3 grid-rows-2` |
| 7-9 | 3 | 3 | `grid-cols-3 grid-rows-3` |
| 10-12 | 4 | 3 | `grid-cols-4 grid-rows-3` |
| 13-16 | 4 | 4 | `grid-cols-4 grid-rows-4` |
| 17-20 | 4 | 5 | `grid-cols-4 grid-rows-5` |

### Calculation Logic

```tsx
// hooks/useGridLayout.ts

interface GridLayout {
  cols: number;
  rows: number;
  bpmFontSize: string;
}

function calculateGridLayout(athleteCount: number): GridLayout {
  if (athleteCount <= 1) return { cols: 1, rows: 1, bpmFontSize: "8rem" };
  if (athleteCount <= 2) return { cols: 2, rows: 1, bpmFontSize: "5rem" };
  if (athleteCount <= 4) return { cols: 2, rows: 2, bpmFontSize: "5rem" };
  if (athleteCount <= 6) return { cols: 3, rows: 2, bpmFontSize: "4rem" };
  if (athleteCount <= 9) return { cols: 3, rows: 3, bpmFontSize: "4rem" };
  if (athleteCount <= 12) return { cols: 4, rows: 3, bpmFontSize: "3.5rem" };
  if (athleteCount <= 16) return { cols: 4, rows: 4, bpmFontSize: "3.5rem" };
  return { cols: 4, rows: 5, bpmFontSize: "3rem" };
}
```

### Grid Container

```tsx
<div
  className="grid gap-4 p-4 h-full"
  style={{
    gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
    gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
  }}
>
  {athletes.map((athlete) => (
    <AthleteCard key={athlete.sensorId} {...athlete} />
  ))}
</div>
```

### Grid Transition

When the grid dimensions change (e.g., 5th athlete connects, grid goes from 2x2 to 3x2):
- Use CSS `transition` on the grid container for smooth resizing.
- Cards animate to their new positions over 0.3s.
- No visual "jump" -- the transition should feel fluid.

### Empty Slots

The grid only renders cards for connected athletes. It does NOT pre-render empty placeholder cards (unlike burnapp which pre-renders 8 slots). The grid naturally fills available space because all slots use `1fr`.

Exception: If needed for visual balance, up to 1 empty placeholder card may be added to complete a row (e.g., 3 athletes in a 2x2 grid = add 1 placeholder to fill the 4th slot). This is an aesthetic decision to be evaluated during implementation.

---

## 8. Performance Requirements

### Target Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Animation frame rate | 60 FPS | No dropped frames during normal operation |
| End-to-end latency | < 2 seconds | HR band reads BPM to TV screen displays it |
| WebSocket message processing | < 16ms | Time from `onmessage` to render complete |
| Initial load (TTI) | < 3 seconds | Time from navigation to interactive state |
| Memory usage | Stable | No memory growth over 8-hour session |

### Optimization Strategies

#### Efficient Re-renders

- **Granular state:** Each athlete card manages its own state slice. When `hr-update` arrives, only cards whose data actually changed re-render.
- **Memoization:** `AthleteCard` is wrapped in `React.memo` with a custom comparison function that checks `bpm`, `zone`, `active`, and `history.length`.
- **Sparkline canvas:** The canvas redraws only when `data` or `color` changes (not on every parent render).
- **Stable keys:** Cards use `sensorId` as the React key (stable across updates).

#### State Management

```tsx
// hooks/useAthleteState.ts

interface AthleteState {
  athletes: Map<string, AthleteData>;
  sessionId: string | null;
  sessionStartedAt: string | null;
}

// On hr-update message:
// 1. Parse devices from message
// 2. For each device, compare with current state
// 3. Only update athletes whose data has changed
// 4. Use Map for O(1) lookup by sensorId
// 5. Derive sorted array from Map only when athlete count changes
```

#### WebSocket Message Handling

- Messages are parsed in the `onmessage` callback.
- State updates are batched via React 19's automatic batching.
- No intermediate state objects are created -- data flows directly from parsed JSON to state update.

#### Canvas Optimization

- Sparkline canvas uses `requestAnimationFrame` for drawing (not synchronous in render).
- Canvas dimensions are cached and only recalculated on window resize.
- `devicePixelRatio` is read once on mount.

#### Memory Management

- Sparkline history arrays are capped at 60 elements (old data is shifted out).
- Coach overlay timeouts are cleaned up on unmount.
- WebSocket reconnect timeouts are cleaned up on unmount.
- No event listeners are left dangling.

---

## 9. Offline/Error States

### 9.1 Connection Lost Overlay

When the WebSocket disconnects, a full-screen overlay appears:

```
+--------------------------------------------------+
|                                                  |
|                                                  |
|                   [Signal Icon]                  |
|                                                  |
|        Connecting to BeatMind AI...              |
|        Reconnecting in 4s... (attempt 3)         |
|                                                  |
|                                                  |
+--------------------------------------------------+
```

**Behavior:**
- Appears immediately when `WebSocket.onclose` fires.
- Background: `rgba(15, 23, 42, 0.92)` (slate-900 at 92% opacity, matching burnapp).
- `z-index: 200` (above everything including coach overlays).
- The signal icon blinks (2s cycle, 0.3 minimum opacity).
- The countdown text updates every second.
- Disappears with a 0.5s fade-out transition on successful reconnection.
- The underlying grid remains visible (dimmed) behind the overlay.

### 9.2 Reconnecting State

While reconnecting:
- The connection status in the header shows a yellow blinking dot.
- Header text: "Reconnecting in {N}s... (attempt {M})".
- The full overlay (9.1) is displayed.

### 9.3 No Active Session State

When connected but no session is active:

```
+--------------------------------------------------+
|  [Header: Gym Name, Clock, Connected]            |
|                                                  |
|                                                  |
|        Waiting for session to start...           |
|        Athletes will appear when a               |
|        training session begins.                  |
|                                                  |
|                                                  |
+--------------------------------------------------+
```

- Header remains fully functional (clock, connection status).
- Center of screen shows an idle message.
- When a `session-event` with `event: "started"` arrives, transition to the active grid.

### 9.4 No Athletes Connected

When a session is active but no sensors are sending data:

```
+--------------------------------------------------+
|  [Header: Gym Name, Clock, Timer, Connected]     |
|                                                  |
|                                                  |
|        Session active                            |
|        Waiting for athletes to connect...        |
|        Turn on HR bands to begin                 |
|                                                  |
|                                                  |
+--------------------------------------------------+
```

### 9.5 Invalid Token Screen

Rendered server-side when token validation fails:

```
+--------------------------------------------------+
|                                                  |
|             [Lock Icon]                          |
|                                                  |
|        Access Denied                             |
|                                                  |
|        The access link is invalid or expired.    |
|        Contact your gym admin for a new link.    |
|                                                  |
+--------------------------------------------------+
```

- No WebSocket connection is attempted.
- No header or clock.
- Static page, no interactivity.

---

## 10. Branding Integration

### Data Source

Branding data is fetched from the `gyms` table during server-side token validation:

| DB Column | Type | Default | Usage |
|-----------|------|---------|-------|
| `logo_url` | `text \| null` | `null` | Header logo (left side). If null, show BeatMind AI default icon. |
| `primary_color` | `text \| null` | `null` | Header accent, active UI elements. Falls back to `#3B82F6`. |
| `secondary_color` | `text \| null` | `null` | Subtle backgrounds. Falls back to `#1E293B`. |
| `name` | `text` | Required | Header title text. |

### Application

#### Header

```
+--------------------------------------------------+
| [Logo] Gym Name           Timer  Status  Clock   |
+--------------------------------------------------+
```

- Logo: `<img>` element, max height 40px, aspect ratio preserved. Falls back to SVG icon.
- Gym name: rendered as text next to logo. Bold, white.
- Header background: `secondary_color` or default dark slate.
- Header bottom border: `primary_color` at 50% opacity, or default slate.

#### CSS Custom Properties

Set on the `TVDashboard` root container:

```tsx
const brandStyles = {
  "--brand-primary": gymConfig.primaryColor || "#3B82F6",
  "--brand-secondary": gymConfig.secondaryColor || "#1E293B",
} as React.CSSProperties;
```

Used in Tailwind via arbitrary value syntax:

```html
<header className="border-b-2 border-[var(--brand-primary)]/50 bg-[var(--brand-secondary)]">
```

#### What Branding Does NOT Affect

- HR zone colors (always the standard 5 colors)
- Card background base color (always slate-900/slate-800)
- Text colors within cards
- Coach AI overlay styling
- Connection status colors (green/red/yellow)

This ensures clinical accuracy and readability are never compromised by branding choices.

---

## Appendix A: TypeScript Interfaces

```tsx
// types/tv.ts

export interface GymConfig {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  language: "es" | "pt";
  timezone: string;
}

export interface AthleteData {
  sensorId: string;
  bpm: number;
  zone: number;
  zoneName: string;
  zoneColor: string;
  maxPercent: number;
  athleteName: string;
  athleteId: string | null;
  maxHr: number;
  active: boolean;
  history: number[];
}

export interface CoachMessage {
  analysis: string;
  athletes: Array<{
    sensorId: number;
    athleteId: string;
    athleteName: string;
  }>;
  messageId: string;
  receivedAt: number; // Date.now() when received
}

export type WebSocketMessage =
  | HRUpdateMessage
  | AICoachingMessage
  | SessionEventMessage;

export interface HRUpdateMessage {
  type: "hr-update";
  timestamp: string;
  sessionId: string;
  devices: Record<string, AthleteData>;
}

export interface AICoachingMessage {
  type: "ai-coaching";
  timestamp: string;
  sessionId: string;
  analysis: string;
  athletes: Array<{
    sensorId: number;
    athleteId: string;
    athleteName: string;
  }>;
  messageId: string;
}

export interface SessionEventMessage {
  type: "session-event";
  event: "started" | "ended";
  sessionId: string;
  startedAt?: string;
  endedAt?: string;
  classType?: string;
  trainerName?: string;
  duration?: number;
}
```

---

## Appendix B: Color Constants

```tsx
// lib/hr/zones.ts

export const HR_ZONE_COLORS = {
  rest: "#64748B",
  zone1: "#3B82F6",
  zone2: "#22C55E",
  zone3: "#EAB308",
  zone4: "#F97316",
  zone5: "#EF4444",
} as const;

export const HR_ZONES = [
  { zone: 0, name: "Rest",      color: HR_ZONE_COLORS.rest,  minPct: 0,    maxPct: 0.50 },
  { zone: 1, name: "Warm-up",   color: HR_ZONE_COLORS.zone1, minPct: 0.50, maxPct: 0.60 },
  { zone: 2, name: "Fat Burn",  color: HR_ZONE_COLORS.zone2, minPct: 0.60, maxPct: 0.70 },
  { zone: 3, name: "Aerobic",   color: HR_ZONE_COLORS.zone3, minPct: 0.70, maxPct: 0.80 },
  { zone: 4, name: "Threshold", color: HR_ZONE_COLORS.zone4, minPct: 0.80, maxPct: 0.90 },
  { zone: 5, name: "Maximum",   color: HR_ZONE_COLORS.zone5, minPct: 0.90, maxPct: 1.00 },
] as const;

// Localized zone names
export const ZONE_NAMES_ES = ["Reposo", "Calentamiento", "Quema de grasa", "Aerobico", "Umbral anaerobico", "Maximo esfuerzo"];
export const ZONE_NAMES_PT = ["Repouso", "Aquecimento", "Queima de gordura", "Aerobico", "Limiar anaerobico", "Esforco maximo"];
```

---

## Appendix C: Migration Checklist from burnapp

| burnapp Feature | File/Function | BeatMind AI Equivalent | Status |
|----------------|---------------|----------------------|--------|
| Grid init (8 slots) | `initGrid()` | `AthleteGrid.tsx` (dynamic, up to 20) | Rewrite |
| Card render | `renderAthleteCard()` | `AthleteCard.tsx` | Rewrite |
| Sparkline draw | `drawSparkline()` | `Sparkline.tsx` | Port logic |
| Coach overlay on card | `showCoachInCard()` | `CoachOverlay.tsx` | Port UX |
| Coach activation banner | `showCoachActivation()` | `CoachActivationBanner.tsx` | Port UX |
| Toast messages | `showToast()` | Removed (replaced by card overlay) | N/A |
| WebSocket connect | `connectWebSocket()` | `useWebSocket.ts` hook | Rewrite |
| Auto-reconnect | `scheduleReconnect()` | Inside `useWebSocket.ts` | Port logic |
| Signal check | `checkSignals()` | Server-side `active` flag | Simplified |
| Clock | `updateClock()` | `TVHeader.tsx` | Rewrite |
| Manual AI button | `requestAiAnalysis()` | Removed (TV is passive display) | N/A |
| No-connection overlay | `#noConnectionOverlay` | `ConnectionOverlay.tsx` | Port UX |
| HR zone calculation | `hr-zones.js` | `lib/hr/zones.ts` | Port to TS |
| DOM manipulation | Throughout | React state + JSX | Rewrite |
| CSS (inline) | `<style>` block | Tailwind CSS 4 classes | Rewrite |
