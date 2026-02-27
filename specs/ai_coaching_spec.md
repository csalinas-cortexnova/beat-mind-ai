# AI Coaching System (Coach Pulse) - Technical Specification

**Module:** AI Coaching System
**Version:** 1.0
**Status:** Draft
**Date:** 2026-02-26
**Depends on:** Database schema (gyms, sessions, athletes, athlete_bands, hr_readings, ai_coaching_messages, session_athletes), WebSocket server, OpenAI API
**Port of:** `burnapp/src/ai-analyzer.js`

---

## 1. Overview

The AI Coaching System is a server-side service that analyzes real-time heart rate data during active gym sessions and produces motivational coaching messages through OpenAI. The service runs on the central VPS platform as part of the Next.js backend (invoked via server-side timers or cron-like triggers during active sessions).

This is a direct port of `burnapp/src/ai-analyzer.js` from vanilla Node.js/JavaScript to TypeScript, adapted for the multi-tenant architecture. Key differences from the original:

- **Multi-tenant:** Scoped by `gym_id` and `session_id` (the original was single-gym).
- **Database:** Uses Drizzle ORM instead of raw `pg` pool queries.
- **HTTP client:** Uses the OpenAI Node SDK (`openai` package) instead of raw `axios` calls.
- **Language:** Configurable per gym (`gym.language`: `es` or `pt`) instead of hardcoded Spanish.
- **Athlete resolution:** Joins `athlete_bands` and `athletes` tables to resolve real names from `sensor_id`, instead of relying on a `athlete_name` column in HR data.
- **Storage:** Persists every coaching message to `ai_coaching_messages` with full athlete summaries as JSONB.
- **Distribution:** Broadcasts messages over WebSocket to TV dashboards in real time.
- **Post-session:** Generates an AI summary when a session ends, stored in `sessions.ai_summary`.

The system operates entirely server-side. No AI calls are made from the client. Sessions function normally if the AI system is unavailable (graceful degradation).

---

## 2. Coach Persona

### 2.1 Identity

| Attribute     | Value |
|---------------|-------|
| Name          | Coach Pulse |
| Role          | Virtual fitness coach displayed on gym TV screens |
| Tone          | Energetic, motivational, brief |
| Message length | 2-3 sentences per athlete (single message covers all active athletes) |
| Emoji usage   | 1-2 max per message, no hashtags |

### 2.2 Behavior Rules

1. **Always address athletes by first name.** Derived from `athletes.name` via `athlete_bands.sensor_id` mapping.
2. **Always reference average BPM** (`avg_bpm` computed over last 60 seconds), never a single-point BPM reading. Example: "you're averaging 142 BPM" rather than "you're at 145 BPM".
3. **Always reference the current HR zone** by name (e.g., "Fat Burn", "Anaerobic Threshold") and the trend (rising/falling/stable).
4. **Zone-specific guidance:**
   - Zones 4-5: Encourage but remind to rest if sustained too long.
   - Zones 0-1: Motivate to increase intensity.
   - Zones 2-3: Positive reinforcement, maintain pace.
5. **Output a single message covering all active athletes** in the session.

### 2.3 Language Support

The coaching language is determined by `gyms.language`:

| Code | Language   | Zone names                                                                    |
|------|------------|-------------------------------------------------------------------------------|
| `es` | Spanish    | Reposo, Calentamiento, Quema de grasa, Aerobico, Umbral anaerobico, Maximo esfuerzo |
| `pt` | Portuguese | Repouso, Aquecimento, Queima de gordura, Aerobico, Limiar anaerobico, Esforco maximo |

Zone names are defined in `lib/hr/zones.ts` and passed to the AI prompt so the model uses consistent terminology. The system prompt and user prompt templates include the language directive. The model is instructed to respond exclusively in the configured language.

---

## 3. Analysis Loop

### 3.1 Lifecycle

```
Session starts (first sensor data arrives)
    |
    v
[Warmup period: 60s - no analysis]
    |
    v
[Analysis loop: every INTERVAL seconds]
    |-- Query hr_readings for active session
    |-- Group by athlete, compute summaries
    |-- Build prompt, call OpenAI
    |-- Store message in ai_coaching_messages
    |-- Broadcast via WebSocket to TV
    |
    v
Session ends
    |
    v
[Post-session: generate AI summary]
```

### 3.2 Trigger Mechanism

The analysis loop is triggered by a server-side `setInterval` timer that starts when a session becomes active (first HR data received from any sensor in the session). The timer runs every `ANALYSIS_INTERVAL` seconds (configurable, default 30s).

Implementation approach: The WebSocket server process (`ws-server.ts`) manages active session state. When the first HR reading arrives for a gym with no active session, it either creates an auto-session or attaches to an existing manual session. At that point, it starts the coaching timer for that session.

```typescript
// Pseudocode for the analysis loop trigger
function onFirstHrDataForSession(sessionId: string, gymId: string): void {
  const config = await getGymCoachingConfig(gymId);
  const timer = setInterval(
    () => runAnalysisCycle(sessionId, gymId),
    config.analysisIntervalMs
  );
  activeTimers.set(sessionId, { timer, startedAt: Date.now() });
}
```

