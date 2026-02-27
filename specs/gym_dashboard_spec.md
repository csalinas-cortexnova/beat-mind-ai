# Gym Dashboard Specification

**Module:** Gym Dashboard (`/gym`)
**Version:** 1.0
**Date:** 2026-02-26
**Status:** Draft
**PRD Reference:** BeatMind AI PRD v1.0, Section 4.2

---

## 1. Overview

The Gym Dashboard is the primary management interface for gym owners and trainers within the BeatMind AI platform. It provides tools for managing athletes, trainers, sessions, branding, and reports. The dashboard operates within a multi-tenant architecture where each gym is a Clerk Organization, and all data is scoped by `gym_id`.

This module covers everything under the `/gym` route group and its corresponding API endpoints under `/api/v1/gym/*`.

**Key Capabilities:**
- Real-time session monitoring (web mirror of TV dashboard)
- Athlete and trainer CRUD with Clerk integration
- Band-to-athlete mapping for ANT+ sensors
- White-label branding configuration
- Session history and per-athlete statistics
- Post-session reports with WhatsApp delivery

---

## 2. Access Control

### 2.1 Roles

Access to the `/gym/*` routes requires Clerk authentication with an active Organization membership. Two roles have access:

| Role | Clerk Role | Description |
|------|-----------|-------------|
| **Gym Owner** | `org:admin` | Full access to all gym features including settings, branding, trainer management, and TV token |
| **Trainer** | `org:trainer` | Limited access to session monitoring, athlete management, and reports |

### 2.2 Permission Matrix

| Feature | Gym Owner | Trainer |
|---------|:---------:|:-------:|
| Dashboard overview | Yes | Yes |
| Gym settings (profile) | Yes | No |
| White-label branding | Yes | No |
| TV token management | Yes | No |
| Athlete CRUD | Yes | Yes |
| Band assignment | Yes | Yes |
| Trainer management | Yes | No |
| Session monitoring | Yes | Yes |
| Session start/end | Yes | Yes |
| Session history | Yes | Yes |
| Reports | Yes | Yes |
| WhatsApp send | Yes | Yes |

### 2.3 Route Protection

All `/gym/*` routes are protected by a middleware guard that:

1. Verifies the user is authenticated via Clerk.
2. Verifies the user belongs to an active Organization.
3. Extracts `gym_id` from the Organization's `clerk_org_id` mapping in the `gyms` table.
4. Injects `gym_id` into the request context via `withGymScope(gymId)`.
5. For Owner-only routes (`/gym/settings`, `/gym/branding`, `/gym/trainers`), verifies the user's Organization role is `org:admin`.

**Implementation file:** `lib/auth/guards.ts`

```typescript
// Guard function signature
export async function requireGymAccess(
  requiredRole?: "org:admin" | "org:trainer"
): Promise<{ userId: string; gymId: string; role: string }>
```

---

## 3. Pages and Routes

### 3.1 Route Map

All routes use the Next.js 16 App Router under the `app/(platform)/gym/` route group.

```
app/(platform)/gym/
  layout.tsx                    -- Gym dashboard shell (sidebar + header)
  page.tsx                      -- Dashboard overview
  settings/
    page.tsx                    -- Gym profile settings (Owner only)
  branding/
    page.tsx                    -- White-label configuration (Owner only)
  athletes/
    page.tsx                    -- Athlete list
    new/
      page.tsx                  -- Create athlete form
    [id]/
      page.tsx                  -- Athlete detail/edit
      bands/
        page.tsx                -- Band assignment
  trainers/
    page.tsx                    -- Trainer list (Owner only)
    new/
      page.tsx                  -- Invite trainer (Owner only)
  sessions/
    page.tsx                    -- Session history
    active/
      page.tsx                  -- Live session view
    [id]/
      page.tsx                  -- Session detail
  reports/
    page.tsx                    -- Reports overview
```

### 3.2 Page Specifications

#### 3.2.1 `/gym` -- Dashboard Overview

**Purpose:** Landing page after login. Shows current gym status at a glance.

**Sections:**

| Section | Content | Data Source |
|---------|---------|-------------|
| Active Session Banner | If a session is active: class type, duration timer, athlete count, link to `/gym/sessions/active` | `GET /api/v1/gym/sessions/active` |
| Today's Stats | Sessions today, total athletes trained, average HR across sessions | Aggregated from `sessions` + `session_athletes` where `started_at` is today |
| Quick Actions | Buttons: "Start Session", "Add Athlete", "View Reports" | Static links |
| Recent Sessions | Last 5 sessions: date, class type, duration, athlete count | `GET /api/v1/gym/sessions?limit=5` |
| Agent Status | Connection status of the gym's mini PC agent (online/offline, last heartbeat) | `agents` table filtered by `gym_id` |

**Layout:** Single column on mobile, two-column grid on desktop. Active session banner spans full width at top.

#### 3.2.2 `/gym/settings` -- Gym Profile

**Access:** Owner only.

**Form Fields:**

| Field | Type | Validation | Required |
|-------|------|------------|:--------:|
| Gym Name | Text input | 2-100 chars | Yes |
| Address | Textarea | Max 500 chars | No |
| Phone | Text input | E.164 format | No |
| Timezone | Select dropdown | IANA timezone list | Yes |
| Language | Select dropdown | `es` (Spanish), `pt` (Portuguese) | Yes |

**TV Token Section:**
- Display current `tv_access_token` (masked, with copy button)
- "Regenerate Token" button with confirmation dialog
- Warning text: "Regenerating will disconnect any active TV displays"
- Displays the full TV URL: `https://{domain}/tv/{gymId}?token={token}`

**API:** `GET /api/v1/gym/profile`, `PATCH /api/v1/gym/profile`

#### 3.2.3 `/gym/branding` -- White-Label Configuration

**Access:** Owner only.

