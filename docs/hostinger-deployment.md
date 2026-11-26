# Hostinger deployment — Mar-Khoor

**Live** at https://mar-khoor.com on Hostinger Node.js hosting (Node 22). Hostinger is connected to GitHub `ah4464539-creator/mar-khoor-saas`, branch `main`, and **auto-deploys every push or merge to `main`**. Always work on a branch and merge through a pull request with green CI.

## Node.js app settings
- App root: repository root. Install: `npm install --omit=dev`. Start: `npm start` (`src/server.js`).
- Health checks: `/health`, `/health/database`, `/health/workers`.
- Database: MariaDB on the same server. From the app use host `127.0.0.1`, port 3306. The `srvNNNN.hstgr.io` host is only for remote connections.
- Background work runs inside the same Node process, so no cron is required:
  - WhatsApp AI worker, every ~5 s;
  - booking reminders, every 10 min;
  - custom-domain setup, every 3 min;
  - data retention, daily, only with `RETENTION_WORKER_ENABLED=1` (production only);
  - AI Caller number retry, every 15 min.

## Environment variables
The full list with purposes is in the README ("Environment variables"); placeholders are in `.env.example`. Add or change variables **one at a time** in hPanel → Node.js → Environment variables, then restart the app. Never use a bulk "replace all variables" operation: it wipes the existing ones. Check what is missing with `npm run integrations:check` (prints names only).

## After every deploy
1. If the PR added a migration: back up the database (phpMyAdmin export), then run `npm run migrate` from the hPanel terminal. Dated migrations are additive and safe to repeat; the app also creates new tables on first use.
2. Open `/health`, `/health/database` and `/health/workers`. Check the runtime logs for `"level":"error"`.
3. Bump `?v=` on changed JS/CSS in HTML only if a browser shows an old page. Static files are served with `Cache-Control: no-cache`, so a normal reload is usually enough.

## Webhook URLs to configure at providers
| Provider | URL |
| --- | --- |
| Meta WhatsApp | `https://mar-khoor.com/integrations/webhooks/whatsapp` (verify token = `WHATSAPP_VERIFY_TOKEN`) |
| Vapi | `https://mar-khoor.com/integrations/webhooks/vapi` (tools optionally `https://mar-khoor.com/integrations/vapi/tools`) |
| Stripe plans and tools | `https://mar-khoor.com/webhooks/stripe` |
| Stripe Connect order payments | `https://mar-khoor.com/webhooks/payments/stripe` |

## PR previews share production
The Hostinger PR previews (`*.hostingersite.com` links on each PR) start with the production environment variables, so they use the **production database and provider keys**. Their background workers (WhatsApp AI replies, booking reminders) can act on real customers while a preview is up. Treat previews as production: keep PRs short-lived, and give previews a separate database or turn their workers off if Hostinger lets you set preview-only variables.

## Remaining go-live items
- Real end-to-end checks with provider accounts: Meta number, Vapi call, Stripe test then live keys.
- Daily database backups on in hPanel, plus an off-site export before schema changes.
- Uptime monitor on the three health URLs and `ERROR_TRACKING_WEBHOOK_URL` for alerts.
- Rate limits and login lockout are per process. If the app ever runs more than one process, move them to the database or proxy.
- WhatsApp calling needs a media bridge (VPS); it is a pilot only.

## CI
GitHub Actions `Node checks`: syntax check, MariaDB schema + dated migrations, all tests including real-MariaDB integration tests. Green CI does not prove live provider connectivity.
