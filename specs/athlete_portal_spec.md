# Athlete Portal Specification

**Module:** Athlete Portal (`/athlete`)
**Version:** 1.0
**Date:** 2026-02-26
**Status:** Draft
**PRD Reference:** Section 4.4 - Portal del Atleta

---

## 1. Overview

The Athlete Portal is a self-service area where athletes view their personal training data collected via ANT+ heart rate monitors during gym sessions. It provides session history, heart rate analytics, progress tracking over time, and profile management including WhatsApp opt-in for automated post-session reports.

Athletes access only their own data. All queries are scoped to the authenticated athlete's `athlete_id` and the gym's `gym_id` derived from their Clerk organization membership.

---

## 2. Access Control

### Authentication

- **Provider:** Clerk
- **Required role:** `org:athlete` (Clerk Organization member role)
- **Organization context:** The athlete must have an active membership in exactly one Clerk Organization (gym). The `gym_id` is resolved from `auth().orgId` via the `gyms.clerk_org_id` column.

### Authorization Guard

All `/athlete/*` routes and `/api/v1/athlete/*` endpoints must be protected by a server-side guard that:

1. Verifies the user is authenticated via Clerk (`auth()`)
2. Verifies the user has the `org:athlete` role in their active organization
3. Resolves the `athlete_id` from the `athletes` table using `athletes.user_id = users.id` where `users.clerk_user_id = auth().userId`
4. Rejects with `403 Forbidden` if any check fails
5. Rejects with `404 Not Found` if no athlete profile exists for the authenticated user

```typescript
// lib/auth/guards.ts
export async function requireAthlete(): Promise<{
  userId: string;       // internal user UUID
  athleteId: string;    // athlete UUID
  gymId: string;        // gym UUID
  clerkUserId: string;  // Clerk user ID
}>;
```

### Middleware

Apply Clerk middleware at the layout level for the `(platform)/athlete` route group. The layout should call `requireAthlete()` and pass the resolved context via React context or prop drilling.

---

## 3. Pages and Routes

All athlete pages live under the `(platform)/athlete` route group and share a common layout with navigation.

| Route | Page | Priority | Description |
|-------|------|----------|-------------|
| `/athlete` | Dashboard | P0 | Last session summary, total sessions, weekly streak |
| `/athlete/sessions` | Session History | P0 | Paginated list of all sessions |
| `/athlete/sessions/[id]` | Session Detail | P1 | HR chart, zone distribution, AI messages |
| `/athlete/progress` | Progress Charts | P1 | Weekly and monthly trend charts |
| `/athlete/profile` | Profile | P0 | Edit personal info and WhatsApp preferences |

### Layout Structure

```
app/(platform)/athlete/
  layout.tsx              -- Shared layout with sidebar/nav, calls requireAthlete()
  page.tsx                -- Dashboard
  sessions/
    page.tsx              -- Session history list
    [id]/
      page.tsx            -- Session detail
  progress/
    page.tsx              -- Progress charts
  profile/
    page.tsx              -- Profile management
```

### Shared Layout (`layout.tsx`)

- Sidebar or top navigation with links: Dashboard, Sessions, Progress, Profile
- Display athlete name and gym name in the header
- Active route indicator
- Mobile-responsive: collapsible sidebar or bottom tab navigation
- The layout is a Server Component that resolves the athlete context and passes it down

---

## 4. Dashboard Features (P0)

**Route:** `/athlete`
**Component:** `app/(platform)/athlete/page.tsx` (Server Component with Client islands)

### Data Requirements

Fetched server-side via a single API call or direct DB query:

```typescript
interface DashboardData {
  lastSession: {
    id: string;
    date: string;           // ISO 8601
    durationSeconds: number;
    classType: string;       // "spinning" | "pilates" | "cycling" | etc.
    avgHr: number;
    maxHr: number;
    calories: number;
    trainerName: string;
  } | null;
  totalSessions: number;
  weeklyStreak: number;     // consecutive weeks with >= 1 session
  recentSessions: Array<{
    id: string;
    date: string;
    classType: string;
    durationSeconds: number;
    avgHr: number;
    calories: number;
  }>;                       // last 5 sessions
}
```

### UI Components

#### Last Session Card