**Form Fields:**

| Field | Type | Validation | Required |
|-------|------|------------|:--------:|
| Logo | File upload (drag & drop) | PNG/SVG/WEBP, max 2MB, min 200x200px | No |
| Primary Color | Color picker + hex input | Valid hex color `#RRGGBB` | Yes (default: `#FF6B35`) |
| Secondary Color | Color picker + hex input | Valid hex color `#RRGGBB` | Yes (default: `#1A1A2E`) |

**Preview Panel:**
- Live preview showing how branding appears on the TV dashboard (miniature mockup with the logo and colors applied).
- Shows both light and dark background previews.

**Logo Upload Flow:**
1. User drops or selects image file.
2. Client-side validation (format, size, dimensions).
3. Upload to server (stored in configured storage, URL saved to `gyms.logo_url`).
4. Display current logo with "Remove" option.

**API:** `PATCH /api/v1/gym/profile` (logo_url, primary_color, secondary_color)

#### 3.2.4 `/gym/athletes` -- Athlete List

**Access:** Owner + Trainer.

**Table Columns:**

| Column | Type | Sortable | Filterable |
|--------|------|:--------:|:----------:|
| Name | Text | Yes | Yes (search) |
| Email | Text | No | No |
| Phone | Text | No | No |
| Age | Number | Yes | No |
| Weight (kg) | Number | No | No |
| Max HR | Number | No | No |
| Assigned Band | Text (sensor_id or "Unassigned") | No | Yes (assigned/unassigned) |
| WhatsApp Opt-in | Badge (Yes/No) | No | Yes |
| Status | Badge (Active/Inactive) | No | Yes |

**Actions:**
- "Add Athlete" button (links to `/gym/athletes/new`)
- Per-row actions: Edit, Assign Band, Toggle Active/Inactive
- Bulk actions (P2): CSV export, CSV import
- Search: filters by name (client-side for <100 athletes, server-side for more)

**Pagination:** 25 per page, server-side pagination via `offset` + `limit` query params.

**Empty State:** Illustration + "No athletes yet. Add your first athlete to get started." with CTA button.

#### 3.2.5 `/gym/athletes/new` and `/gym/athletes/[id]` -- Athlete Create/Edit

**Access:** Owner + Trainer.

**Form Fields:**

| Field | Type | Validation | Required |
|-------|------|------------|:--------:|
| Name | Text input | 2-100 chars | Yes |
| Email | Email input | Valid email format | No |
| Phone (WhatsApp) | Phone input with country code | E.164 format | No |
| Age | Number input | 10-99 | No |
| Weight (kg) | Number input | 20-300, one decimal | No |
| Max HR | Number input | 100-250 (default: 190) | Yes |
| WhatsApp Opt-in | Toggle switch | Boolean | No (default: false) |

**Behavior:**
- On create: inserts into `athletes` table with `gym_id` from context, `is_active = true`.
- On edit: loads existing athlete, updates only changed fields.
- WhatsApp opt-in toggle is disabled (grayed out) if phone number is empty, with tooltip: "Add a WhatsApp number first".
- The "Max HR" field includes a helper: "If unknown, use 220 - age".

**Delete/Deactivate:** Soft delete via `is_active = false`. Confirmation modal: "Deactivating will remove this athlete from future sessions. Their history is preserved."

#### 3.2.6 `/gym/athletes/[id]/bands` -- Band Assignment

**Access:** Owner + Trainer.

**Layout:**

Left panel: Athlete info card (name, current band assignment if any).

Right panel: Available bands list.

**Band Assignment Flow:**
1. Display list of all bands registered to this gym (`hr_bands` table, `gym_id` scope).
2. Each band shows: `sensor_id`, `band_label` (e.g., "Band #3"), current assignment status.
3. To assign: click "Assign" on an unassigned band, or "Reassign" on an assigned one (with confirmation if currently assigned to another athlete).
4. To unassign: click "Remove Band" on the currently assigned band.

**Database Operations:**
- Assign: Insert into `athlete_bands` (`athlete_id`, `gym_id`, `sensor_id`, `is_active = true`). If the `sensor_id` already has an active assignment in this gym, deactivate it first (`is_active = false`).
- Unassign: Set `is_active = false` on the `athlete_bands` record.

**Constraint:** `UNIQUE(gym_id, sensor_id)` where `is_active = true`. One sensor can only be actively assigned to one athlete per gym.

**API:** `POST /api/v1/gym/athletes/[id]/bands`, `DELETE /api/v1/gym/athletes/[id]/bands`

#### 3.2.7 `/gym/trainers` -- Trainer Management

**Access:** Owner only.

**Table Columns:**

| Column | Type | Sortable |
|--------|------|:--------:|
| Name | Text | Yes |
| Email | Text | No |
| Status | Badge: `active`, `invited`, `inactive` | Yes |
| Joined Date | Date | Yes |

**Status Definitions:**
- `invited`: Clerk invitation sent, user has not yet accepted.
- `active`: User accepted invitation and is an active Organization member.
- `inactive`: Removed from Organization or deactivated.

**Actions:**
- "Invite Trainer" button: opens modal with email input.
- Per-row: Resend Invitation (if `invited`), Remove Trainer (confirmation modal).

**Invite Flow:**
1. Owner enters trainer's email.
2. System calls Clerk `createOrganizationInvitation` with role `org:trainer`.
3. Record created in `gym_memberships` with `role = 'trainer'`, `is_active = true`.
4. Clerk sends invitation email.
5. Trainer list shows status as `invited` until accepted.

**Remove Flow:**
1. Owner clicks "Remove Trainer" with confirmation.
2. System calls Clerk `removeOrganizationMember`.
3. `gym_memberships.is_active` set to `false`.
4. Trainer loses access immediately.

**API:** `GET /api/v1/gym/trainers`, `POST /api/v1/gym/trainers`