### 3.3 Warmup Period

After the analysis timer starts, the first `WARMUP_PERIOD` seconds (default 60s) are skipped. This allows heart rate readings to stabilize before generating the first coaching message.

```typescript
async function runAnalysisCycle(sessionId: string, gymId: string): void {
  const timerState = activeTimers.get(sessionId);
  const elapsed = Date.now() - timerState.startedAt;

  if (elapsed < config.warmupPeriodMs) {
    return; // Still in warmup, skip this cycle
  }

  // Proceed with analysis...
}
```

### 3.4 Data Input

Query `hr_readings` for the active session, filtered to:
- `session_id` = current session
- `recorded_at` >= max(session_start, now - ANALYSIS_MINUTES)
- `device_active` = true
- `heart_rate_bpm` > 0

Order by `recorded_at DESC`.

```sql
SELECT
  hr.sensor_id,
  hr.athlete_id,
  hr.heart_rate_bpm,
  hr.hr_zone,
  hr.hr_zone_name,
  hr.hr_zone_color,
  hr.hr_max_percent,
  hr.recorded_at,
  a.name AS athlete_name
FROM hr_readings hr
JOIN athletes a ON a.id = hr.athlete_id
WHERE hr.session_id = $1
  AND hr.recorded_at >= $2
  AND hr.device_active = true
  AND hr.heart_rate_bpm > 0
ORDER BY hr.recorded_at DESC
```

If athlete_id is not yet resolved in hr_readings at query time, fall back to joining via `athlete_bands`:

```sql
JOIN athlete_bands ab ON ab.gym_id = hr.gym_id AND ab.sensor_id = hr.sensor_id AND ab.is_active = true
JOIN athletes a ON a.id = ab.athlete_id
```

### 3.5 Per-Athlete Summary

Group readings by athlete and compute:

| Field              | Computation |
|--------------------|-------------|
| `athleteName`      | From `athletes.name` |
| `athleteId`        | From `athletes.id` |
| `sensorId`         | From `hr_readings.sensor_id` |
| `currentZone`      | Zone number from most recent reading |
| `currentZoneName`  | Zone name from most recent reading |
| `avgBpm`           | Mean of all BPM readings in window (rounded to integer) |
| `maxBpm`           | Max BPM in window |
| `minBpm`           | Min BPM in window |
| `hrMaxPercent`     | From most recent reading |
| `trend`            | Compare avg of first half (recent) vs second half (older) of readings: diff > 5 = "rising", diff < -5 = "falling", else "stable" |
| `readingsCount`    | Total readings in window |
| `timeByZone`       | Map of zone label to approximate minutes (count * reading_interval / 60) |

### 3.6 Output

A single string message from Coach Pulse covering all active athletes in the session.

---

## 4. OpenAI Integration

### 4.1 Client Setup

Use the official OpenAI Node SDK:

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 10_000, // 10s timeout
  maxRetries: 0,   // We handle retries at the application level
});
```

### 4.2 Chat Completion Call

```typescript
const completion = await openai.chat.completions.create({
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ],
  temperature: 0.75,
  max_tokens: 300,
});