- Prominently displayed at the top of the dashboard
- Shows: date (formatted as relative, e.g., "2 days ago" + absolute date), duration (mm:ss), class type (capitalized with icon), average HR (bpm), calories burned
- If no sessions exist, show an empty state: "No sessions yet. Your first session data will appear here."
- Clicking the card navigates to `/athlete/sessions/[id]`

#### Stats Row

Three stat cards displayed in a horizontal row (stacked on mobile):

| Card | Value | Label | Icon |
|------|-------|-------|------|
| Total Sessions | `totalSessions` | "Total Sessions" | Activity icon |
| Weekly Streak | `weeklyStreak` | "Week Streak" | Flame icon |
| Last Session Calories | `lastSession.calories` | "Last Calories" | Zap icon |

#### Recent Sessions

- List of the 5 most recent sessions below the stats row
- Each item shows: date, class type, duration, avg HR, calories
- Each item links to `/athlete/sessions/[id]`
- "View all sessions" link at the bottom navigates to `/athlete/sessions`

### Weekly Streak Calculation

```sql
-- Conceptual query: count consecutive weeks (Mon-Sun) with at least 1 session
-- Working backwards from current week
WITH weekly AS (
  SELECT DISTINCT date_trunc('week', s.started_at) AS week_start
  FROM sessions s
  JOIN session_athletes sa ON sa.session_id = s.id
  WHERE sa.athlete_id = :athleteId
    AND s.status = 'completed'
  ORDER BY week_start DESC
)
-- Count consecutive weeks from current week backwards
```

Implementation in application code:

```typescript
function calculateWeeklyStreak(sessionDates: Date[]): number {
  // Group sessions by ISO week
  // Starting from the current week, count backwards
  // Streak breaks when a week has zero sessions
  // Current week counts even if incomplete
}
```

---

## 5. Session History (P0)

**Route:** `/athlete/sessions`
**Component:** `app/(platform)/athlete/sessions/page.tsx`

### Data Requirements

```typescript
interface SessionListParams {
  page: number;        // default: 1
  pageSize: number;    // default: 20, max: 50
  sortBy: "date";      // only date sorting for now
  sortOrder: "desc" | "asc"; // default: "desc"
}

interface SessionListResponse {
  sessions: Array<{
    id: string;
    date: string;              // ISO 8601 (sessions.started_at)
    classType: string;
    durationSeconds: number;
    avgHr: number;
    maxHr: number;
    calories: number;
    trainerName: string | null;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
```

### Query

```sql
SELECT
  s.id,
  s.started_at AS date,
  s.class_type,
  s.duration_seconds,
  sa.avg_hr,
  sa.max_hr,
  sa.calories,
  u.name AS trainer_name
FROM sessions s
JOIN session_athletes sa ON sa.session_id = s.id
LEFT JOIN users u ON u.id = s.trainer_id
WHERE sa.athlete_id = :athleteId
  AND s.gym_id = :gymId
  AND s.status = 'completed'
ORDER BY s.started_at DESC
LIMIT :pageSize OFFSET :offset;
```

### UI Components

#### Session List Table

Desktop layout (table):

| Column | Width | Content |
|--------|-------|---------|
| Date | 20% | Formatted date (e.g., "Feb 24, 2026") |
| Class | 15% | Class type with colored badge |
| Duration | 12% | Formatted as `mm:ss` |
| Avg HR | 12% | `{value} bpm` |
| Max HR | 12% | `{value} bpm` |
| Calories | 12% | `{value} kcal` |
| Action | 17% | "View Details" link |

Mobile layout (card list): Each session rendered as a card with the same data stacked vertically.

#### Pagination

- Page numbers with Previous/Next buttons
- URL-driven: `/athlete/sessions?page=2`
- Show "Showing X-Y of Z sessions"

#### Empty State

"No sessions found. Once you complete your first training session with a heart rate monitor, it will appear here."

---

## 6. Session Detail (P1)

**Route:** `/athlete/sessions/[id]`
**Component:** `app/(platform)/athlete/sessions/[id]/page.tsx`

### Data Requirements