#### 3.2.8 `/gym/sessions` -- Session History

**Access:** Owner + Trainer.

**Table Columns:**

| Column | Type | Sortable |
|--------|------|:--------:|
| Date | DateTime (formatted to gym timezone) | Yes (default: DESC) |
| Class Type | Badge (spinning, pilates, cycling, etc.) | No |
| Duration | Formatted (HH:MM:SS) | Yes |
| Athletes | Count | Yes |
| Avg HR | Number (BPM) | Yes |
| Max HR | Number (BPM) | No |
| Status | Badge: `active`, `completed`, `cancelled` | No |

**Filters:**
- Date range picker (default: last 30 days)
- Class type dropdown
- Status dropdown

**Per-row action:** Click to navigate to `/gym/sessions/[id]`

**Pagination:** 20 per page, server-side.

#### 3.2.9 `/gym/sessions/active` -- Live Session View

**Access:** Owner + Trainer.

**Purpose:** Web-based mirror of the TV dashboard. Allows trainers/owners to monitor the active session from any device.

**Layout:** Responsive grid of athlete cards, same data as TV but optimized for desktop/tablet.

**Athlete Card Content:**
| Element | Description |
|---------|-------------|
| Athlete Name | Resolved from `athlete_bands` mapping |
| Current BPM | Large font, real-time update |
| HR Zone | Zone name (1-5) with color coding |
| % Max HR | Percentage of athlete's configured `max_hr` |
| Sparkline | Last 60 seconds of HR data |
| AI Coaching | Overlay message when AI coaching triggers (8s display) |

**Real-time Data Source:** WebSocket connection to `ws/tv/{gymId}?token={token}` (same feed as TV). The page retrieves the TV token from the gym profile on the server side; the user does not need to know the token.

**Session Controls (top bar):**
- Session timer (elapsed time since `started_at`)
- Class type badge
- Athlete count
- "End Session" button (confirmation modal)
- Manual "Start Session" button (if no active session): opens modal to select class type

**No Active Session State:** Message: "No active session. Sessions start automatically when sensors are detected, or you can start one manually." with "Start Session" CTA.

**Grid Behavior:**
- 1 column on mobile (<640px)
- 2 columns on tablet (640-1024px)
- 3-4 columns on desktop (>1024px)
- Max 20 athlete cards

#### 3.2.10 `/gym/sessions/[id]` -- Session Detail

**Access:** Owner + Trainer.

**Header Section:**
- Class type, date, duration
- Trainer name (if assigned)
- Total athletes, average HR, total calories burned

**AI Summary Section:**
- Display `sessions.ai_summary` text block
- If not yet generated (session just ended): show loading indicator

**Per-Athlete Stats Table:**

| Column | Description |
|--------|-------------|
| Athlete Name | From `athletes` table |
| Avg HR | `session_athletes.avg_hr` |
| Max HR | `session_athletes.max_hr` |
| Min HR | `session_athletes.min_hr` |
| Calories | `session_athletes.calories` |
| Zone 1 Time | `time_zone_1_s` formatted as MM:SS |
| Zone 2 Time | `time_zone_2_s` formatted as MM:SS |
| Zone 3 Time | `time_zone_3_s` formatted as MM:SS |
| Zone 4 Time | `time_zone_4_s` formatted as MM:SS |
| Zone 5 Time | `time_zone_5_s` formatted as MM:SS |

**Per-Athlete Expandable Detail:**
- Clicking an athlete row expands to show:
  - HR over time chart (Recharts `LineChart`, x-axis: time, y-axis: BPM)
  - Zone distribution bar chart (Recharts `BarChart`, stacked horizontal)
  - AI coaching messages received during the session
- "Send Report via WhatsApp" button (per athlete, visible only if athlete has WhatsApp opt-in)
- "View Full Report" link to `/api/v1/reports/session/[id]?athlete_id=[athleteId]`

#### 3.2.11 `/gym/reports` -- Reports Overview

**Access:** Owner + Trainer.

**Sections:**

**Recent Session Reports:**
- List of last 10 completed sessions with quick stats
- Each links to `/gym/sessions/[id]`

**Athlete Progress (expandable):**
- Dropdown to select an athlete
- Weekly trend chart: average HR, calories, total training time (last 8 weeks)
- Monthly summary cards: sessions attended, total calories, avg HR

**Bulk Actions:**
- "Send All Reports" button: sends WhatsApp reports to all opted-in athletes from the most recent session
- Status indicator showing delivery status (sent, failed, pending)

---

## 4. Settings Features (Owner)

### 4.1 Gym Profile Editing

**Endpoint:** `PATCH /api/v1/gym/profile`

**Editable Fields:**
- `name` (string, 2-100 chars)
- `address` (string, max 500 chars)
- `phone` (string, E.164 format)
- `timezone` (string, IANA timezone identifier, e.g., `America/Sao_Paulo`)
- `language` (enum: `es`, `pt`)

**Validation:** Server-side validation with Zod schema. Returns 422 with field-level errors.

**Behavior:** Auto-save is NOT used. Explicit "Save Changes" button with success toast notification.

### 4.2 White-Label Configuration

**Endpoint:** `PATCH /api/v1/gym/profile` (same endpoint, fields: `logo_url`, `primary_color`, `secondary_color`)

**Logo Upload:**
- Accepted formats: PNG, SVG, WEBP
- Max file size: 2MB
- Minimum dimensions: 200x200px
- Storage: Upload to configured file storage (local `/public/uploads/` in development, cloud storage in production)
- The `logo_url` field stores the public URL

**Color Picker:**
- Interactive color picker component (hex input + visual picker)
- `primary_color`: used for headers, buttons, active states in TV and portal
- `secondary_color`: used for backgrounds, borders, secondary elements
- Default primary: `#FF6B35`
- Default secondary: `#1A1A2E`