const message = completion.choices[0]?.message?.content?.trim() ?? null;
```

### 4.3 Parameters

| Parameter     | Value          | Rationale |
|---------------|----------------|-----------|
| `model`       | `gpt-4o-mini`  | Fast, cheap, sufficient quality for short motivational messages |
| `temperature` | 0.7 - 0.8      | Enough variety to avoid repetitive messages across cycles |
| `max_tokens`  | 300            | Keep messages brief; 2-3 sentences per athlete, up to 20 athletes |
| `timeout`     | 10,000ms       | Prevent blocking the analysis loop on slow API responses |
| `maxRetries`  | 0              | Skip cycle on failure rather than retrying within the same cycle |

### 4.4 Error Handling

| Error Type         | Response |
|--------------------|----------|
| API key missing    | Disable coaching entirely, log warning at startup |
| API key invalid (401) | Log error, skip cycle, mark coaching as degraded |
| Rate limit (429)   | Log warning, skip cycle, continue on next interval |
| Timeout            | Log warning, skip cycle, continue on next interval |
| Network error      | Log error, skip cycle, continue on next interval |
| Empty response     | Log warning, skip cycle |
| Malformed response | Log error, skip cycle |

On any failure, the analysis loop continues. The next interval will attempt a fresh call. No exponential backoff is applied within the coaching loop since the interval itself provides natural spacing.

---

## 5. Prompt Engineering

### 5.1 System Prompt Template

```typescript
function buildSystemPrompt(language: "es" | "pt"): string {
  const languageDirectives: Record<string, string> = {
    es: "Responde EXCLUSIVAMENTE en espanol.",
    pt: "Responda EXCLUSIVAMENTE em portugues.",
  };

  return [
    'You are "Coach Pulse", a virtual fitness coach in a gym with spinning, cycling, pilates, and general fitness classes.',
    languageDirectives[language],
    "Your tone is energetic, motivational, and brief (2-3 sentences per athlete maximum).",
    "CRITICAL: Always reference the AVERAGE BPM (avg_bpm), NEVER a specific point-in-time BPM. Example: 'you are averaging 140 BPM'.",
    "For each athlete, mention: their first name, current HR zone name, trend (rising/falling/stable), and average BPM.",
    "If an athlete is in zone 4-5, encourage them but remind them to rest if they have been there too long.",
    "If an athlete is in zone 0-1, motivate them to increase intensity.",
    "Use a maximum of 1-2 emojis total. Do not use hashtags.",
    "Produce a single cohesive message addressing all athletes.",
  ].join(" ");
}
```

### 5.2 User Prompt Template

```typescript
function buildUserPrompt(
  summaries: AthleteSummary[],
  classType: string | null
): string {
  const classLabel = classType ? ` (${classType})` : "";
  const data = summaries.map((s) => ({
    name: s.athleteName,
    current_zone: s.currentZoneName,
    avg_bpm: s.avgBpm,
    max_bpm: s.maxBpm,
    trend: s.trend,
    hr_max_percent: s.hrMaxPercent,
    time_by_zone: s.timeByZone,
  }));

  return [
    `Current session summary${classLabel}:`,
    "",
    JSON.stringify(data, null, 2),
    "",
    "Provide a brief motivational message for each athlete. Use avg_bpm (average), never a point-in-time BPM.",
  ].join("\n");
}
```

### 5.3 Custom Prompts per Gym (P2)

Future enhancement: allow gym owners to customize the Coach Pulse persona and tone via `gyms.custom_coach_prompt` (TEXT column, nullable). When set, this text is appended to the system prompt as additional instructions.

Schema addition (P2):
```sql
ALTER TABLE gyms ADD COLUMN custom_coach_prompt TEXT;
```

In the prompt builder:
```typescript
if (gym.customCoachPrompt) {
  systemPrompt += `\n\nAdditional instructions from the gym owner:\n${gym.customCoachPrompt}`;
}
```

---

## 6. Message Distribution

### 6.1 Storage

Every coaching message is persisted to the `ai_coaching_messages` table:

```typescript
interface AiCoachingMessageInsert {
  id: string;           // UUID v4
  sessionId: string;    // FK to sessions.id
  gymId: string;        // FK to gyms.id
  message: string;      // The AI-generated coaching text
  model: string;        // e.g., "gpt-4o-mini"
  athleteSummaries: AthleteSummary[]; // JSONB - full summaries used for the prompt
  createdAt: Date;
}
```

Insert immediately after receiving the OpenAI response, before broadcasting.

### 6.2 WebSocket Broadcast

After storing the message, broadcast to all connected TV clients for the gym:

```typescript
wsServer.broadcastToGym(gymId, {
  type: "ai-coaching",
  data: {
    message: coachingMessage,
    timestamp: new Date().toISOString(),
    sessionId: sessionId,
  },
});
```

The WebSocket message type is `ai-coaching`, matching the existing burnapp protocol.

### 6.3 TV Display Behavior

The TV dashboard renders the coaching message as an overlay on the athlete card grid:

- **Display duration:** 8 seconds, then fade out.
- **Position:** Overlay banner at the bottom or center of the screen (design spec TBD by TV dashboard spec).
- **Animation:** Fade in (300ms) and fade out (300ms).
- **Queue:** If a new message arrives while the previous is still displayed, replace immediately with the new message.
- **Fallback:** If WebSocket disconnects, the TV continues to function without coaching messages (no error state shown to athletes).

---

## 7. Post-Session AI Summary

### 7.1 Trigger

When a session ends (either manually via API or auto-end after 2 minutes of inactivity), the system generates a final AI summary.

```typescript
async function onSessionEnd(sessionId: string, gymId: string): Promise<void> {
  // 1. Compute and store session_athletes stats
  await computeSessionAthleteStats(sessionId);

  // 2. Generate AI summary
  const summary = await generatePostSessionSummary(sessionId, gymId);

  // 3. Store in sessions.ai_summary
  await db
    .update(sessions)
    .set({ aiSummary: summary })
    .where(eq(sessions.id, sessionId));

  // 4. Stop the coaching timer
  stopCoachingTimer(sessionId);
}
```

### 7.2 Input Data

Query `session_athletes` for the completed session to build a comprehensive stats summary per athlete:

```typescript
interface PostSessionAthleteStats {
  athleteName: string;
  avgHr: number;
  maxHr: number;
  minHr: number;
  calories: number;
  durationMinutes: number;
  timeZone1Seconds: number;
  timeZone2Seconds: number;
  timeZone3Seconds: number;
  timeZone4Seconds: number;
  timeZone5Seconds: number;
}
```

### 7.3 Post-Session Prompt

```typescript
function buildPostSessionSystemPrompt(language: "es" | "pt"): string {
  const languageDirectives: Record<string, string> = {
    es: "Responde EXCLUSIVAMENTE en espanol.",
    pt: "Responda EXCLUSIVAMENTE em portugues.",
  };

  return [
    'You are "Coach Pulse". Generate a brief post-session summary.',
    languageDirectives[language],
    "Summarize the overall session performance and highlight standout athletes.",
    "Mention total duration, average intensity, and any notable achievements.",
    "Keep it to 3-5 sentences. Be encouraging about the group effort.",
    "Use a maximum of 2 emojis. Do not use hashtags.",
  ].join(" ");
}

