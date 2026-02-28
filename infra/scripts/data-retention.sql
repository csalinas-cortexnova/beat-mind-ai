-- BeatMind AI — Data Retention Policy
-- Monthly cron job to archive and purge old data
-- Usage: psql -U beatmind_migrations -d beatmind -f data-retention.sql
-- Schedule: Monthly at 04:00 UTC (see infra/cron/beatmind-cron)

BEGIN;

-- ============================================================
-- 1. HR Readings: Archive >6 months, Purge >24 months
-- ============================================================

-- 1a. Create archive table if not exists (same structure, no FK constraints)
CREATE TABLE IF NOT EXISTS hr_readings_archive (
    id BIGINT PRIMARY KEY,
    session_id UUID NOT NULL,
    gym_id UUID NOT NULL,
    athlete_id UUID NOT NULL,
    sensor_id INTEGER NOT NULL,
    heart_rate_bpm INTEGER NOT NULL,
    hr_zone INTEGER NOT NULL,
    hr_zone_name VARCHAR(20) NOT NULL,
    hr_zone_color VARCHAR(7) NOT NULL,
    hr_max_percent DECIMAL(5,2) NOT NULL,
    beat_time TIMESTAMPTZ NOT NULL,
    beat_count INTEGER NOT NULL DEFAULT 0,
    device_active BOOLEAN NOT NULL DEFAULT TRUE,
    recorded_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_archive_gym_time
    ON hr_readings_archive (gym_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_archive_athlete
    ON hr_readings_archive (athlete_id, recorded_at DESC);

-- 1b. Archive hr_readings older than 6 months (not already archived)
INSERT INTO hr_readings_archive (
    id, session_id, gym_id, athlete_id, sensor_id,
    heart_rate_bpm, hr_zone, hr_zone_name, hr_zone_color,
    hr_max_percent, beat_time, beat_count, device_active, recorded_at
)
SELECT
    id, session_id, gym_id, athlete_id, sensor_id,
    heart_rate_bpm, hr_zone, hr_zone_name, hr_zone_color,
    hr_max_percent, beat_time, beat_count, device_active, recorded_at
FROM hr_readings
WHERE recorded_at < NOW() - INTERVAL '6 months'
ON CONFLICT (id) DO NOTHING;

-- 1c. Delete archived rows from live table
DELETE FROM hr_readings
WHERE recorded_at < NOW() - INTERVAL '6 months';

-- 1d. Purge archive entries older than 24 months
DELETE FROM hr_readings_archive
WHERE recorded_at < NOW() - INTERVAL '24 months';


-- ============================================================
-- 2. AI Coaching Messages: Archive >6 months, Purge >12 months
-- ============================================================

-- 2a. Create archive table if not exists
CREATE TABLE IF NOT EXISTS ai_coaching_messages_archive (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL,
    gym_id UUID NOT NULL,
    message_type VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    athlete_summaries JSONB,
    language VARCHAR(5) NOT NULL DEFAULT 'es',
    model VARCHAR(50),
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_archive_session
    ON ai_coaching_messages_archive (session_id, created_at DESC);

-- 2b. Archive ai_coaching_messages older than 6 months
INSERT INTO ai_coaching_messages_archive (
    id, session_id, gym_id, message_type, content,
    athlete_summaries, language, model, prompt_tokens,
    completion_tokens, latency_ms, created_at
)
SELECT
    id, session_id, gym_id, message_type, content,
    athlete_summaries, language, model, prompt_tokens,
    completion_tokens, latency_ms, created_at
FROM ai_coaching_messages
WHERE created_at < NOW() - INTERVAL '6 months'
ON CONFLICT (id) DO NOTHING;

-- 2c. Delete archived rows from live table
DELETE FROM ai_coaching_messages
WHERE created_at < NOW() - INTERVAL '6 months';

-- 2d. Purge archive entries older than 12 months
DELETE FROM ai_coaching_messages_archive
WHERE created_at < NOW() - INTERVAL '12 months';

COMMIT;

-- Report results
SELECT 'hr_readings' AS table_name, COUNT(*) AS live_count FROM hr_readings
UNION ALL
SELECT 'hr_readings_archive', COUNT(*) FROM hr_readings_archive
UNION ALL
SELECT 'ai_coaching_messages', COUNT(*) FROM ai_coaching_messages
UNION ALL
SELECT 'ai_coaching_messages_archive', COUNT(*) FROM ai_coaching_messages_archive;