### 4.3 TV Token Management

**Current Token Display:**
- Token is shown masked: `abc...xyz` with a "Show" toggle
- "Copy URL" button copies the full TV URL: `{BASE_URL}/tv/{gym.id}?token={tv_access_token}`

**Regenerate Token:**
- Button triggers confirmation dialog: "Are you sure? Any active TV displays will disconnect and need the new URL."
- On confirm: `PATCH /api/v1/gym/profile` with `regenerate_tv_token: true`
- Server generates new `crypto.randomUUID()`, updates `gyms.tv_access_token`
- Old token is immediately invalidated

---

## 5. Athlete Management (Owner + Trainer)

### 5.1 CRUD Operations

**Create Athlete:**

```typescript
// Request: POST /api/v1/gym/athletes
interface CreateAthleteRequest {
  name: string;           // required, 2-100 chars
  email?: string;         // valid email
  phone?: string;         // E.164 format (e.g., "+5511999999999")
  age?: number;           // 10-99
  weight_kg?: number;     // 20.0-300.0
  max_hr: number;         // 100-250, default 190
  whatsapp_opt_in: boolean; // default false
}

// Response: 201
interface AthleteResponse {
  id: string;             // UUID
  gym_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  age: number | null;
  weight_kg: number | null;
  max_hr: number;
  whatsapp_opt_in: boolean;
  is_active: boolean;
  assigned_band: {
    sensor_id: number;
    band_label: string;
  } | null;
  created_at: string;     // ISO 8601
  updated_at: string;
}
```

**Update Athlete:**

```typescript
// Request: PATCH /api/v1/gym/athletes/[id]
// Body: Partial<CreateAthleteRequest>
// Response: 200, AthleteResponse
```

**List Athletes:**

```typescript
// Request: GET /api/v1/gym/athletes?search=&status=active&band=assigned&offset=0&limit=25
// Response: 200
interface AthleteListResponse {
  data: AthleteResponse[];
  total: number;
  offset: number;
  limit: number;
}
```

**Deactivate Athlete:**

```typescript
// Request: PATCH /api/v1/gym/athletes/[id]
// Body: { is_active: false }
// Response: 200, AthleteResponse
```

### 5.2 Band Mapping

Band mapping creates a persistent association between an ANT+ sensor device ID and an athlete profile. This mapping is used by the real-time pipeline to resolve `sensor_id` from incoming HR data to athlete names and profiles.

**Assign Band:**

```typescript
// Request: POST /api/v1/gym/athletes/[id]/bands
interface AssignBandRequest {
  sensor_id: number;       // ANT+ device number (integer)
  band_label?: string;     // e.g., "Band #3", "Red Strap"
}

// Response: 201
interface BandAssignmentResponse {
  id: string;
  athlete_id: string;
  gym_id: string;
  sensor_id: number;
  band_label: string | null;
  is_active: boolean;
}
```

**Server Logic:**
1. Validate `sensor_id` is a positive integer.
2. Check if `sensor_id` already has an active assignment in this gym.
3. If yes: deactivate the existing assignment (`is_active = false` on old record).
4. Insert new `athlete_bands` record with `is_active = true`.
5. Return the new assignment.

**Unassign Band:**

```typescript
// Request: DELETE /api/v1/gym/athletes/[id]/bands
// Response: 204 No Content
```

**Server Logic:**
1. Find active `athlete_bands` record for this athlete and gym.
2. Set `is_active = false`.
3. Return 204. Return 404 if no active band assignment exists.

### 5.3 WhatsApp Opt-in

- Toggle is per-athlete, stored in `athletes.whatsapp_opt_in`.
- Cannot be enabled unless `athletes.phone` is set and is a valid E.164 number.
- When enabled, the athlete will receive automatic post-session reports via WhatsApp.
- UI displays a small info text: "Athlete will receive session reports via WhatsApp after each training."

### 5.4 CSV Import (P2)

**Deferred to Phase 2.** When implemented:
- Accept CSV file with columns: `name, email, phone, age, weight_kg, max_hr`
- Validate each row, report errors
- Skip duplicates (matched by email within gym)
- Return import summary: created, skipped, errors

---

## 6. Trainer Management (Owner Only)

### 6.1 CRUD Operations

**Invite Trainer:**

```typescript
// Request: POST /api/v1/gym/trainers
interface InviteTrainerRequest {
  email: string;           // required, valid email
}

// Response: 201
interface TrainerResponse {
  id: string;              // gym_memberships.id
  user_id: string | null;  // null until invitation accepted
  email: string;
  name: string | null;     // null until invitation accepted
  role: "trainer";
  status: "active" | "invited" | "inactive";
  is_active: boolean;
  joined_at: string | null; // null until invitation accepted
}
```

**Server Logic:**
1. Check if email is already a member of this Organization.
2. If yes: return 409 Conflict.
3. Call Clerk `organizations.createInvitation({ emailAddress, role: "org:trainer" })`.
4. Create `gym_memberships` record (or create upon Clerk webhook `organizationMembership.created`).
5. Return trainer response with status `invited`.

**List Trainers:**

```typescript
// Request: GET /api/v1/gym/trainers
// Response: 200
interface TrainerListResponse {
  data: TrainerResponse[];
  total: number;
}
```

**Remove Trainer:**
- Not a separate endpoint. Use Clerk Organization member removal.
- Webhook `organizationMembership.deleted` triggers `gym_memberships.is_active = false`.
- Alternatively, expose `DELETE /api/v1/gym/trainers/[id]` that calls Clerk API and updates local DB.

---

## 7. Session Management (Owner + Trainer)

### 7.1 Active Session View

The active session web view (`/gym/sessions/active`) connects to the same WebSocket feed as the TV dashboard.

