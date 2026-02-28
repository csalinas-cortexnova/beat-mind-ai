# BeatMind AI — Infrastructure

Scripts, configs, and runbooks for production deployment on VPS (Ubuntu 22.04+).

## Directory Structure

```
infra/
  nginx/beatmind.conf           # Nginx reverse proxy + TLS
  scripts/
    vps-setup.sh                # VPS initial setup (user, SSH, UFW, dirs)
    db-roles.sql                # PostgreSQL roles (app, migrations, backup)
    backup.sh                   # Daily pg_dump backup
    data-retention.sql          # Archive + purge old HR readings & AI messages
    deploy.sh                   # Pull, install, migrate, build, reload PM2
    verify-security.sh          # Automated post-setup security verification
  systemd/beatmind-pm2.service  # PM2 auto-start on boot
  cron/beatmind-cron            # Cron entries (backup + retention)
  runbooks/
    credential-rotation.md      # Step-by-step credential rotation
    git-history-cleanup.md      # BFG Repo-Cleaner procedure
  checklists/
    pre-launch-security.md      # Manual pre-launch verification
```

## Execution Order (First-Time Setup)

1. **VPS Setup** — `sudo bash infra/scripts/vps-setup.sh`
2. **Deploy Code** — Clone repo to `/opt/beatmind/beat-mind-ai/`
3. **Environment** — Copy `.env.local`, set `chmod 600`
4. **Database Roles** — `psql -U postgres -d beatmind -f infra/scripts/db-roles.sql`
5. **SSL Certificate** — `certbot --nginx -d app.beatmind.ai`
6. **Nginx Config** — Copy `infra/nginx/beatmind.conf` to `/etc/nginx/sites-available/`
7. **Deploy App** — `bash infra/scripts/deploy.sh`
8. **PM2 Startup** — `pm2 startup systemd -u beatmind --hp /home/beatmind`
9. **Cron Jobs** — `crontab -u beatmind infra/cron/beatmind-cron`
10. **Verify** — `sudo bash infra/scripts/verify-security.sh`

## Environment Variables Reference

| Variable | Used By | Role |
|----------|---------|------|
| `DATABASE_URL` | Next.js, WS server | `beatmind_app` (CRUD only) |
| `MIGRATION_DATABASE_URL` | `drizzle-kit migrate` | `beatmind_migrations` (ALL) |
| `BACKUP_DB_PASSWORD` | `backup.sh` | `beatmind_backup` (SELECT only) |
| `WS_PORT` | WS server | 3001 (dev), 8080 (production) |
| `WS_INTERNAL_SECRET` | Next.js ↔ WS server | Shared secret for internal HTTP |

## Subsequent Deployments

```bash
su - beatmind
cd /opt/beatmind/beat-mind-ai
bash infra/scripts/deploy.sh
```

The deploy script handles: `git pull` → `bun install` → `drizzle-kit migrate` → `bun run build` → `pm2 reload` → health check.
