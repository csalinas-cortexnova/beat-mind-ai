-- BeatMind AI — PostgreSQL Database Roles
-- Run as superuser (postgres) on the beatmind database
-- Usage: psql -U postgres -d beatmind -f db-roles.sql

-- ============================================================
-- 1. Application role (used by Next.js + WS server at runtime)
--    Privileges: SELECT, INSERT, UPDATE, DELETE only
--    No: DROP, TRUNCATE, CREATE, ALTER, REFERENCES
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'beatmind_app') THEN
        CREATE ROLE beatmind_app WITH LOGIN PASSWORD 'CHANGE_ME_APP_PASSWORD';
        RAISE NOTICE 'Created role: beatmind_app';
    ELSE
        RAISE NOTICE 'Role beatmind_app already exists';
    END IF;
END $$;

GRANT CONNECT ON DATABASE beatmind TO beatmind_app;
GRANT USAGE ON SCHEMA public TO beatmind_app;

-- Current tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO beatmind_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO beatmind_app;

-- Future tables (created by migrations role)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO beatmind_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO beatmind_app;


-- ============================================================
-- 2. Migrations role (used only during deployments by deploy.sh)
--    Privileges: ALL (CREATE TABLE, ALTER, DROP, etc.)
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'beatmind_migrations') THEN
        CREATE ROLE beatmind_migrations WITH LOGIN PASSWORD 'CHANGE_ME_MIGRATIONS_PASSWORD';
        RAISE NOTICE 'Created role: beatmind_migrations';
    ELSE
        RAISE NOTICE 'Role beatmind_migrations already exists';
    END IF;
END $$;

GRANT CONNECT ON DATABASE beatmind TO beatmind_migrations;
GRANT ALL PRIVILEGES ON SCHEMA public TO beatmind_migrations;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO beatmind_migrations;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO beatmind_migrations;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL PRIVILEGES ON TABLES TO beatmind_migrations;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL PRIVILEGES ON SEQUENCES TO beatmind_migrations;


-- ============================================================
-- 3. Backup role (used by backup.sh cron job)
--    Privileges: SELECT only (read-only for pg_dump)
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'beatmind_backup') THEN
        CREATE ROLE beatmind_backup WITH LOGIN PASSWORD 'CHANGE_ME_BACKUP_PASSWORD';
        RAISE NOTICE 'Created role: beatmind_backup';
    ELSE
        RAISE NOTICE 'Role beatmind_backup already exists';
    END IF;
END $$;

GRANT CONNECT ON DATABASE beatmind TO beatmind_backup;
GRANT USAGE ON SCHEMA public TO beatmind_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO beatmind_backup;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO beatmind_backup;


-- ============================================================
-- 4. Enforce SSL connections (uncomment for production)
-- ============================================================

-- Require SSL for all app connections
-- ALTER ROLE beatmind_app SET ssl TO on;
-- ALTER ROLE beatmind_migrations SET ssl TO on;
-- ALTER ROLE beatmind_backup SET ssl TO on;

-- Verify roles
SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb
FROM pg_roles
WHERE rolname LIKE 'beatmind_%';