function buildPostSessionUserPrompt(
  classType: string | null,
  durationMinutes: number,
  athletes: PostSessionAthleteStats[]
): string {
  return [
    `Session complete: ${classType || "General"} class, ${durationMinutes} minutes, ${athletes.length} athletes.`,
    "",
    JSON.stringify(athletes, null, 2),
    "",
    "Provide a brief session summary highlighting group performance and standout efforts.",
  ].join("\n");
}
```

### 7.4 OpenAI Call

Same client and parameters as the live coaching call, except:

| Parameter     | Value |
|---------------|-------|
| `max_tokens`  | 400   |
| `temperature` | 0.7   |

### 7.5 Usage

The `sessions.ai_summary` field is used in:

- **Post-session report page** (`/api/v1/reports/session/[id]`): Displayed as the AI commentary section.
- **WhatsApp message:** Optionally included (truncated if too long) in the session report sent to athletes.
- **Athlete portal:** Shown in the session detail view.

---

## 8. Configuration

### 8.1 Environment Variables

| Variable             | Default       | Description |
|----------------------|---------------|-------------|
| `OPENAI_API_KEY`     | (required)    | OpenAI API key. If empty, coaching is disabled entirely. |
| `OPENAI_MODEL`       | `gpt-4o-mini` | Model used for chat completions. |
| `AI_ANALYSIS_INTERVAL_MS` | `30000`  | Milliseconds between analysis cycles (15000-60000). |
| `AI_WARMUP_MS`       | `60000`       | Milliseconds to wait after first sensor data before first analysis. |
| `AI_ANALYSIS_MINUTES`| `10`          | Minutes of HR data window to include in each analysis. |

### 8.2 Gym-Level Settings

Retrieved from the `gyms` table:

| Field                  | Type     | Default | Description |
|------------------------|----------|---------|-------------|
| `language`             | `es\|pt` | `es`    | Language for coaching messages |
| `custom_coach_prompt`  | TEXT     | `null`  | (P2) Additional persona/tone instructions |

### 8.3 Runtime Configuration Object

```typescript
interface CoachingConfig {
  enabled: boolean;              // true if OPENAI_API_KEY is set
  model: string;                 // OPENAI_MODEL
  analysisIntervalMs: number;    // AI_ANALYSIS_INTERVAL_MS
  warmupPeriodMs: number;        // AI_WARMUP_MS
  analysisWindowMinutes: number; // AI_ANALYSIS_MINUTES
  language: "es" | "pt";        // from gym settings
  customPrompt: string | null;  // (P2) from gym settings
}

function getCoachingConfig(gym: Gym): CoachingConfig {
  return {
    enabled: !!process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    analysisIntervalMs: parseInt(process.env.AI_ANALYSIS_INTERVAL_MS || "30000"),
    warmupPeriodMs: parseInt(process.env.AI_WARMUP_MS || "60000"),
    analysisWindowMinutes: parseInt(process.env.AI_ANALYSIS_MINUTES || "10"),
    language: (gym.language as "es" | "pt") || "es",
    customPrompt: gym.customCoachPrompt || null,
  };
}
```

---

## 9. Error Handling and Resilience

### 9.1 Principle

The AI coaching system is a non-critical enhancement. Sessions, HR monitoring, TV display, and all core functionality must work without it. Every failure mode results in the coaching system silently skipping a cycle and retrying on the next interval.

### 9.2 Failure Matrix

| Failure                          | Behavior                                         | User Impact |
|----------------------------------|--------------------------------------------------|-------------|
| `OPENAI_API_KEY` not set         | Coaching disabled at startup. Logged once.        | No coaching messages. Everything else works. |
| OpenAI API timeout (>10s)        | Skip cycle. Log warning.                          | Missed one coaching message. |
| OpenAI API 401 (invalid key)     | Skip cycle. Log error. Set `degraded` flag.       | No coaching until key is fixed. |
| OpenAI API 429 (rate limit)      | Skip cycle. Log warning.                          | Missed one coaching message. |
| OpenAI API 5xx (server error)    | Skip cycle. Log warning.                          | Missed one coaching message. |
| Network error                    | Skip cycle. Log error.                            | Missed one coaching message. |
| Empty/malformed AI response      | Skip cycle. Log warning.                          | Missed one coaching message. |
| Database query fails             | Skip cycle. Log error.                            | Missed one coaching message. |
| No HR data in window             | Skip cycle silently (no log, expected during gaps).| No message (correct behavior). |
| No active athletes in session    | Reset warmup timer. Skip cycle.                   | No message (correct behavior). |
| WebSocket broadcast fails        | Message stored in DB but not shown on TV.          | TV misses message; available in DB for later. |
| Post-session summary fails       | `sessions.ai_summary` remains null. Log error.    | Report shown without AI summary section. |

### 9.3 Logging

All AI system logs use a structured logger with the prefix `[AI Coach]`:

```typescript
const logger = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[AI Coach] ${msg}`, meta ?? ""),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(`[AI Coach] ${msg}`, meta ?? ""),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(`[AI Coach] ${msg}`, meta ?? ""),
};
```