**WebSocket Connection:**
- URL: `ws(s)://{WS_SERVER}/ws/tv/{gymId}?token={tv_access_token}`
- The TV token is fetched server-side from the `gyms` table and passed to the client component. The user never sees or enters the token.

**Message Types Received:**

```typescript
// HR update (every 1s)
interface HRUpdateMessage {
  type: "hr-update";
  devices: Record<string, {
    sensor_id: number;
    heart_rate_bpm: number;
    hr_zone: number;          // 1-5
    hr_zone_name: string;     // "Warmup" | "Fat Burn" | "Cardio" | "Peak" | "Max"
    hr_zone_color: string;    // hex color
    hr_max_percent: number;   // 0-100+
    athlete_name: string | null;
    beat_time: number;
    device_active: boolean;
  }>;
}

// AI coaching (periodic, every 15-60s)
interface AICoachingMessage {
  type: "ai-coaching";
  analysis: string;           // Coach Pulse message
  athlete_summaries: Record<string, string>; // per-athlete messages
}

// Session events
interface SessionEventMessage {
  type: "session-event";
  event: "started" | "ended" | "athlete_joined" | "athlete_left";
  data?: Record<string, unknown>;
}
```

### 7.2 Manual Session Control

**Start Session:**

```typescript
// Request: POST /api/v1/gym/sessions
interface StartSessionRequest {
  class_type: "spinning" | "pilates" | "cycling" | "hiit" | "crossfit" | "functional" | "other";
}

// Response: 201
interface SessionResponse {
  id: string;
  gym_id: string;
  trainer_id: string | null;
  class_type: string;
  status: "active" | "completed" | "cancelled";
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  athlete_count: number;
  ai_summary: string | null;
  created_at: string;
}
```

**Server Logic:**
1. Check no other active session exists for this gym.
2. If active session exists: return 409 Conflict with message "A session is already active."
3. Insert into `sessions` with `status = 'active'`, `started_at = NOW()`, `trainer_id` = current user if trainer role.
4. Broadcast `session-event: started` to TV WebSocket.

**End Session:**

```typescript
// Request: POST /api/v1/gym/sessions/[id]/end
// Body: {} (empty)
// Response: 200, SessionResponse (with ended_at, duration_seconds populated)
```

**Server Logic:**
1. Validate session belongs to this gym and `status = 'active'`.
2. Set `status = 'completed'`, `ended_at = NOW()`, calculate `duration_seconds`.
3. Trigger async post-session processing:
   a. Calculate per-athlete stats (avg/max/min HR, calories, zone times) into `session_athletes`.
   b. Generate AI summary via OpenAI and store in `sessions.ai_summary`.
   c. Send WhatsApp reports to opted-in athletes (after 2 minute delay).
4. Broadcast `session-event: ended` to TV WebSocket.

### 7.3 Auto-Sessions

Auto-sessions are triggered by the local agent and processed by the VPS.

**Auto-Start:**
- When the first ANT+ sensor sends data and no active session exists for this gym, the server automatically creates a session with `class_type = 'auto'`.
- A 60-second warmup period begins before AI coaching activates.

**Auto-End:**
- When all sensors report `device_active = false` (no HR readings) for 2 consecutive minutes, the server automatically ends the session.
- The 2-minute inactivity timer resets if any sensor becomes active again.

**Implementation:** Server-side timer managed by the WebSocket server process (`ws-server.ts`), with gym state tracked in `lib/ws/gym-state.ts`.

### 7.4 Session History

**Endpoint:** `GET /api/v1/gym/sessions`

```typescript
// Query params
interface SessionListParams {
  offset?: number;        // default 0
  limit?: number;         // default 20, max 100
  status?: "active" | "completed" | "cancelled";
  class_type?: string;
  from?: string;          // ISO 8601 date
  to?: string;            // ISO 8601 date
  sort?: "started_at" | "duration_seconds" | "athlete_count";
  order?: "asc" | "desc"; // default "desc"
}

// Response: 200
interface SessionListResponse {
  data: SessionResponse[];
  total: number;
  offset: number;
  limit: number;
}
```

### 7.5 Session Detail

**Endpoint:** `GET /api/v1/gym/sessions/[id]`

Returns the `SessionResponse` object extended with:

```typescript
interface SessionDetailResponse extends SessionResponse {
  athletes: SessionAthleteStats[];
  coaching_messages: AICoachingMessage[];
}

interface SessionAthleteStats {
  athlete_id: string;
  athlete_name: string;
  sensor_id: number;
  avg_hr: number;
  max_hr: number;
  min_hr: number;
  calories: number;
  time_zone_1_s: number;
  time_zone_2_s: number;
  time_zone_3_s: number;
  time_zone_4_s: number;
  time_zone_5_s: number;
  joined_at: string;
  left_at: string | null;
}

interface AICoachingMessage {
  id: string;
  message: string;
  model: string;
  athlete_summaries: Record<string, string>;
  created_at: string;
}
```

---

## 8. Reports (Owner + Trainer)

### 8.1 Post-Session Report (Auto-Generated)

After a session ends, the system automatically generates a per-athlete report.

**Report Data:**

| Field | Source |
|-------|--------|
| Session date | `sessions.started_at` formatted to gym timezone |
| Duration | `sessions.duration_seconds` formatted HH:MM:SS |
| Class type | `sessions.class_type` |
| Gym name | `gyms.name` |
| Athlete name | `athletes.name` |
| Avg HR | `session_athletes.avg_hr` |
| Max HR | `session_athletes.max_hr` |
| Min HR | `session_athletes.min_hr` |
| Calories | `session_athletes.calories` |
| Zone distribution | `time_zone_1_s` through `time_zone_5_s` as bar chart |
| HR over time | `hr_readings` for this session+athlete as line chart |
| AI Summary | `sessions.ai_summary` |

**Report Endpoint:** `GET /api/v1/reports/session/[id]?athlete_id=[athleteId]`