```typescript
interface SessionDetailResponse {
  session: {
    id: string;
    date: string;
    classType: string;
    durationSeconds: number;
    trainerName: string | null;
    gymName: string;
  };
  stats: {
    avgHr: number;
    maxHr: number;
    minHr: number;
    calories: number;
    maxHrPercent: number;   // (maxHr / athlete.max_hr) * 100
  };
  zones: {
    zone1Seconds: number;   // Recovery (50-60% max HR)
    zone2Seconds: number;   // Fat Burn (60-70%)
    zone3Seconds: number;   // Cardio (70-80%)
    zone4Seconds: number;   // Peak (80-90%)
    zone5Seconds: number;   // Extreme (90-100%)
  };
  hrTimeSeries: Array<{
    timestamp: string;      // ISO 8601
    hr: number;             // bpm
    zone: number;           // 1-5
  }>;
  aiMessages: Array<{
    id: string;
    message: string;
    timestamp: string;
  }>;
}
```

### Access Control

The session must belong to the authenticated athlete. Verify via `session_athletes` join:

```sql
SELECT 1 FROM session_athletes
WHERE session_id = :sessionId AND athlete_id = :athleteId;
```

Return `404` if no matching row.

### HR Time Series Query

```sql
SELECT
  recorded_at AS timestamp,
  heart_rate_bpm AS hr,
  hr_zone AS zone
FROM hr_readings
WHERE session_id = :sessionId
  AND athlete_id = :athleteId
  AND device_active = true
ORDER BY recorded_at ASC;
```

**Data reduction:** HR readings are stored at ~1 reading per 5 seconds. For sessions up to 2 hours, this yields a maximum of ~1,440 data points, which is acceptable for Recharts rendering. For longer sessions (unlikely but possible), downsample server-side to 1,000 points using LTTB (Largest Triangle Three Buckets) algorithm.

### AI Messages Query

```sql
SELECT
  acm.id,
  acm.message,
  acm.created_at AS timestamp
FROM ai_coaching_messages acm
WHERE acm.session_id = :sessionId
  AND acm.gym_id = :gymId
  AND acm.athlete_summaries ? :athleteId::text
ORDER BY acm.created_at ASC;
```

Note: `athlete_summaries` is a JSONB column. The `?` operator checks if the athlete's ID exists as a key in the JSONB object. Filter messages that specifically mention this athlete.

### UI Components

#### Session Header

- Back link to `/athlete/sessions`
- Session date, class type, duration, trainer name, gym name
- Rendered as a compact header bar

#### Stats Cards Row

Four cards in a horizontal row:

| Card | Value | Unit |
|------|-------|------|
| Average HR | `stats.avgHr` | bpm |
| Max HR | `stats.maxHr` | bpm |
| Min HR | `stats.minHr` | bpm |
| Calories | `stats.calories` | kcal |

#### HR Chart (Recharts LineChart)

```typescript
// components/athlete/HrLineChart.tsx
"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface HrLineChartProps {
  data: Array<{ timestamp: string; hr: number; zone: number }>;
  maxHr: number;  // athlete's configured max HR
}
```

- **X-axis:** Time elapsed (formatted as mm:ss from session start)
- **Y-axis:** Heart rate (bpm), range from `minHr - 10` to `maxHr + 10`
- **Line color:** Gradient or segmented by zone (blue/green/yellow/orange/red)
- **Reference lines:** Horizontal dashed lines at each zone threshold
- **Tooltip:** Shows time, HR value, zone name, zone color
- **Responsive:** Full width of container, 300px height minimum

#### Zone Distribution (Recharts BarChart)

```typescript
// components/athlete/ZoneBarChart.tsx
"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface ZoneBarChartProps {
  zones: {
    zone1Seconds: number;
    zone2Seconds: number;
    zone3Seconds: number;
    zone4Seconds: number;
    zone5Seconds: number;
  };
}
```

- **Horizontal bar chart** with 5 bars (one per zone)
- **Bar colors:** Zone 1 = `#3B82F6` (blue), Zone 2 = `#22C55E` (green), Zone 3 = `#EAB308` (yellow), Zone 4 = `#F97316` (orange), Zone 5 = `#EF4444` (red)
- **Labels:** Zone name + percentage of total time
- **Value:** Formatted as `mm:ss`

#### AI Coaching Messages

- Chronological list of AI messages received during the session
- Each message shows:
  - Timestamp (relative to session start, e.g., "12:34 into session")
  - Message text