Log events:

| Event                     | Level | Example |
|---------------------------|-------|---------|
| Service started           | info  | `AI Coach enabled (model: gpt-4o-mini, interval: 30s, warmup: 60s)` |
| Service disabled          | warn  | `AI Coach disabled (OPENAI_API_KEY not set)` |
| Warmup started            | info  | `Session abc123: warmup started (60s)` |
| Analysis cycle completed  | info  | `Session abc123: coaching message generated (245 chars, 3 athletes)` |
| Analysis cycle skipped    | debug | `Session abc123: no HR data in window` |
| OpenAI API error          | error | `Session abc123: OpenAI API error (429): rate limit exceeded` |
| Post-session summary done | info  | `Session abc123: post-session summary generated` |

### 9.4 Rate Limiting Awareness

The system uses `gpt-4o-mini` which has generous rate limits. With a 30-second interval and up to 10 concurrent gyms, the maximum request rate is 20 requests/minute. This is well within standard tier limits.

If rate limiting becomes an issue (429 responses), the system simply skips the cycle. No additional backoff is implemented since the natural interval spacing (15-60s) is sufficient.

---

## 10. File Structure

### 10.1 Files

```
lib/
  ai/
    coach.ts       -- Main CoachingService class
    prompts.ts     -- Prompt templates (system, user, post-session)
    types.ts       -- TypeScript type definitions
```

### 10.2 `lib/ai/types.ts`

```typescript
// --- Configuration ---

export interface CoachingConfig {
  enabled: boolean;
  model: string;
  analysisIntervalMs: number;
  warmupPeriodMs: number;
  analysisWindowMinutes: number;
  language: "es" | "pt";
  customPrompt: string | null;
}

// --- Athlete Summary (per analysis cycle) ---

export interface AthleteSummary {
  athleteId: string;
  athleteName: string;
  sensorId: number;
  currentZone: number;
  currentZoneName: string;
  currentZoneColor: string;
  avgBpm: number;
  maxBpm: number;
  minBpm: number;
  hrMaxPercent: number;
  trend: "rising" | "falling" | "stable";
  readingsCount: number;
  timeByZone: Record<string, string>; // e.g., { "Z1 Warmup": "2min", "Z3 Aerobic": "5min" }
}

// --- Analysis Result ---

export interface AnalysisResult {
  message: string;
  summaries: AthleteSummary[];
  model: string;
  timestamp: string;       // ISO 8601
  sessionId: string;
  gymId: string;
}

export interface AnalysisError {
  error: string;
  code: "DISABLED" | "NO_DATA" | "WARMUP" | "API_ERROR" | "DB_ERROR";
}

export type AnalysisOutcome = AnalysisResult | AnalysisError;

// --- Post-Session ---

export interface PostSessionAthleteStats {
  athleteId: string;
  athleteName: string;
  avgHr: number;
  maxHr: number;
  minHr: number;
  calories: number;
  durationMinutes: number;
  timeZone1Seconds: number;
  timeZone2Seconds: number;
  timeZone3Seconds: number;
  timeZone4Seconds: number;
  timeZone5Seconds: number;
}

// --- Timer State ---

export interface SessionTimerState {
  sessionId: string;
  gymId: string;
  timer: ReturnType<typeof setInterval>;
  startedAt: number;     // Date.now() when timer was created
  config: CoachingConfig;
}

// --- WebSocket Message ---

export interface AiCoachingWsMessage {
  type: "ai-coaching";
  data: {
    message: string;
    timestamp: string;   // ISO 8601
    sessionId: string;
  };
}
```

### 10.3 `lib/ai/prompts.ts`

