#!/usr/bin/env bash
# BeatMind AI — Security Verification Script
# Run on VPS after setup to verify all security measures
# Usage: sudo bash verify-security.sh
set -uo pipefail

PASS=0
FAIL=0
WARN=0

check_pass() { echo "  [PASS] $1"; ((PASS++)); }
check_fail() { echo "  [FAIL] $1"; ((FAIL++)); }
check_warn() { echo "  [WARN] $1"; ((WARN++)); }

echo "=== BeatMind AI Security Verification ==="
echo ""

# --- 1. User & Permissions ---
echo "--- User & Permissions ---"

if id "beatmind" &>/dev/null; then
    check_pass "User 'beatmind' exists"
else
    check_fail "User 'beatmind' does not exist"
fi

ENV_FILE="/opt/beatmind/beat-mind-ai/.env.local"
if [ -f "$ENV_FILE" ]; then
    PERMS=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null)
    if [ "$PERMS" = "600" ]; then
        check_pass ".env.local permissions are 600"
    else
        check_fail ".env.local permissions are $PERMS (expected 600)"
    fi
else
    check_warn ".env.local not found at $ENV_FILE"
fi

OWNER=$(stat -c '%U' /opt/beatmind 2>/dev/null || stat -f '%Su' /opt/beatmind 2>/dev/null)
if [ "$OWNER" = "beatmind" ]; then
    check_pass "/opt/beatmind owned by beatmind"
else
    check_fail "/opt/beatmind owned by $OWNER (expected beatmind)"
fi

# --- 2. Firewall ---
echo ""
echo "--- Firewall ---"

if command -v ufw &>/dev/null; then
    UFW_STATUS=$(sudo ufw status 2>/dev/null | head -1)
    if echo "$UFW_STATUS" | grep -q "active"; then
        check_pass "UFW is active"
    else
        check_fail "UFW is not active"
    fi

    # Port 8080 should NOT be open
    if sudo ufw status | grep -q "8080"; then
        check_fail "Port 8080 is exposed via UFW (should be localhost only)"
    else
        check_pass "Port 8080 not exposed (WS via Nginx proxy)"
    fi

    # Port 5432 should NOT be open
    if sudo ufw status | grep -q "5432"; then
        check_fail "Port 5432 is exposed via UFW (PostgreSQL should be localhost only)"
    else
        check_pass "Port 5432 not exposed (DB localhost only)"
    fi
else
    check_fail "UFW not installed"
fi

# --- 3. SSH ---
echo ""
echo "--- SSH Configuration ---"

SSHD_CONFIG="/etc/ssh/sshd_config"
if [ -f "$SSHD_CONFIG" ]; then
    if grep -q "^PasswordAuthentication no" "$SSHD_CONFIG"; then
        check_pass "SSH password authentication disabled"
    else
        check_fail "SSH password authentication may be enabled"
    fi

    if grep -q "^PermitRootLogin no" "$SSHD_CONFIG"; then
        check_pass "SSH root login disabled"
    else
        check_warn "SSH root login may be enabled"
    fi
else
    check_warn "sshd_config not found"
fi

# --- 4. Nginx ---
echo ""
echo "--- Nginx ---"

if systemctl is-active --quiet nginx 2>/dev/null; then
    check_pass "Nginx is running"
else
    check_fail "Nginx is not running"
fi

if nginx -t 2>&1 | grep -q "successful"; then
    check_pass "Nginx config syntax OK"
else
    check_fail "Nginx config has errors"
fi

# Check HTTPS redirect
HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://app.beatmind.ai/ 2>/dev/null || echo "000")
if [ "$HTTP_RESPONSE" = "301" ]; then
    check_pass "HTTP redirects to HTTPS (301)"
elif [ "$HTTP_RESPONSE" = "000" ]; then
    check_warn "Could not reach http://app.beatmind.ai (DNS or network issue)"
else
    check_fail "HTTP returned $HTTP_RESPONSE (expected 301)"
fi

# --- 5. SSL Certificate ---
echo ""
echo "--- SSL Certificate ---"