- Styled as chat bubbles with a coach avatar/icon
- Empty state: "No AI coaching messages for this session."

---

## 7. Progress Charts (P1)

**Route:** `/athlete/progress`
**Component:** `app/(platform)/athlete/progress/page.tsx`

### Data Requirements

```typescript
interface ProgressParams {
  period: "weekly" | "monthly";  // default: "weekly"
  weeks?: number;                // default: 12 (for weekly)
  months?: number;               // default: 6 (for monthly)
}

interface ProgressResponse {
  weekly: Array<{
    weekStart: string;           // ISO 8601 (Monday)
    sessionsCount: number;
    avgHr: number | null;
    totalCalories: number;
    totalDurationSeconds: number;
    zoneDistribution: {
      zone1Pct: number;          // percentage 0-100
      zone2Pct: number;
      zone3Pct: number;
      zone4Pct: number;
      zone5Pct: number;
    };
  }>;
  monthly: Array<{
    monthStart: string;          // ISO 8601 (1st of month)
    sessionsCount: number;
    avgHr: number | null;
    totalCalories: number;
    totalDurationSeconds: number;
    zoneDistribution: {
      zone1Pct: number;
      zone2Pct: number;
      zone3Pct: number;
      zone4Pct: number;
      zone5Pct: number;
    };
  }>;
}
```

### Aggregation Query (Weekly)

```sql
SELECT
  date_trunc('week', s.started_at) AS week_start,
  COUNT(DISTINCT s.id) AS sessions_count,
  ROUND(AVG(sa.avg_hr)) AS avg_hr,
  SUM(sa.calories) AS total_calories,
  SUM(s.duration_seconds) AS total_duration_seconds,
  SUM(sa.time_zone_1_s) AS total_zone1,
  SUM(sa.time_zone_2_s) AS total_zone2,
  SUM(sa.time_zone_3_s) AS total_zone3,
  SUM(sa.time_zone_4_s) AS total_zone4,
  SUM(sa.time_zone_5_s) AS total_zone5
FROM sessions s
JOIN session_athletes sa ON sa.session_id = s.id
WHERE sa.athlete_id = :athleteId
  AND s.gym_id = :gymId
  AND s.status = 'completed'
  AND s.started_at >= :startDate
GROUP BY week_start
ORDER BY week_start ASC;
```

Zone percentages are calculated in application code: `zonePct = (zoneSeconds / totalZoneSeconds) * 100`.

### UI Components

#### Period Toggle

- Toggle button group: "Weekly" | "Monthly"
- URL-driven: `/athlete/progress?period=weekly`
- Default: weekly

#### Sessions Count Chart (Recharts BarChart)

- **X-axis:** Week or month label (e.g., "Feb 17" or "Feb 2026")
- **Y-axis:** Number of sessions
- **Bar color:** Primary brand color
- **Goal line:** Optional reference line at target sessions/week if configured

#### Average HR Trend (Recharts LineChart)

- **X-axis:** Week or month
- **Y-axis:** Average HR (bpm)
- **Line:** Smooth curve with data points
- **Tooltip:** Week/month, avg HR value

#### Calories Trend (Recharts BarChart)

- **X-axis:** Week or month
- **Y-axis:** Total calories
- **Bar color:** Gradient (lighter for lower values)

#### Zone Distribution Evolution (Recharts StackedBarChart)

- **X-axis:** Week or month
- **Y-axis:** Percentage (0-100%)
- **Stacked bars:** 5 segments per bar, one per zone, using zone colors
- Shows how the athlete's time distribution across zones changes over time

#### Empty State

"Not enough data to show progress charts. Complete a few sessions to start tracking your trends."

Show the empty state if fewer than 2 data points exist for the selected period.

---

## 8. Profile Management (P0)

**Route:** `/athlete/profile`
**Component:** `app/(platform)/athlete/profile/page.tsx`

### Data Requirements

```typescript
interface AthleteProfile {
  // Editable fields
  name: string;
  age: number | null;
  weightKg: number | null;
  maxHr: number;                  // default: 190
  phone: string | null;           // WhatsApp number, E.164 format
  whatsappOptIn: boolean;         // default: false

  // Read-only fields
  email: string;
  gymName: string;
}
```