```typescript
import type { AthleteSummary, PostSessionAthleteStats } from "./types";

/**
 * Builds the system prompt for Coach Pulse based on gym language.
 */
export function buildSystemPrompt(
  language: "es" | "pt",
  customPrompt?: string | null
): string {
  const languageDirectives: Record<string, string> = {
    es: "Responde EXCLUSIVAMENTE en espanol.",
    pt: "Responda EXCLUSIVAMENTE em portugues.",
  };

  const base = [
    'You are "Coach Pulse", a virtual fitness coach in a gym with spinning, cycling, pilates, and general fitness classes.',
    languageDirectives[language],
    "Your tone is energetic, motivational, and brief (2-3 sentences per athlete maximum).",
    "CRITICAL: Always reference the AVERAGE BPM (avg_bpm), NEVER a specific point-in-time BPM.",
    "For each athlete, mention: their first name, current HR zone name, trend (rising/falling/stable), and average BPM.",
    "If an athlete is in zone 4-5, encourage them but remind them to rest if they have been there too long.",
    "If an athlete is in zone 0-1, motivate them to increase intensity.",
    "Use a maximum of 1-2 emojis total. Do not use hashtags.",
    "Produce a single cohesive message addressing all athletes.",
  ].join(" ");

  if (customPrompt) {
    return `${base}\n\nAdditional instructions from the gym owner:\n${customPrompt}`;
  }

  return base;
}

/**
 * Builds the user prompt with athlete summary data.
 */
export function buildUserPrompt(
  summaries: AthleteSummary[],
  classType: string | null
): string {
  const classLabel = classType ? ` (${classType})` : "";
  const data = summaries.map((s) => ({
    name: s.athleteName,
    current_zone: s.currentZoneName,
    avg_bpm: s.avgBpm,
    max_bpm: s.maxBpm,
    trend: s.trend,
    hr_max_percent: s.hrMaxPercent,
    time_by_zone: s.timeByZone,
  }));

  return [
    `Current session summary${classLabel}:`,
    "",
    JSON.stringify(data, null, 2),
    "",
    "Provide a brief motivational message for each athlete.",
    "Use avg_bpm (average), never a point-in-time BPM.",
  ].join("\n");
}

/**
 * Builds the system prompt for the post-session AI summary.
 */
export function buildPostSessionSystemPrompt(language: "es" | "pt"): string {
  const languageDirectives: Record<string, string> = {
    es: "Responde EXCLUSIVAMENTE en espanol.",
    pt: "Responda EXCLUSIVAMENTE em portugues.",
  };

  return [
    'You are "Coach Pulse". Generate a brief post-session summary.',
    languageDirectives[language],
    "Summarize the overall session performance and highlight standout athletes.",
    "Mention total duration, average intensity, and any notable achievements.",
    "Keep it to 3-5 sentences. Be encouraging about the group effort.",
    "Use a maximum of 2 emojis. Do not use hashtags.",
  ].join(" ");
}

/**
 * Builds the user prompt for the post-session summary.
 */
export function buildPostSessionUserPrompt(
  classType: string | null,
  durationMinutes: number,
  athletes: PostSessionAthleteStats[]
): string {
  return [
    `Session complete: ${classType || "General"} class, ${durationMinutes} minutes, ${athletes.length} athletes.`,
    "",
    JSON.stringify(athletes, null, 2),
    "",
    "Provide a brief session summary highlighting group performance and standout efforts.",
  ].join("\n");
}
```

### 10.4 `lib/ai/coach.ts`

```typescript
import OpenAI from "openai";
import { eq, and, gte, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  hrReadings,
  athletes,
  athleteBands,
  aiCoachingMessages,
  sessions,
  sessionAthletes,
  gyms,
} from "@/lib/db/schema";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildPostSessionSystemPrompt,
  buildPostSessionUserPrompt,
} from "./prompts";
import type {
  CoachingConfig,
  AthleteSummary,
  AnalysisResult,
  AnalysisError,
  AnalysisOutcome,
  SessionTimerState,
  PostSessionAthleteStats,
} from "./types";

// --- Singleton OpenAI client ---
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 10_000,
      maxRetries: 0,
    })
  : null;

// --- Active session timers ---
const activeTimers = new Map<string, SessionTimerState>();

// --- Logger ---
const logger = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[AI Coach] ${msg}`, meta ?? ""),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(`[AI Coach] ${msg}`, meta ?? ""),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error(`[AI Coach] ${msg}`, meta ?? ""),
};

/**
 * Build coaching config from environment + gym settings.
 */
export function getCoachingConfig(gym: { language: string; customCoachPrompt?: string | null }): CoachingConfig {
  return {
    enabled: !!process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    analysisIntervalMs: parseInt(process.env.AI_ANALYSIS_INTERVAL_MS || "30000"),
    warmupPeriodMs: parseInt(process.env.AI_WARMUP_MS || "60000"),
    analysisWindowMinutes: parseInt(process.env.AI_ANALYSIS_MINUTES || "10"),
    language: (gym.language as "es" | "pt") || "es",
    customPrompt: gym.customCoachPrompt ?? null,
  };
}

/**
 * Start the coaching analysis loop for a session.
 * Called when first HR data arrives for an active session.
 */
export function startCoachingTimer(
  sessionId: string,
  gymId: string,
  config: CoachingConfig,
  broadcastFn: (gymId: string, message: unknown) => void
): void {
  if (!config.enabled) {
    logger.warn("AI Coach disabled (OPENAI_API_KEY not set)");
    return;
  }

  if (activeTimers.has(sessionId)) {
    return; // Already running
  }

  const timer = setInterval(
    () => runAnalysisCycle(sessionId, gymId, config, broadcastFn),
    config.analysisIntervalMs
  );

  activeTimers.set(sessionId, {
    sessionId,
    gymId,
    timer,
    startedAt: Date.now(),
    config,
  });

  logger.info(
    `Timer started for session ${sessionId}`,
    { interval: config.analysisIntervalMs, warmup: config.warmupPeriodMs }
  );
}

/**
 * Stop the coaching timer for a session.
 */
export function stopCoachingTimer(sessionId: string): void {
  const state = activeTimers.get(sessionId);
  if (state) {
    clearInterval(state.timer);
    activeTimers.delete(sessionId);
    logger.info(`Timer stopped for session ${sessionId}`);
  }
}

/**
 * Single analysis cycle. Called by setInterval.
 */
