# Credential Rotation Runbook

> **When to run:** Before first production deploy, and periodically (quarterly) or after any suspected credential leak.

## Pre-Requisites

- SSH access to VPS as `beatmind` user
- Access to Clerk Dashboard, OpenAI Dashboard, Twilio Console
- PostgreSQL superuser access (for password changes)

## Rotation Procedure

### 1. Clerk API Keys (P0)

1. Go to [Clerk Dashboard](https://dashboard.clerk.com) > **API Keys**
2. Click **Rotate** on `CLERK_SECRET_KEY`
3. Copy the new secret key
4. On VPS, update `.env.local`:
   ```bash
   nano /opt/beatmind/beat-mind-ai/.env.local
   # Update CLERK_SECRET_KEY=sk_live_NEW_VALUE
   # NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY only changes if you rotate it too
   ```
5. Restart app:
   ```bash
   pm2 reload beatmind-next
   ```
6. **Verify:** Visit `https://app.beatmind.ai/sign-in` — should load the Clerk sign-in component without errors

### 2. DATABASE_URL Password (P0)

1. Generate a new strong password:
   ```bash
   openssl rand -base64 32
   ```
2. Connect as superuser and change passwords:
   ```sql
   ALTER ROLE beatmind_app WITH PASSWORD 'NEW_APP_PASSWORD';
   ALTER ROLE beatmind_migrations WITH PASSWORD 'NEW_MIGRATIONS_PASSWORD';
   ALTER ROLE beatmind_backup WITH PASSWORD 'NEW_BACKUP_PASSWORD';
   ```
3. Update `.env.local` on VPS:
   ```bash
   # DATABASE_URL=postgresql://beatmind_app:NEW_APP_PASSWORD@localhost:5432/beatmind?sslmode=require
   # MIGRATION_DATABASE_URL=postgresql://beatmind_migrations:NEW_MIGRATIONS_PASSWORD@localhost:5432/beatmind?sslmode=require
   # BACKUP_DB_PASSWORD=NEW_BACKUP_PASSWORD
   ```
4. Restart all processes:
   ```bash
   pm2 reload all
   ```
5. **Verify:** Check logs for DB connection errors:
   ```bash
   pm2 logs --lines 20
   ```

### 3. OPENAI_API_KEY (P0)

1. Go to [OpenAI Dashboard](https://platform.openai.com/api-keys)
2. Click **Create new secret key** (name: `beatmind-prod-YYYYMMDD`)
3. Copy the new key
4. Update `.env.local`:
   ```bash
   # OPENAI_API_KEY=sk-NEW_VALUE
   ```
5. **Revoke** the old key on OpenAI Dashboard
6. Restart:
   ```bash
   pm2 reload beatmind-next beatmind-ws
   ```
7. **Verify:** Trigger a coaching cycle or session end — check logs for OpenAI call success

### 4. WS_INTERNAL_SECRET (P1)

1. Generate a new secret:
   ```bash
   openssl rand -hex 32
   ```
2. Update `.env.local`:
   ```bash
   # WS_INTERNAL_SECRET=NEW_HEX_VALUE
   ```
3. Restart both processes (they share this secret):
   ```bash
   pm2 reload all
   ```
4. **Verify:** End a session via API — check that the WS server receives the internal broadcast

### 5. Twilio Credentials (P1)

1. Go to [Twilio Console](https://console.twilio.com) > **Account** > **API keys & tokens**
2. Rotate the Auth Token (or create a new API key pair)
3. Update `.env.local`:
   ```bash
   # TWILIO_ACCOUNT_SID=ACXXXXXXXXX  (usually doesn't change)
   # TWILIO_AUTH_TOKEN=NEW_AUTH_TOKEN
   ```
4. Restart:
   ```bash
   pm2 reload beatmind-next
   ```
5. **Verify:** Send a test WhatsApp message via the API

### 6. REPORT_TOKEN_SECRET (P1)

1. Generate a new secret:
   ```bash
   openssl rand -hex 32
   ```
2. Update `.env.local`:
   ```bash
   # REPORT_TOKEN_SECRET=NEW_HEX_VALUE
   ```
3. Restart:
   ```bash
   pm2 reload beatmind-next
   ```
4. **Note:** Existing report links will become invalid (tokens signed with old secret). This is expected — new reports will generate new tokens.

## Post-Rotation Checklist

- [ ] All `.env.local` values updated on VPS
- [ ] `chmod 600 /opt/beatmind/beat-mind-ai/.env.local`
- [ ] All PM2 processes restarted and healthy (`pm2 status`)
- [ ] Sign-in flow works (Clerk)
- [ ] API returns data (DATABASE_URL)
- [ ] AI coaching fires (OPENAI_API_KEY)
- [ ] WebSocket connections established (WS_INTERNAL_SECRET)
- [ ] WhatsApp sends (Twilio)
- [ ] Old credentials revoked on all provider dashboards