### Form Validation

| Field | Type | Validation | Required |
|-------|------|------------|----------|
| `name` | text | Min 2 chars, max 100 chars | Yes |
| `age` | number | Integer, range 10-100 | No |
| `weightKg` | number | Range 20.0-300.0, 1 decimal | No |
| `maxHr` | number | Integer, range 100-230 | Yes |
| `phone` | tel | E.164 format (e.g., +5511999999999) | No |
| `whatsappOptIn` | toggle | Boolean; can only be `true` if `phone` is set | No |

### Validation Rules

```typescript
// lib/validation/athlete-profile.ts
import { z } from "zod";

export const athleteProfileSchema = z.object({
  name: z.string().min(2).max(100),
  age: z.number().int().min(10).max(100).nullable(),
  weightKg: z.number().min(20).max(300).nullable(),
  maxHr: z.number().int().min(100).max(230),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/).nullable(),
  whatsappOptIn: z.boolean(),
}).refine(
  (data) => !data.whatsappOptIn || (data.phone !== null && data.phone.length > 0),
  { message: "Phone number is required to enable WhatsApp reports", path: ["whatsappOptIn"] }
);
```

### UI Components

#### Profile Form

- Standard form layout with labeled inputs
- Read-only fields (`email`, `gymName`) rendered as disabled inputs or plain text
- WhatsApp opt-in section:
  - Phone input with country code selector or E.164 format hint
  - Toggle switch: "Receive post-session reports via WhatsApp"
  - Helper text: "You'll receive an automated summary after each training session."
  - Toggle is disabled if phone is empty, with tooltip explaining why
- Save button at the bottom
- Success toast notification on save
- Inline validation errors displayed below each field

#### Max HR Helper

Below the `maxHr` input, show a helper:

- Text: "Don't know your max HR? A common estimate is 220 - age."
- If `age` is filled, show: "Based on your age: estimated max HR = {220 - age} bpm"
- "Use estimate" button that auto-fills the `maxHr` field

---

## 9. API Endpoints

All endpoints require Clerk authentication and `org:athlete` role. The `athleteId` and `gymId` are derived server-side from the authenticated user's Clerk session -- they are never passed as URL or body parameters.

### GET /api/v1/athlete/profile

Returns the authenticated athlete's profile.

**Response:** `200 OK`

```json
{
  "data": {
    "name": "Carlos Silva",
    "email": "carlos@example.com",
    "age": 28,
    "weightKg": 75.0,
    "maxHr": 192,
    "phone": "+5511999999999",
    "whatsappOptIn": true,
    "gymName": "Studio Cycling SP"
  }
}
```

**Errors:**
- `401`: Not authenticated
- `403`: Not an athlete
- `404`: No athlete profile found

---

### PATCH /api/v1/athlete/profile

Updates the authenticated athlete's editable profile fields.

**Request Body:** (all fields optional, only provided fields are updated)

```json
{
  "name": "Carlos Silva",
  "age": 28,
  "weightKg": 75.0,
  "maxHr": 192,
  "phone": "+5511999999999",
  "whatsappOptIn": true
}
```

**Response:** `200 OK`

```json
{
  "data": {
    "name": "Carlos Silva",
    "email": "carlos@example.com",
    "age": 28,
    "weightKg": 75.0,
    "maxHr": 192,
    "phone": "+5511999999999",
    "whatsappOptIn": true,
    "gymName": "Studio Cycling SP"
  }
}
```

**Validation:** Uses `athleteProfileSchema.partial()` for PATCH semantics. Only provided fields are validated and updated.

**Errors:**
- `400`: Validation error (returns field-level errors)
- `401`: Not authenticated
- `403`: Not an athlete

---

### GET /api/v1/athlete/sessions

Returns paginated session history for the authenticated athlete.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number (1-indexed) |
| `pageSize` | number | 20 | Items per page (max: 50) |
| `sortOrder` | string | "desc" | "asc" or "desc" by date |

**Response:** `200 OK`

```json
{
  "data": {
    "sessions": [
      {
        "id": "uuid-here",
        "date": "2026-02-24T18:30:00Z",
        "classType": "spinning",
        "durationSeconds": 3600,
        "avgHr": 145,
        "maxHr": 178,
        "calories": 520,
        "trainerName": "Ana Costa"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "totalItems": 47,
      "totalPages": 3
    }
  }
}
```