async function runAnalysisCycle(
  sessionId: string,
  gymId: string,
  config: CoachingConfig,
  broadcastFn: (gymId: string, message: unknown) => void
): Promise<void> {
  try {
    const timerState = activeTimers.get(sessionId);
    if (!timerState) return;

    // Check warmup
    const elapsed = Date.now() - timerState.startedAt;
    if (elapsed < config.warmupPeriodMs) {
      return;
    }

    // Fetch and summarize data
    const summaries = await fetchAndSummarize(sessionId, gymId, config);
    if (summaries.length === 0) {
      return; // No data, skip silently
    }

    // Get session class type
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      columns: { classType: true },
    });

    // Call OpenAI
    const message = await callOpenAI(
      config,
      buildSystemPrompt(config.language, config.customPrompt),
      buildUserPrompt(summaries, session?.classType ?? null)
    );

    if (!message) return;

    // Store in database
    await db.insert(aiCoachingMessages).values({
      sessionId,
      gymId,
      message,
      model: config.model,
      athleteSummaries: summaries,
    });

    // Broadcast to TV
    broadcastFn(gymId, {
      type: "ai-coaching",
      data: {
        message,
        timestamp: new Date().toISOString(),
        sessionId,
      },
    });

    logger.info(
      `Coaching message generated for session ${sessionId}`,
      { chars: message.length, athletes: summaries.length }
    );
  } catch (err) {
    logger.error(`Analysis cycle failed for session ${sessionId}`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Fetch HR readings and produce per-athlete summaries.
 */
async function fetchAndSummarize(
  sessionId: string,
  gymId: string,
  config: CoachingConfig
): Promise<AthleteSummary[]> {
  const windowStart = new Date(
    Date.now() - config.analysisWindowMinutes * 60 * 1000
  );

  const rows = await db
    .select({
      sensorId: hrReadings.sensorId,
      athleteId: hrReadings.athleteId,
      heartRateBpm: hrReadings.heartRateBpm,
      hrZone: hrReadings.hrZone,
      hrZoneName: hrReadings.hrZoneName,
      hrZoneColor: hrReadings.hrZoneColor,
      hrMaxPercent: hrReadings.hrMaxPercent,
      recordedAt: hrReadings.recordedAt,
      athleteName: athletes.name,
    })
    .from(hrReadings)
    .innerJoin(athletes, eq(athletes.id, hrReadings.athleteId))
    .where(
      and(
        eq(hrReadings.sessionId, sessionId),
        gte(hrReadings.recordedAt, windowStart),
        eq(hrReadings.deviceActive, true)
      )
    )
    .orderBy(desc(hrReadings.recordedAt));

  // Filter out zero BPM readings
  const validRows = rows.filter((r) => r.heartRateBpm > 0);

  if (validRows.length === 0) return [];

  // Group by athlete
  const byAthlete = new Map<string, typeof validRows>();
  for (const row of validRows) {
    const key = row.athleteId!;
    if (!byAthlete.has(key)) {
      byAthlete.set(key, []);
    }
    byAthlete.get(key)!.push(row);
  }

  // Build summaries
  const summaries: AthleteSummary[] = [];

  for (const [athleteId, readings] of byAthlete) {
    const bpms = readings.map((r) => r.heartRateBpm);
    const latest = readings[0]; // Most recent (ordered DESC)

    const avgBpm = Math.round(
      bpms.reduce((a, b) => a + b, 0) / bpms.length
    );

    // Trend calculation
    let trend: "rising" | "falling" | "stable" = "stable";
    if (bpms.length >= 4) {
      const mid = Math.floor(bpms.length / 2);
      const recentAvg =
        bpms.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const olderAvg =
        bpms.slice(mid).reduce((a, b) => a + b, 0) / (bpms.length - mid);
      const diff = recentAvg - olderAvg;
      if (diff > 5) trend = "rising";
      else if (diff < -5) trend = "falling";
    }

    // Time by zone (approximate: each reading ~5s)
    const zoneCounts: Record<number, { count: number; name: string }> = {};
    for (const r of readings) {
      if (!zoneCounts[r.hrZone]) {
        zoneCounts[r.hrZone] = { count: 0, name: r.hrZoneName };
      }
      zoneCounts[r.hrZone].count++;
    }
    const timeByZone: Record<string, string> = {};
    for (const [zone, data] of Object.entries(zoneCounts)) {
      timeByZone[`Z${zone} ${data.name}`] = `${Math.round((data.count * 5) / 60)}min`;
    }

    summaries.push({
      athleteId,
      athleteName: latest.athleteName,
      sensorId: latest.sensorId,
      currentZone: latest.hrZone,
      currentZoneName: latest.hrZoneName,
      currentZoneColor: latest.hrZoneColor,
      avgBpm,
      maxBpm: Math.max(...bpms),
      minBpm: Math.min(...bpms),
      hrMaxPercent: latest.hrMaxPercent,
      trend,
      readingsCount: readings.length,
      timeByZone,
    });
  }

  return summaries;
}

/**
 * Call OpenAI chat completions API.
 * Returns the message content or null on failure.
 */
async function callOpenAI(
  config: CoachingConfig,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 300
): Promise<string | null> {
  if (!openai) return null;

  try {
    const completion = await openai.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.75,
      max_tokens: maxTokens,
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      logger.warn("OpenAI returned empty response");
      return null;
    }

    return content;
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      logger.error(`OpenAI API error (${err.status}): ${err.message}`);
    } else {
      logger.error(
        `OpenAI call failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return null;
  }
}

/**
 * Generate post-session AI summary.
 * Called when a session ends.
 */
export async function generatePostSessionSummary(
  sessionId: string,
  gymId: string
): Promise<string | null> {
  if (!openai) return null;

  try {
    // Get gym config
    const gym = await db.query.gyms.findFirst({
      where: eq(gyms.id, gymId),
    });
    if (!gym) return null;

    const config = getCoachingConfig(gym);

    // Get session info
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    if (!session) return null;

    const durationMinutes = session.durationSeconds
      ? Math.round(session.durationSeconds / 60)
      : 0;

    // Get athlete stats
    const athleteStats = await db
      .select({
        athleteId: sessionAthletes.athleteId,
        athleteName: athletes.name,
        avgHr: sessionAthletes.avgHr,
        maxHr: sessionAthletes.maxHr,
        minHr: sessionAthletes.minHr,
        calories: sessionAthletes.calories,
        timeZone1Seconds: sessionAthletes.timeZone1S,
        timeZone2Seconds: sessionAthletes.timeZone2S,
        timeZone3Seconds: sessionAthletes.timeZone3S,
        timeZone4Seconds: sessionAthletes.timeZone4S,
        timeZone5Seconds: sessionAthletes.timeZone5S,
      })
      .from(sessionAthletes)
      .innerJoin(athletes, eq(athletes.id, sessionAthletes.athleteId))
      .where(eq(sessionAthletes.sessionId, sessionId));

    if (athleteStats.length === 0) return null;

    const stats: PostSessionAthleteStats[] = athleteStats.map((s) => ({
      athleteId: s.athleteId,
      athleteName: s.athleteName,
      avgHr: s.avgHr ?? 0,
      maxHr: s.maxHr ?? 0,
      minHr: s.minHr ?? 0,
      calories: s.calories ?? 0,
      durationMinutes,
      timeZone1Seconds: s.timeZone1Seconds ?? 0,
      timeZone2Seconds: s.timeZone2Seconds ?? 0,
      timeZone3Seconds: s.timeZone3Seconds ?? 0,
      timeZone4Seconds: s.timeZone4Seconds ?? 0,
      timeZone5Seconds: s.timeZone5Seconds ?? 0,
    }));

    const summary = await callOpenAI(
      config,
      buildPostSessionSystemPrompt(config.language),
      buildPostSessionUserPrompt(session.classType, durationMinutes, stats),
      400
    );

    if (summary) {
      logger.info(`Post-session summary generated for session ${sessionId}`, {
        chars: summary.length,
      });
    }

    return summary;
  } catch (err) {
    logger.error(`Post-session summary failed for session ${sessionId}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
```

---

## Appendix A: Mapping from burnapp ai-analyzer.js

| burnapp (ai-analyzer.js)          | BeatMind AI (lib/ai/coach.ts)         | Notes |
|------------------------------------|---------------------------------------|-------|
| `AiAnalyzer` class                | Module-level functions                | No class needed; functions with module-scoped state |
| `this.dbWriter._pool.query()`     | Drizzle ORM query builder             | Type-safe, no raw SQL |
| `axios.post()` to OpenAI          | `openai.chat.completions.create()`    | Official SDK with built-in types |
| `COOLDOWN_MS` (60s interval)      | `AI_ANALYSIS_INTERVAL_MS` (30s default) | Renamed for clarity; shorter default |
| `this._sessionStart` warmup       | `SessionTimerState.startedAt`         | Same logic, stored per-session |
| `this._onResult` callback         | `broadcastFn` parameter               | WebSocket broadcast to gym TV clients |
| Single gym, `data_heartrate`      | Multi-tenant, `hr_readings` scoped by `session_id` + `gym_id` | Tenant isolation |
| Hardcoded Spanish                 | `gym.language` (es/pt)                | Configurable per gym |
| `athlete_name` in HR table        | JOIN via `athlete_bands` + `athletes` | Proper relational lookup |
| No message persistence            | `ai_coaching_messages` table          | Full audit trail with JSONB summaries |
| No post-session summary           | `generatePostSessionSummary()`        | New feature |

## Appendix B: Database Tables Referenced

| Table                  | Usage in AI Coaching |
|------------------------|----------------------|
| `gyms`                 | Read `language`, `custom_coach_prompt` for config |
| `sessions`             | Read `class_type`, `duration_seconds`; write `ai_summary` |
| `athletes`             | Read `name` for prompt generation |
| `athlete_bands`        | Resolve `sensor_id` to `athlete_id` (fallback) |
| `hr_readings`          | Read recent HR data for analysis window |
| `session_athletes`     | Read post-session stats per athlete |
| `ai_coaching_messages` | Write coaching messages with summaries |
