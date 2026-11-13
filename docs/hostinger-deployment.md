# Hostinger deployment preparation — Mar-Khoor

**Deployment is not yet performed.** Confirm your Hostinger plan offers **Node.js app hosting** (Node 22), a MariaDB connection from that app, HTTPS, and a recurring task scheduler. A static website upload alone cannot run this Express API or WhatsApp AI worker. Hostinger feature availability varies by plan.

## Node.js app
- Source: GitHub repository `ah4464539-creator/mar-khoor-saas`, branch `main`.
- App root: repository root.
- Node version: 22.
- Install command: `npm install --omit=dev`.
- Start command: `npm start` (starts `src/server.js`).
- Set `PORT` only if required by your hosting platform; use its assigned port where provided.
- Health check path: `/health`; DB check: `/health/database`.
- Serve via HTTPS on your chosen domain/subdomain. Do not expose MariaDB directly to the internet.

## Server-only environment variables
`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` — your MariaDB instance.
`META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_VERSION` — Meta developer app and WhatsApp Cloud API.
`OPENAI_API_KEY`, optionally `WHATSAPP_AI_MODEL` — OpenAI API project.
`VAPI_WEBHOOK_SECRET`, `VAPI_TOOL_SECRET` — only if voice features are enabled.

Never commit real credentials or paste them into a public URL, HTML, or browser JavaScript.

## First deployment
1. Configure the Node.js application and environment variables in the hosting control panel.
2. Run `npm run integrations:check` (reports missing configuration names without values).
3. Run `npm run migrate` against the intended MariaDB database **after backup/review**. Schema uses CREATE TABLE IF NOT EXISTS; it does not perform general upgrades of existing tables.
4. Start `npm start`; verify HTTPS `/health` and `/health/database`.
5. In Meta developer settings configure callback `https://YOUR_DOMAIN/integrations/webhooks/whatsapp` with the same verify token. Subscribe the app to the WhatsApp messages webhook field; configure number-to-restaurant mapping in super admin.
6. For staging, enable AI for one restaurant and send a real inbound text message. Verify incoming record, AI job, outgoing record and Meta delivery status.
7. Schedule `npm run whatsapp-ai:once` approximately every minute **only if the host supports cron/recurring Node commands**. Without a scheduler, AI jobs remain pending. Prevent concurrent runs where possible and monitor `/api/platform/whatsapp-ai/monitor`.

## Go-live blockers
- Live Meta and OpenAI provider credentials, approved phone-number configuration and actual provider send/receive test.
- Scheduler, error monitoring, backups, retention/privacy and customer consent arrangements.
- Current login sessions are held in memory and are **development-only**; replace with a durable session store before multi-instance or production launch.
- Vapi webhook stores call lifecycle events but has not been verified with a live Vapi call and has no HMAC signature check yet (see `docs/vapi-integration.md`).
- Payments are intentionally deferred.

## CI
GitHub Actions `Node checks` performs syntax checks, MariaDB schema migration and automated tests. A green result validates automated checks, **not** Hostinger compatibility or live provider connectivity.
