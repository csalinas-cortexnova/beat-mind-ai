#!/usr/bin/env bash
# BeatMind AI — Deployment Script
# Run as 'beatmind' user on VPS
# Usage: bash deploy.sh [--skip-build]
set -euo pipefail

APP_DIR="/opt/beatmind/beat-mind-ai"
SKIP_BUILD="${1:-}"

echo "=== BeatMind AI Deploy ==="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting deployment..."

cd "$APP_DIR"

# --- 1. Pull latest code ---
echo "[STEP 1/6] Pulling latest code..."
git pull --ff-only origin main

# --- 2. Install dependencies ---
echo "[STEP 2/6] Installing dependencies..."
bun install --frozen-lockfile

# --- 3. Run database migrations ---
echo "[STEP 3/6] Running database migrations..."
# Uses MIGRATION_DATABASE_URL (beatmind_migrations role with full privileges)
# Falls back to DATABASE_URL if MIGRATION_DATABASE_URL is not set
bunx drizzle-kit migrate

# --- 4. Build Next.js ---
if [ "$SKIP_BUILD" = "--skip-build" ]; then
    echo "[STEP 4/6] Skipping build (--skip-build flag)"
else
    echo "[STEP 4/6] Building Next.js..."
    bun run build
fi

# --- 5. Reload PM2 processes ---
echo "[STEP 5/6] Reloading PM2 processes..."
pm2 reload ecosystem.config.js --env production

# --- 6. Health check ---
echo "[STEP 6/6] Running health checks..."
sleep 3

# Check Next.js
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ || echo "000")
if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "302" ]; then
    echo "  [OK] Next.js is responding (HTTP $HTTP_STATUS)"
else
    echo "  [WARN] Next.js returned HTTP $HTTP_STATUS — check: pm2 logs beatmind-next"
fi

# Check WebSocket server
WS_PORT=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
apps = json.load(sys.stdin)
for a in apps:
    if a['name'] == 'beatmind-ws':
        print(a.get('pm2_env', {}).get('WS_PORT', 8080))
        break
" 2>/dev/null || echo "8080")

WS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${WS_PORT}/health" || echo "000")
if [ "$WS_STATUS" = "200" ]; then
    echo "  [OK] WebSocket server is responding (HTTP $WS_STATUS)"
else
    echo "  [WARN] WebSocket server returned HTTP $WS_STATUS — check: pm2 logs beatmind-ws"
fi

# PM2 process status
echo ""
pm2 status

echo ""
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Deployment complete"
