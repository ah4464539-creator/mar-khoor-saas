# Operations: security, monitoring, backups

## What is built in
- **Sessions** live in the `sessions` table (only a SHA-256 hash of the token is stored). Restarting the app no longer logs anyone out. Roles are re-read from `users` on every request.
- **Rate limits** (per visitor IP, in memory, one Node process): login 30 per 15 min (plus the per-account lockout), public API 120 per min, public order placement 20 per 10 min, whole API 1500 per 10 min, registration 5 per hour. Limits reset when the app restarts.
- **Proxy trust:** Hostinger runs the app behind a proxy, so the app trusts one proxy hop by default (`TRUST_PROXY=1`). Without this every visitor would share one IP and one rate limit. Set `TRUST_PROXY=false` only if the app is reached directly.
- **Security headers** on every response (nosniff, frame deny, referrer policy, permissions policy, HSTS on HTTPS). A strict Content-Security-Policy is applied to generated restaurant sites (`/r/<name>`) only; the older static pages use inline scripts and are not covered by a CSP yet.
- **Audit log** (`audit_logs`): restaurant registration, plan order create/cancel/status change, number route changes, voice assistant and WhatsApp number mapping. Writing the log never blocks the action.
- **Errors:** invalid JSON returns 400, oversized bodies 413, everything else 500 without details. Server errors and throttling are logged as one JSON line each, never with bodies or headers.

## Not built (do these yourself)
- **Backups.** In hPanel open Websites > Backups and confirm daily backups are on for the files and the database. Also take a manual export of `u927386692_markhoorsaas1` from phpMyAdmin before every schema change or big release, and keep a copy off Hostinger. Test a restore into a spare database at least once.
- **Uptime monitoring.** Create a free monitor (for example UptimeRobot) on `https://mar-khoor.com/health` and one on `https://mar-khoor.com/health/database`, alert by email. A failing `/health/database` means the database credentials or the database itself is down.
- **Retention.** Voice transcripts contain customer speech. Add a daily hPanel cron job running `npm run purge-old-data`. It blanks transcripts older than `TRANSCRIPT_RETENTION_DAYS` (default 30), deletes expired sessions and deletes audit rows older than `AUDIT_RETENTION_DAYS` (default 365). Publish a privacy notice that states the real period.
- **Secrets.** Rotate the Vapi, Meta, OpenAI and database secrets if they were ever pasted into chat or screenshots.
- **Scaling limit.** Rate limits and the login lockout are per process. If you ever run more than one Node process, move them to the database or the proxy.