**Errors:**
- `400`: Invalid query params
- `401`: Not authenticated
- `403`: Not an athlete

---

### GET /api/v1/athlete/sessions/[id]

Returns detailed data for a specific session including HR time series and AI messages.

**URL Parameters:**
- `id`: Session UUID

**Response:** `200 OK`

```json
{
  "data": {
    "session": {
      "id": "uuid-here",
      "date": "2026-02-24T18:30:00Z",
      "classType": "spinning",
      "durationSeconds": 3600,
      "trainerName": "Ana Costa",
      "gymName": "Studio Cycling SP"
    },
    "stats": {
      "avgHr": 145,
      "maxHr": 178,
      "minHr": 98,
      "calories": 520,
      "maxHrPercent": 92.7
    },
    "zones": {
      "zone1Seconds": 180,
      "zone2Seconds": 720,
      "zone3Seconds": 1200,
      "zone4Seconds": 1080,
      "zone5Seconds": 420
    },
    "hrTimeSeries": [
      { "timestamp": "2026-02-24T18:30:05Z", "hr": 98, "zone": 1 },
      { "timestamp": "2026-02-24T18:30:10Z", "hr": 102, "zone": 1 }
    ],
    "aiMessages": [
      {
        "id": "uuid-here",
        "message": "Carlos, great intensity! You're hitting zone 4 at 172 BPM. Keep that rhythm for the next 2 minutes!",
        "timestamp": "2026-02-24T18:45:30Z"
      }
    ]
  }
}
```

**Errors:**
- `401`: Not authenticated
- `403`: Not an athlete
- `404`: Session not found or does not belong to this athlete

---

### GET /api/v1/athlete/progress

Returns aggregated progress data for weekly and monthly trends.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `weeks` | number | 12 | Number of weeks to include (max: 52) |
| `months` | number | 6 | Number of months to include (max: 24) |

**Response:** `200 OK`

```json
{
  "data": {
    "weekly": [
      {
        "weekStart": "2026-02-17T00:00:00Z",
        "sessionsCount": 3,
        "avgHr": 148,
        "totalCalories": 1560,
        "totalDurationSeconds": 10800,
        "zoneDistribution": {
          "zone1Pct": 5.0,
          "zone2Pct": 20.0,
          "zone3Pct": 35.0,
          "zone4Pct": 30.0,
          "zone5Pct": 10.0
        }
      }
    ],
    "monthly": [
      {
        "monthStart": "2026-02-01T00:00:00Z",
        "sessionsCount": 12,
        "avgHr": 146,
        "totalCalories": 6240,
        "totalDurationSeconds": 43200,
        "zoneDistribution": {
          "zone1Pct": 6.0,
          "zone2Pct": 22.0,
          "zone3Pct": 33.0,
          "zone4Pct": 28.0,
          "zone5Pct": 11.0
        }
      }
    ]
  }
}
```

**Errors:**
- `400`: Invalid query params
- `401`: Not authenticated
- `403`: Not an athlete

---

## 10. UI Components

### Component Inventory

All components live under `components/athlete/`.

```
components/athlete/
  StatCard.tsx                -- Reusable stat card (icon, value, label)
  SessionCard.tsx             -- Last session summary card (dashboard)
  SessionListItem.tsx         -- Single row/card in session history
  SessionList.tsx             -- Session list with pagination
  HrLineChart.tsx             -- HR over time (Recharts LineChart)
  ZoneBarChart.tsx            -- Zone distribution (Recharts BarChart)
  AiMessageList.tsx           -- List of AI coaching messages
  ProgressChart.tsx           -- Wrapper for progress trend charts
  ZoneEvolutionChart.tsx      -- Stacked bar chart for zone trends
  ProfileForm.tsx             -- Profile edit form
  WeeklyStreakBadge.tsx       -- Streak indicator with flame icon
  PeriodToggle.tsx            -- Weekly/Monthly toggle for progress page
  EmptyState.tsx              -- Reusable empty state with icon and message
  Pagination.tsx              -- Pagination controls
```

### StatCard