Returns rendered HTML or JSON depending on `Accept` header.

### 8.2 Athlete Progress

**Weekly Trends (last 8 weeks):**
- Average HR per session
- Total calories per week
- Total training time per week
- Number of sessions per week

**Monthly Summary:**
- Sessions attended
- Total calories burned
- Average HR across all sessions
- Most frequent zone

**Data Source:** Aggregated from `session_athletes` + `sessions` tables, filtered by athlete and date range.

### 8.3 WhatsApp Delivery

**Send Report Button:**

```typescript
// Request: POST /api/v1/reports/session/[id]/send-whatsapp
interface SendWhatsAppRequest {
  athlete_id?: string;    // specific athlete, or omit for all opted-in
}

// Response: 200
interface SendWhatsAppResponse {
  sent: number;
  failed: number;
  skipped: number;        // athletes without opt-in or phone
  details: Array<{
    athlete_id: string;
    athlete_name: string;
    status: "sent" | "failed" | "skipped";
    reason?: string;
  }>;
}
```

**WhatsApp Template Message:**

```
Hola {name}, tu sesion de {class_type} en {gym_name} termino!
Duracion: {duration}, HR Promedio: {avg_hr} BPM, Calorias: {calories}.
Ver reporte: {report_url}
```

**Delivery Rules:**
- Only sent to athletes with `whatsapp_opt_in = true` and valid `phone`.
- Auto-sent 2 minutes after session ends.
- Retry once on failure (Twilio API error). No further retries.
- Delivery status logged for display in the UI.

---

## 9. API Endpoints

### 9.1 Endpoint Summary

All endpoints require Clerk authentication (except where noted). The `gym_id` is derived from the authenticated user's active Organization.

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| `GET` | `/api/v1/gym/profile` | Owner, Trainer | Get gym profile |
| `PATCH` | `/api/v1/gym/profile` | Owner | Update gym profile, branding, or regenerate TV token |
| `GET` | `/api/v1/gym/athletes` | Owner, Trainer | List athletes (paginated, filterable) |
| `POST` | `/api/v1/gym/athletes` | Owner, Trainer | Create athlete |
| `GET` | `/api/v1/gym/athletes/[id]` | Owner, Trainer | Get single athlete |
| `PATCH` | `/api/v1/gym/athletes/[id]` | Owner, Trainer | Update athlete |
| `POST` | `/api/v1/gym/athletes/[id]/bands` | Owner, Trainer | Assign band to athlete |
| `DELETE` | `/api/v1/gym/athletes/[id]/bands` | Owner, Trainer | Unassign band from athlete |
| `GET` | `/api/v1/gym/trainers` | Owner | List trainers |
| `POST` | `/api/v1/gym/trainers` | Owner | Invite trainer |
| `DELETE` | `/api/v1/gym/trainers/[id]` | Owner | Remove trainer |
| `GET` | `/api/v1/gym/sessions` | Owner, Trainer | List sessions (paginated, filterable) |
| `POST` | `/api/v1/gym/sessions` | Owner, Trainer | Start manual session |
| `GET` | `/api/v1/gym/sessions/active` | Owner, Trainer | Get active session |
| `GET` | `/api/v1/gym/sessions/[id]` | Owner, Trainer | Get session detail |
| `POST` | `/api/v1/gym/sessions/[id]/end` | Owner, Trainer | End active session |
| `GET` | `/api/v1/reports/session/[id]` | Owner, Trainer | Get session report |
| `POST` | `/api/v1/reports/session/[id]/send-whatsapp` | Owner, Trainer | Send WhatsApp reports |

### 9.2 Common Response Patterns

**Success:**
```json
{
  "data": { ... },
  "meta": { "total": 100, "offset": 0, "limit": 25 }
}
```

**Validation Error (422):**
```json
{
  "error": "Validation failed",
  "details": [
    { "field": "name", "message": "Name must be at least 2 characters" },
    { "field": "max_hr", "message": "Max HR must be between 100 and 250" }
  ]
}
```

**Not Found (404):**
```json
{
  "error": "Athlete not found"
}
```

**Forbidden (403):**
```json
{
  "error": "Insufficient permissions. Owner access required."
}
```

**Conflict (409):**
```json
{
  "error": "A session is already active for this gym"
}
```

### 9.3 Request Validation

All endpoints use Zod schemas for request validation.

```typescript
// Example: lib/validations/athlete.ts
import { z } from "zod";

export const createAthleteSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().optional(),
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/).optional(),
  age: z.number().int().min(10).max(99).optional(),
  weight_kg: z.number().min(20).max(300).optional(),
  max_hr: z.number().int().min(100).max(250).default(190),
  whatsapp_opt_in: z.boolean().default(false),
});

export const updateAthleteSchema = createAthleteSchema.partial();

export const assignBandSchema = z.object({
  sensor_id: z.number().int().positive(),
  band_label: z.string().max(50).optional(),
});
```

### 9.4 Gym Scoping

Every database query in the gym module MUST include a `gym_id` filter.

```typescript
// lib/utils/gym-scope.ts
export function withGymScope(gymId: string) {
  return { gym_id: gymId };
}

// Usage in Drizzle queries
const athletes = await db
  .select()
  .from(athletesTable)
  .where(
    and(
      eq(athletesTable.gym_id, gymId),
      eq(athletesTable.is_active, true)
    )
  )
  .orderBy(desc(athletesTable.created_at))
  .limit(limit)
  .offset(offset);
```

---

## 10. UI Components

### 10.1 Layout Components

#### GymDashboardLayout (`components/dashboard/gym-layout.tsx`)

Shell component wrapping all `/gym/*` pages.

