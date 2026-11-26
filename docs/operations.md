# Operations: security, monitoring, backups

## What is built in
- **Sessions** live in the `sessions` table (only a SHA-256 hash of the token is stored). Restarting the app no longer logs anyone out. Roles are re-read from `users` on every request.
- **Rate limits** (per visitor IP, in memory, one Node process): login 30 per 15 min (plus the per-account lockout), public API 120 per min, public order placement 20 per 10 min, whole API 1500 per 10 min, registration 5 per hour. Limits reset when the app restarts.
- **Proxy trust:** Hostinger runs the app behind a proxy, so the app trusts one proxy hop by default (`TRUST_PROXY=1`). Without this every visitor would share one IP and one rate limit. Set `TRUST_PROXY=false` only if the app is reached directly.
- **Security headers** on every response (nosniff, frame deny, referrer policy, permissions policy, HSTS on HTTPS). A strict Content-Security-Policy is applied to generated restaurant sites (`/r/<name>`) only; the older static pages use inline scripts and are not covered by a CSP yet.
- **Audit log** (`audit_logs`): restaurant registration, plan order create/cancel/status change, number route changes, voice assistant and WhatsApp number mapping. Writing the log never blocks the action.
- **Errors:** invalid JSON returns 400, oversized bodies 413, everything else 500 without details. Server errors and throttling are logged as one JSON line each, never with bodies or headers.
- **Structured logs** (`src/observability.js`): JSON lines `{"level","event","time",...}` with a `request_id`. Every response carries `X-Request-Id`. Keys that look like secrets are redacted; phone and card numbers are masked. 5xx responses and requests slower than `SLOW_REQUEST_MS` (3000) are logged.
- **Error alerts:** set `ERROR_TRACKING_WEBHOOK_URL` (HTTPS; a Slack or Discord incoming webhook, or any JSON collector). These are posted, throttled (same error once a minute, max 20 a minute):
  - 5xx responses;
  - unhandled rejections and uncaught exceptions;
  - failing background workers.
- **Health:**
  - `/health`: process up, release, uptime.
  - `/health/database`: database reachable.
  - `/health/workers`: background workers (WhatsApp AI, booking reminders, domains, retention). Returns `503` when one is failing or has missed 3 runs. Also shown in Super admin → Integration health → Background workers.
  - `/api/platform/whatsapp-ai/monitor`: job queue, dead-letter and retry counts.
- **More limits:** every dynamic route has a per-IP baseline of 600 requests a minute; provider webhooks have a ceiling of 1,200 a minute.
- **JSON guard:** bodies with `__proto__` / `constructor` / `prototype` keys, or nested deeper than 20 levels, are rejected with 400.
- **More headers:** `Content-Security-Policy: object-src 'none'; base-uri 'self'` on every page (generated sites keep their strict CSP), `X-Permitted-Cross-Domain-Policies: none`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`.
- **Retention (built in, opt-in):** with `RETENTION_WORKER_ENABLED=1` (set it on production only; Hostinger PR previews share the production database), a daily job inside the Node service (first run 10 minutes after start) clears:
  - WhatsApp message text older than `MESSAGE_RETENTION_DAYS` (90);
  - call transcripts, transcript lines, summaries and recording links older than `TRANSCRIPT_RETENTION_DAYS` (30);
  - expired sessions and reset links;
  - audit rows older than `AUDIT_RETENTION_DAYS` (365).
  Restaurants can choose 7–365 days in Dashboard → AI receptionist → Privacy. Rows stay; only the personal text goes. `npm run purge-old-data` runs the same job on demand. The public privacy page (`/privacy.html`) states these periods.

## Not built (do these yourself)
- **Backups.** In hPanel open Websites > Backups and confirm daily backups are on for the files and the database. Also take a manual export of `u927386692_markhoorsaas1` from phpMyAdmin before every schema change or big release, and keep a copy off Hostinger. Test a restore into a spare database at least once.
- **Uptime monitoring.** Create a free monitor (for example UptimeRobot) on `https://mar-khoor.com/health`, `https://mar-khoor.com/health/database` and `https://mar-khoor.com/health/workers`, alert by email. A failing `/health/database` means the database credentials or the database itself is down.
- **Alerts.** Create a Slack or Discord incoming webhook (or similar) and set `ERROR_TRACKING_WEBHOOK_URL`. Add `/health/workers` to the uptime monitor.
- **Secrets.** Rotate the Vapi, Meta, OpenAI and database secrets if they were ever pasted into chat or screenshots.
- **Scaling limit.** Rate limits and the login lockout are per process. If you ever run more than one Node process, move them to the database or the proxy.