```typescript
interface StatCardProps {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  trend?: {
    direction: "up" | "down" | "neutral";
    value: string;          // e.g., "+12%"
  };
}
```

- Rendered as a bordered card with subtle shadow
- Icon on the left, value large and bold, label smaller and muted
- Optional trend indicator below the value (green arrow up, red arrow down)

### HrLineChart

```typescript
interface HrLineChartProps {
  data: Array<{ timestamp: string; hr: number; zone: number }>;
  maxHr: number;
  sessionStartTime: string;
}
```

- Client Component (`"use client"`)
- Responsive container, minimum height 300px
- X-axis: elapsed time from session start, formatted as `mm:ss`
- Y-axis: HR in bpm
- Line segments colored by zone
- Horizontal reference lines at zone boundaries (calculated from `maxHr`):
  - Zone 1/2 boundary: `maxHr * 0.60`
  - Zone 2/3 boundary: `maxHr * 0.70`
  - Zone 3/4 boundary: `maxHr * 0.80`
  - Zone 4/5 boundary: `maxHr * 0.90`
- Tooltip shows: time, HR, zone name, zone color

### ZoneBarChart

```typescript
interface ZoneBarChartProps {
  zones: {
    zone1Seconds: number;
    zone2Seconds: number;
    zone3Seconds: number;
    zone4Seconds: number;
    zone5Seconds: number;
  };
}
```

- Client Component (`"use client"`)
- Horizontal bar chart, one bar per zone
- Zone labels on the Y-axis: "Zone 1 - Recovery", "Zone 2 - Fat Burn", "Zone 3 - Cardio", "Zone 4 - Peak", "Zone 5 - Extreme"
- Bar length proportional to time in zone
- Bar label shows formatted duration (`mm:ss`) and percentage

### Zone Color Constants

```typescript
// lib/hr/zones.ts
export const ZONE_COLORS = {
  1: { name: "Recovery",  color: "#3B82F6", bg: "bg-blue-500"   },
  2: { name: "Fat Burn",  color: "#22C55E", bg: "bg-green-500"  },
  3: { name: "Cardio",    color: "#EAB308", bg: "bg-yellow-500" },
  4: { name: "Peak",      color: "#F97316", bg: "bg-orange-500" },
  5: { name: "Extreme",   color: "#EF4444", bg: "bg-red-500"    },
} as const;

export const ZONE_THRESHOLDS = {
  1: { min: 0.50, max: 0.60 },
  2: { min: 0.60, max: 0.70 },
  3: { min: 0.70, max: 0.80 },
  4: { min: 0.80, max: 0.90 },
  5: { min: 0.90, max: 1.00 },
} as const;
```

### ProfileForm

```typescript
interface ProfileFormProps {
  initialData: AthleteProfile;
}
```

- Client Component (`"use client"`)
- Uses React Hook Form or native form with Server Actions
- Controlled inputs with inline validation
- Submit handler calls `PATCH /api/v1/athlete/profile`
- Loading state on submit button
- Success/error toast notifications
- Optimistic update: form reflects saved values after successful response

### Pagination

```typescript
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  baseUrl: string;          // e.g., "/athlete/sessions"
}
```

- Previous/Next buttons (disabled at boundaries)
- Page number buttons with ellipsis for large ranges
- Uses `<Link>` with search params for server-side pagination

---

## 11. Data Scoping and Security

### Gym Scoping

Every database query in the athlete portal must include both `athlete_id` and `gym_id` filters. The `gym_id` is derived from the Clerk organization, not from user input.

```typescript
// All athlete queries follow this pattern:
const sessions = await db
  .select()
  .from(sessionsTable)
  .innerJoin(sessionAthletesTable, eq(sessionsTable.id, sessionAthletesTable.sessionId))
  .where(
    and(
      eq(sessionAthletesTable.athleteId, athleteId),
      eq(sessionsTable.gymId, gymId),
      eq(sessionsTable.status, "completed")
    )
  );
```

### Data Isolation Rules

1. Athletes can only access their own `session_athletes` records
2. Athletes can only view `hr_readings` for their own `athlete_id`
3. Athletes can only view `ai_coaching_messages` that reference their `athlete_id` in the `athlete_summaries` JSONB
4. Athletes cannot access other athletes' data, even within the same gym
5. Athletes cannot modify session data, HR readings, or AI messages (read-only)
6. Athletes can only modify their own `athletes` record (profile)