**Structure:**
- **Sidebar** (collapsible on mobile):
  - Gym logo + name (from branding)
  - Navigation links:
    - Dashboard (`/gym`)
    - Athletes (`/gym/athletes`)
    - Sessions (`/gym/sessions`)
    - Reports (`/gym/reports`)
    - Trainers (`/gym/trainers`) -- Owner only
    - Settings (`/gym/settings`) -- Owner only
    - Branding (`/gym/branding`) -- Owner only
  - Active session indicator (pulsing dot if session active)
  - User menu (Clerk UserButton)
- **Header:**
  - Page title (dynamic based on route)
  - Breadcrumbs
- **Main content area:** Renders page content

#### GymSidebar (`components/dashboard/gym-sidebar.tsx`)

Props:
```typescript
interface GymSidebarProps {
  gymName: string;
  logoUrl: string | null;
  primaryColor: string;
  role: "org:admin" | "org:trainer";
  hasActiveSession: boolean;
}
```

### 10.2 Data Display Components

#### DataTable (`components/dashboard/data-table.tsx`)

Generic sortable, filterable table with pagination.

Props:
```typescript
interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onSort: (column: string, direction: "asc" | "desc") => void;
  searchPlaceholder?: string;
  onSearch?: (query: string) => void;
  filters?: FilterConfig[];
  emptyState?: React.ReactNode;
  loading?: boolean;
}
```

Features:
- Column header click to sort (asc/desc toggle)
- Search input with debounce (300ms)
- Filter dropdowns
- Pagination controls (previous, next, page numbers)
- Loading skeleton state
- Empty state with custom illustration and message

#### StatCard (`components/dashboard/stat-card.tsx`)

Displays a single metric.

Props:
```typescript
interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: {
    value: number;    // percentage change
    direction: "up" | "down" | "neutral";
  };
}
```

#### AthleteCard (`components/dashboard/athlete-card.tsx`)

Real-time athlete card for live session view.

Props:
```typescript
interface AthleteCardProps {
  name: string;
  bpm: number;
  zone: number;           // 1-5
  zoneName: string;
  zoneColor: string;      // hex
  maxHrPercent: number;
  sparklineData: number[]; // last 60 BPM readings
  coachingMessage?: string;
  isActive: boolean;
}
```

Renders:
- Name at top
- Large BPM number (center)
- Zone badge with color background
- % Max HR indicator
- Sparkline chart (Recharts `AreaChart`, 60 data points)
- Coaching message overlay (fades in/out over 8s)
- Grayed out state when `isActive = false`

#### SessionTimer (`components/dashboard/session-timer.tsx`)

Live elapsed time counter.

Props:
```typescript
interface SessionTimerProps {
  startedAt: Date;
  isActive: boolean;
}
```

Behavior: Client-side `setInterval` (1s) computing elapsed time from `startedAt`. Displays as `HH:MM:SS`. Stops updating when `isActive = false`.

### 10.3 Form Components

#### AthleteForm (`components/dashboard/athlete-form.tsx`)

Reusable form for create and edit athlete flows.

Props:
```typescript
interface AthleteFormProps {
  athlete?: AthleteResponse;  // undefined for create, populated for edit
  onSubmit: (data: CreateAthleteRequest) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}
```

#### ColorPicker (`components/dashboard/color-picker.tsx`)

Combined visual color picker + hex input.

Props:
```typescript
interface ColorPickerProps {
  label: string;
  value: string;          // hex color
  onChange: (color: string) => void;
  presets?: string[];     // quick-select preset colors
}
```

Features:
- Hue/saturation picker (visual area)
- Hex input field with `#` prefix
- Preset color swatches (optional)
- Live preview swatch showing current selection

#### FileUpload (`components/dashboard/file-upload.tsx`)

Drag-and-drop file upload with preview.

Props:
```typescript
interface FileUploadProps {
  label: string;
  accept: string;         // e.g., "image/png,image/svg+xml,image/webp"
  maxSizeMB: number;
  currentFileUrl?: string;
  onUpload: (file: File) => Promise<string>; // returns URL
  onRemove: () => void;
}
```

Features:
- Drag-and-drop zone with dashed border
- Click to open file picker
- Client-side validation (type, size)
- Upload progress indicator
- Preview of uploaded image
- "Remove" button when file exists

### 10.4 Modal Components

#### ConfirmModal (`components/dashboard/confirm-modal.tsx`)

Generic confirmation dialog.

Props:
```typescript
interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;   // default: "Confirm"
  cancelLabel?: string;    // default: "Cancel"
  variant?: "default" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}
```

Used for: session end, trainer removal, athlete deactivation, token regeneration.

#### StartSessionModal (`components/dashboard/start-session-modal.tsx`)

Modal for manually starting a session.

Props:
```typescript
interface StartSessionModalProps {
  open: boolean;
  onStart: (classType: string) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}
```

Content:
- Class type selector (radio group or select dropdown)
- Options: Spinning, Pilates, Cycling, HIIT, CrossFit, Functional, Other
- "Start Session" button
- "Cancel" button

#### InviteTrainerModal (`components/dashboard/invite-trainer-modal.tsx`)

Modal for inviting a trainer.

Props:
```typescript
interface InviteTrainerModalProps {
  open: boolean;
  onInvite: (email: string) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}
```

Content:
- Email input field
- Validation: valid email format
- "Send Invitation" button
- "Cancel" button
- Success state: "Invitation sent to {email}"

### 10.5 Chart Components

All charts use Recharts.

#### HRTimeChart (`components/dashboard/hr-time-chart.tsx`)

Line chart showing heart rate over time for a single athlete in a session.

Props:
```typescript
interface HRTimeChartProps {
  data: Array<{ time: string; bpm: number; zone: number }>;
  maxHr: number;
  height?: number;
}
```

Features:
- X-axis: time (formatted HH:MM)
- Y-axis: BPM (0 to maxHr + 10)
- Zone color bands as reference areas (horizontal bands behind the line)
- Tooltip showing BPM, zone name, time

