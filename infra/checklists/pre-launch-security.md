# Pre-Launch Security Checklist

> Complete all items before deploying to production. Items are ordered by priority.

## P0 — Must-Do Before Launch

### Credentials
- [ ] All exposed credentials rotated (see `runbooks/credential-rotation.md`)
  - [ ] Clerk API keys (CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  - [ ] DATABASE_URL password
  - [ ] OPENAI_API_KEY
  - [ ] WS_INTERNAL_SECRET
  - [ ] TWILIO_AUTH_TOKEN
  - [ ] REPORT_TOKEN_SECRET
- [ ] `.env.local` removed from git history (see `runbooks/git-history-cleanup.md`)
- [ ] `.env.local` file permissions set to 600
- [ ] `.gitignore` contains `.env*`, `*.pem`, `*.key`

### Database
- [ ] `beatmind_app` role created (CRUD only, no DDL)
- [ ] `beatmind_migrations` role created (ALL privileges)
- [ ] `beatmind_backup` role created (SELECT only)
- [ ] `DATABASE_URL` uses `beatmind_app` with `?sslmode=require`
- [ ] `MIGRATION_DATABASE_URL` uses `beatmind_migrations` with `?sslmode=require`
- [ ] PostgreSQL `ssl = on` in postgresql.conf
- [ ] PostgreSQL port 5432 NOT exposed externally

### Server
- [ ] Non-root `beatmind` user created
- [ ] PM2 processes running as `beatmind` user (not root)
- [ ] UFW enabled: allow 22, 80, 443 only
- [ ] Port 8080 (WebSocket) NOT exposed via UFW
- [ ] SSH key-only authentication (PasswordAuthentication no)
- [ ] SSH root login disabled (PermitRootLogin no)

### TLS
- [ ] SSL certificate installed (Let's Encrypt)
- [ ] HTTP → HTTPS redirect working (301)
- [ ] TLSv1.2 and TLSv1.3 only (no TLSv1.0/1.1)
- [ ] HSTS header present with `includeSubDomains`
- [ ] Nginx config tested (`nginx -t`)

## P1 — Should-Do Before Launch

### Application Security
- [ ] All security headers present (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- [ ] Rate limiting active on all API routes
- [ ] Custom error pages (404, 500) — no stack traces in production
- [ ] CORS configured with specific origin (not `*`)
- [ ] `X-Powered-By` header removed

### Data Protection
- [ ] Tenant isolation enforced (withGymScope on all gym-scoped queries)
- [ ] Athlete data deletion working (deleteAthleteData)
- [ ] No PII in logs (verified via lib/logger.ts)
- [ ] Data retention cron job installed (archive + purge)

### Backups
- [ ] Daily backup cron job running (03:00 UTC)
- [ ] Backup retention: 30 days
- [ ] Backup restore tested at least once

### Dependencies
- [ ] `bun audit` — zero critical/high vulnerabilities
- [ ] Dependabot enabled (.github/dependabot.yml)

## P2 — Post-Launch Improvements

### Monitoring
- [ ] PM2 monitoring dashboard (pm2 plus or keymetrics)
- [ ] Error alerting (email or webhook on PM2 crash)
- [ ] SSL certificate expiry monitoring
- [ ] Disk space monitoring for backups

### Hardening
- [ ] CSP header tightened (remove unsafe-inline if possible)
- [ ] WAL archiving for point-in-time recovery
- [ ] fail2ban for SSH brute force protection
- [ ] Automated security scanning in CI pipeline

## Verification

Run the automated verification script after completing the checklist:

```bash
sudo bash infra/scripts/verify-security.sh
```

All checks should pass (PASS) with zero failures (FAIL).