### Rate Limiting

| Endpoint | Rate Limit |
|----------|-----------|
| `GET /api/v1/athlete/profile` | 30 req/min |
| `PATCH /api/v1/athlete/profile` | 10 req/min |
| `GET /api/v1/athlete/sessions` | 30 req/min |
| `GET /api/v1/athlete/sessions/[id]` | 30 req/min |
| `GET /api/v1/athlete/progress` | 10 req/min |

---

## 12. Error Handling

### API Error Response Format

All endpoints return errors in a consistent format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [
      { "field": "maxHr", "message": "Must be between 100 and 230" }
    ]
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid Clerk session |
| `FORBIDDEN` | 403 | User does not have `org:athlete` role |
| `NOT_FOUND` | 404 | Resource not found or does not belong to athlete |
| `VALIDATION_ERROR` | 400 | Request body or params failed validation |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### Client-Side Error Handling

- API errors displayed as toast notifications or inline messages
- Network errors trigger a retry prompt
- 401 errors redirect to sign-in page
- 403 errors show an "access denied" page

---

## 13. Performance Considerations

### Server Components

All page-level components are Server Components by default. Only chart components and interactive forms use `"use client"`.

### Data Fetching

- Dashboard: Single server-side fetch combining last session, total count, streak, and recent sessions
- Session list: Server-side with URL-based pagination (no client-side state)
- Session detail: Server-side fetch, charts hydrated client-side
- Progress: Server-side aggregation, charts hydrated client-side
- Profile: Server-side initial load, client-side form submission

### Caching

- Session list and detail pages: `revalidate = 60` (1 minute) or on-demand revalidation after new sessions
- Progress data: `revalidate = 300` (5 minutes) since aggregations are not time-critical
- Profile: No caching (always fresh on load, optimistic updates on save)

### HR Time Series Optimization

For session detail, if the number of `hr_readings` rows exceeds 1,000 for a single session/athlete, apply server-side downsampling:

```typescript
function downsampleLTTB(
  data: Array<{ timestamp: number; hr: number }>,
  targetPoints: number
): Array<{ timestamp: number; hr: number }>;
```

---

## 14. Testing Requirements

### Unit Tests

- `calculateWeeklyStreak()` function with edge cases (no sessions, single session, gap in weeks, current week incomplete)
- `athleteProfileSchema` validation (valid inputs, boundary values, phone format, opt-in without phone)
- Zone percentage calculations
- Duration formatting utilities
- LTTB downsampling algorithm

### Integration Tests

- `requireAthlete()` guard: valid athlete, non-athlete role, unauthenticated, no athlete profile
- Each API endpoint: success case, auth failure, validation failure, not-found case
- Cross-athlete data isolation: athlete A cannot access athlete B's sessions

### Component Tests

- `StatCard`: renders value and label correctly
- `ProfileForm`: submits valid data, shows validation errors, handles API errors
- `Pagination`: renders correct page numbers, disables buttons at boundaries

---

## 15. Implementation Phases

### Phase 1 (P0 - Weeks 10-11)

1. Implement `requireAthlete()` auth guard
2. Athlete layout with navigation
3. `GET /api/v1/athlete/profile` and `PATCH /api/v1/athlete/profile`
4. Profile page with form
5. `GET /api/v1/athlete/sessions` with pagination
6. Session history page
7. Dashboard page (last session, total count, streak, recent sessions)

### Phase 2 (P1 - Weeks 12-13)

1. `GET /api/v1/athlete/sessions/[id]` with HR data and AI messages
2. Session detail page with HR chart, zone chart, AI messages
3. `GET /api/v1/athlete/progress` with weekly/monthly aggregations
4. Progress page with trend charts and zone evolution
5. LTTB downsampling for large HR datasets
6. Empty states and edge case handling

### Phase 3 (Polish - Week 14)

1. Mobile responsiveness for all pages
2. Loading skeletons for chart components
3. Error boundaries for chart rendering failures
4. Performance optimization (query tuning, caching headers)
5. Accessibility audit (ARIA labels, keyboard navigation, color contrast)
