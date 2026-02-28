#!/usr/bin/env bash
# BeatMind AI — Daily Database Backup Script
# Runs as cron job under the 'beatmind' user
# Usage: bash backup.sh (or via cron, see infra/cron/beatmind-cron)
set -euo pipefail

# Configuration (override via environment)
BACKUP_DIR="${BACKUP_DIR:-/opt/beatmind/backups}"
DB_NAME="${DB_NAME:-beatmind}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-beatmind_backup}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Load backup password from .env if not set
if [ -z "${PGPASSWORD:-}" ]; then
    ENV_FILE="/opt/beatmind/beat-mind-ai/.env.local"
    if [ -f "$ENV_FILE" ]; then
        PGPASSWORD=$(grep '^BACKUP_DB_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' || true)
        export PGPASSWORD
    fi
fi

if [ -z "${PGPASSWORD:-}" ]; then
    echo "[ERROR] PGPASSWORD or BACKUP_DB_PASSWORD not set" >&2
    exit 1
fi

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/beatmind_${TIMESTAMP}.dump"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting backup..."

# Create compressed custom-format dump
pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -F c \
    -Z 6 \
    -f "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup complete: $BACKUP_FILE ($BACKUP_SIZE)"

# Remove backups older than retention period
DELETED=$(find "$BACKUP_DIR" -name "beatmind_*.dump" -mtime "+${RETENTION_DAYS}" -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Cleaned up $DELETED old backups (>${RETENTION_DAYS} days)"
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup job finished"