#### ZoneDistributionChart (`components/dashboard/zone-distribution-chart.tsx`)

Horizontal stacked bar chart showing time in each HR zone.

Props:
```typescript
interface ZoneDistributionChartProps {
  zones: {
    zone1: number;  // seconds
    zone2: number;
    zone3: number;
    zone4: number;
    zone5: number;
  };
  height?: number;
}
```

Features:
- Single horizontal stacked bar
- Zone colors: Blue (Z1), Green (Z2), Yellow (Z3), Orange (Z4), Red (Z5)
- Labels showing MM:SS per zone
- Legend with zone names

#### SparklineChart (`components/dashboard/sparkline-chart.tsx`)

Minimal line chart for athlete cards (no axes, no labels).

Props:
```typescript
interface SparklineChartProps {
  data: number[];        // BPM values, last 60 readings
  color: string;         // zone color
  width?: number;
  height?: number;
}
```

---

## 11. Database Queries Reference

Key Drizzle ORM queries used across the module. All queries include `gym_id` scoping.

### Dashboard Stats (Today)

```typescript
// Sessions today
const todaySessions = await db
  .select({ count: count() })
  .from(sessions)
  .where(
    and(
      eq(sessions.gym_id, gymId),
      gte(sessions.started_at, startOfDay),
      eq(sessions.status, "completed")
    )
  );

// Athletes trained today
const todayAthletes = await db
  .selectDistinct({ athlete_id: sessionAthletes.athlete_id })
  .from(sessionAthletes)
  .innerJoin(sessions, eq(sessions.id, sessionAthletes.session_id))
  .where(
    and(
      eq(sessions.gym_id, gymId),
      gte(sessions.started_at, startOfDay)
    )
  );
```

### Active Session Check

```typescript
const activeSession = await db
  .select()
  .from(sessions)
  .where(
    and(
      eq(sessions.gym_id, gymId),
      eq(sessions.status, "active")
    )
  )
  .limit(1);
```

### Band Resolution (Sensor to Athlete)

```typescript
const bandMappings = await db
  .select({
    sensor_id: athleteBands.sensor_id,
    athlete_id: athleteBands.athlete_id,
    athlete_name: athletes.name,
    max_hr: athletes.max_hr,
  })
  .from(athleteBands)
  .innerJoin(athletes, eq(athletes.id, athleteBands.athlete_id))
  .where(
    and(
      eq(athleteBands.gym_id, gymId),
      eq(athleteBands.is_active, true)
    )
  );
```

---

## 12. Error Handling

### Client-Side

- Form validation errors displayed inline below fields (red text, red border).
- API errors displayed as toast notifications (top-right, auto-dismiss after 5s).
- Network errors trigger a retry prompt.
- WebSocket disconnection shows a banner at the top: "Connection lost. Reconnecting..." with auto-reconnect (exponential backoff: 1s, 2s, 4s, 8s, max 30s).

### Server-Side

- All API route handlers wrapped in a `withErrorHandler` utility that catches exceptions and returns structured error responses.
- Zod validation errors return 422 with field-level details.
- Clerk auth failures return 401.
- Organization role mismatches return 403.
- Resource not found returns 404.
- Gym scope violations (accessing another gym's data) return 403.

```typescript
// lib/api/error-handler.ts
export function withErrorHandler(
  handler: (req: NextRequest, context: RouteContext) => Promise<NextResponse>
) {
  return async (req: NextRequest, context: RouteContext) => {
    try {
      return await handler(req, context);
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json(
          { error: "Validation failed", details: formatZodErrors(error) },
          { status: 422 }
        );
      }
      if (error instanceof AuthError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }
      console.error("Unhandled API error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}
```

---

## 13. Implementation Notes

### File Structure

```
app/(platform)/gym/
  layout.tsx
  page.tsx
  settings/page.tsx
  branding/page.tsx
  athletes/
    page.tsx
    new/page.tsx
    [id]/
      page.tsx
      bands/page.tsx
  trainers/page.tsx
  sessions/
    page.tsx
    active/page.tsx
    [id]/page.tsx
  reports/page.tsx

app/api/v1/gym/
  profile/route.ts
  athletes/
    route.ts
    [id]/
      route.ts
      bands/route.ts
  trainers/
    route.ts
    [id]/route.ts
  sessions/
    route.ts
    active/route.ts
    [id]/
      route.ts
      end/route.ts

lib/
  validations/
    athlete.ts
    trainer.ts
    session.ts
    gym-profile.ts
  api/
    error-handler.ts

components/dashboard/
  gym-layout.tsx
  gym-sidebar.tsx
  data-table.tsx
  stat-card.tsx
  athlete-card.tsx
  athlete-form.tsx
  session-timer.tsx
  color-picker.tsx
  file-upload.tsx
  confirm-modal.tsx
  start-session-modal.tsx
  invite-trainer-modal.tsx
  hr-time-chart.tsx
  zone-distribution-chart.tsx
  sparkline-chart.tsx
```

### Key Dependencies

- `@clerk/nextjs` -- Authentication, Organization management, role checks
- `drizzle-orm` + `drizzle-kit` -- Database ORM and migrations
- `zod` -- Request validation schemas
- `recharts` -- Chart rendering
- `react-colorful` -- Color picker component (or equivalent)
- `react-dropzone` -- File upload drag-and-drop
- `date-fns` -- Date formatting and timezone handling
- `date-fns-tz` -- Timezone-aware date operations

### Performance Considerations

- Session list and athlete list use server-side pagination (never load full table).
- Active session page uses WebSocket for real-time data (no polling).
- Sparkline data is kept client-side in a rolling 60-element array (no API call per update).
- Dashboard stats query uses database aggregation (COUNT, AVG), not client-side computation.
- Band resolution query result is cached in the WebSocket server's gym state and refreshed on band assignment changes.
