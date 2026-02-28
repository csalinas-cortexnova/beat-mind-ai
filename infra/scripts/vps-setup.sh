#!/usr/bin/env bash
# BeatMind AI — VPS Initial Setup Script
# Run as root on a fresh Ubuntu 22.04+ VPS
# Usage: sudo bash vps-setup.sh
set -euo pipefail

BEATMIND_USER="beatmind"
APP_DIR="/opt/beatmind"
LOG_DIR="${APP_DIR}/logs"
BACKUP_DIR="${APP_DIR}/backups"

echo "=== BeatMind AI VPS Setup ==="

# --- 1. Create application user ---
if id "$BEATMIND_USER" &>/dev/null; then
    echo "[SKIP] User '$BEATMIND_USER' already exists"
else
    useradd -m -s /bin/bash "$BEATMIND_USER"
    echo "[OK] Created user '$BEATMIND_USER'"
fi

# --- 2. Create application directories ---
mkdir -p "$APP_DIR" "$LOG_DIR" "$BACKUP_DIR"
chown -R "${BEATMIND_USER}:${BEATMIND_USER}" "$APP_DIR"
chmod 750 "$APP_DIR"
echo "[OK] Created directories: $APP_DIR, $LOG_DIR, $BACKUP_DIR"

# --- 3. UFW Firewall ---
if command -v ufw &>/dev/null; then
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp comment "SSH"
    ufw allow 80/tcp comment "HTTP (redirect to HTTPS)"
    ufw allow 443/tcp comment "HTTPS"
    # Port 8080 (WS) and 5432 (PostgreSQL) are NOT exposed — localhost only
    ufw --force enable
    echo "[OK] UFW configured: allow 22, 80, 443; deny all else"
else
    echo "[WARN] UFW not installed — run: apt install ufw"
fi

# --- 4. SSH Hardening ---
SSHD_CONFIG="/etc/ssh/sshd_config"
if [ -f "$SSHD_CONFIG" ]; then
    # Backup original
    cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%Y%m%d)"

    # Disable password auth (key-only)
    sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONFIG"
    sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' "$SSHD_CONFIG"

    # Restart SSH
    systemctl restart sshd
    echo "[OK] SSH hardened: key-only auth, root login disabled"
else
    echo "[WARN] $SSHD_CONFIG not found — SSH hardening skipped"
fi

# --- 5. .env.local permissions ---
ENV_FILE="${APP_DIR}/beat-mind-ai/.env.local"
if [ -f "$ENV_FILE" ]; then
    chmod 600 "$ENV_FILE"
    chown "${BEATMIND_USER}:${BEATMIND_USER}" "$ENV_FILE"
    echo "[OK] .env.local permissions set to 600"
else
    echo "[INFO] .env.local not found yet — set permissions after deployment"
fi

# --- 6. Install essential packages ---
echo "[INFO] Installing essential packages..."
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx postgresql-client unzip curl

# --- 7. Install Bun ---
if ! command -v bun &>/dev/null; then
    su - "$BEATMIND_USER" -c 'curl -fsSL https://bun.sh/install | bash'
    echo "[OK] Bun installed for $BEATMIND_USER"
else
    echo "[SKIP] Bun already installed"
fi

# --- 8. Install PM2 ---
if ! command -v pm2 &>/dev/null; then
    npm install -g pm2
    echo "[OK] PM2 installed globally"
else
    echo "[SKIP] PM2 already installed"
fi

# --- 9. Logrotate for PM2 logs ---
cat > /etc/logrotate.d/beatmind <<EOF
${LOG_DIR}/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
}
EOF
echo "[OK] Logrotate configured for $LOG_DIR"

echo ""
echo "=== Setup Complete ==="
echo "Next steps:"
echo "  1. Deploy code to ${APP_DIR}/beat-mind-ai/"
echo "  2. Copy .env.local and run: chmod 600 .env.local"
echo "  3. Run db-roles.sql on PostgreSQL"
echo "  4. Setup SSL: certbot --nginx -d app.beatmind.ai"
echo "  5. Copy beatmind.conf to /etc/nginx/sites-available/"
echo "  6. Start PM2: su - beatmind -c 'cd ${APP_DIR}/beat-mind-ai && pm2 start ecosystem.config.js'"
echo "  7. Setup PM2 startup: pm2 startup systemd -u beatmind --hp /home/beatmind"
echo "  8. Install cron: crontab -u beatmind infra/cron/beatmind-cron"