CERT_FILE="/etc/letsencrypt/live/app.beatmind.ai/fullchain.pem"
if [ -f "$CERT_FILE" ]; then
    EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_FILE" 2>/dev/null | cut -d= -f2)
    EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null || date -jf "%b %d %H:%M:%S %Y %Z" "$EXPIRY" +%s 2>/dev/null || echo "0")
    NOW_EPOCH=$(date +%s)
    DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

    if [ "$DAYS_LEFT" -gt 30 ]; then
        check_pass "SSL cert valid for $DAYS_LEFT more days"
    elif [ "$DAYS_LEFT" -gt 0 ]; then
        check_warn "SSL cert expires in $DAYS_LEFT days — renew soon"
    else
        check_fail "SSL cert has expired"
    fi
else
    check_warn "SSL certificate not found at $CERT_FILE"
fi

# --- 6. PM2 ---
echo ""
echo "--- PM2 Processes ---"

if command -v pm2 &>/dev/null; then
    PM2_USER=$(ps -o user= -p "$(pgrep -f 'PM2' | head -1)" 2>/dev/null || echo "unknown")
    if [ "$PM2_USER" = "beatmind" ]; then
        check_pass "PM2 running as beatmind user"
    elif [ "$PM2_USER" = "root" ]; then
        check_fail "PM2 running as root (should be beatmind)"
    else
        check_warn "PM2 running as $PM2_USER"
    fi

    # Check processes are online
    if pm2 jlist 2>/dev/null | python3 -c "
import sys, json
apps = json.load(sys.stdin)
for a in apps:
    if a.get('pm2_env', {}).get('status') != 'online':
        sys.exit(1)
" 2>/dev/null; then
        check_pass "All PM2 processes are online"
    else
        check_fail "Some PM2 processes are not online"
    fi
else
    check_fail "PM2 not installed"
fi

# --- 7. PostgreSQL ---
echo ""
echo "--- PostgreSQL ---"

if command -v psql &>/dev/null; then
    # Check if beatmind_app role exists
    if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='beatmind_app'" 2>/dev/null | grep -q "1"; then
        check_pass "beatmind_app role exists"
    else
        check_fail "beatmind_app role does not exist"
    fi

    if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='beatmind_migrations'" 2>/dev/null | grep -q "1"; then
        check_pass "beatmind_migrations role exists"
    else
        check_fail "beatmind_migrations role does not exist"
    fi

    if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='beatmind_backup'" 2>/dev/null | grep -q "1"; then
        check_pass "beatmind_backup role exists"
    else
        check_fail "beatmind_backup role does not exist"
    fi

    # Check SSL is enabled
    SSL_ON=$(sudo -u postgres psql -tAc "SHOW ssl" 2>/dev/null || echo "off")
    if [ "$SSL_ON" = "on" ]; then
        check_pass "PostgreSQL SSL is enabled"
    else
        check_warn "PostgreSQL SSL is $SSL_ON"
    fi
else
    check_warn "psql not available for database checks"
fi

# --- 8. Backups ---
echo ""
echo "--- Backups ---"

BACKUP_DIR="/opt/beatmind/backups"
if [ -d "$BACKUP_DIR" ]; then
    BACKUP_COUNT=$(find "$BACKUP_DIR" -name "beatmind_*.dump" -mtime -7 | wc -l)
    if [ "$BACKUP_COUNT" -gt 0 ]; then
        check_pass "Found $BACKUP_COUNT backups from last 7 days"
    else
        check_warn "No recent backups found (check cron)"
    fi
else
    check_warn "Backup directory $BACKUP_DIR does not exist"
fi

# Verify cron is installed
if crontab -u beatmind -l 2>/dev/null | grep -q "backup.sh"; then
    check_pass "Backup cron job is installed"
else
    check_warn "Backup cron job not found for beatmind user"
fi

# --- Summary ---
echo ""
echo "=== Summary ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  WARN: $WARN"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo "STATUS: FAILED — $FAIL issue(s) must be resolved before production"
    exit 1
else
    echo "STATUS: OK (with $WARN warning(s))"
    exit 0
fi
