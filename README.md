# Mar-Khoor SaaS

Multi-business AI SaaS for restaurants, clinics, salons and hotels: AI website, WhatsApp AI, AI phone calls (Vapi), online ordering and bookings, plans and billing.

- **Live:** https://mar-khoor.com, hosted on Hostinger Node.js. **Every push or merge to `main` auto-deploys.** Work on branches and merge through pull requests.
- **Stack:** Node.js 22 + Express (entry `src/server.js`), MariaDB (`mysql2`), plain HTML/JS front end in `public/`. No build step.
- **Roles:**
  - super admin (`/super-admin`): tenants, plans, numbers, revenue, monitoring;
  - restaurant admin and staff (`/restaurant.html`);
  - customers: website `/r/<slug>`, menu `/menu.html?r=<slug>`, booking `/book.html?b=<slug>`, WhatsApp, phone.

> This README describes `main` after the November 2026 workstream PRs (Vapi calling, WhatsApp reliability, payments, production readiness) are merged.

## Current status
| Area | Status |
| --- | --- |
| Restaurant workspace: menu, live orders, order tracking, push alerts, owner PWA, staff accounts | Live |
| AI website builder (templates, blog/pages, custom domains, AI chat + voice on the site) | Live |
| Bookings for clinics, salons, hotels and restaurant tables (web, WhatsApp, calls) | Live; owner end-to-end test pending |
| **WhatsApp AI**: menu-only orders with Confirm button, conversation context, voice notes, handoff to staff, Urdu / Roman Urdu / English / Arabic | Live |
| WhatsApp reliability: send lock (never twice), retries with backoff, dead-letter, STOP / band karo opt-out, templates outside 24 h | Built and tested on MariaDB; verify with a real number |
| **AI calls (Vapi)**: webhook (lifecycle, transcripts, tool calls, transfer to reception), menu / order / booking tools, call history page, call-minute metering | Built and tested; **verify with a real Vapi call** |
| Plans (Starter / Premium / Enterprise + single tools) with Stripe subscriptions | Live (test mode until live keys are set) |
| Usage limits per tenant (AI chats, WhatsApp AI replies, call minutes) | Enforced: AI pauses at limit + 10 % (`USAGE_LIMIT_MODE=soft` to disable) |
| Customer card payments for orders (Stripe Connect, restaurant's own account) and refunds | Built and tested; needs Stripe Connect enabled + webhook |
| Super-admin revenue (MRR, invoices, card payments) | Built |
| Logging, error alerts, `/health`, `/health/database`, `/health/workers`, rate limits, security headers, data retention, privacy page | Built |
| WhatsApp calling (SIP) | Pilot; needs a media bridge (VPS) |
| JazzCash / Easypaisa online gateways | Not built; plug in through `src/payments/provider.js` |

## Run locally
```bash
npm install
cp .env.example .env        # fill DB_* at least
npm run migrate             # db/schema.sql + dated migrations in db/migrations
npm run dev                 # http://localhost:3001/health
npm test                    # unit + HTTP tests
```
Database integration tests (real MariaDB, as CI does): set `DB_INTEGRATION_TEST=1` and `DB_*`, run `npm run migrate`, then `npm test`.

## Database and migrations
- `db/schema.sql`: base schema (`CREATE TABLE IF NOT EXISTS`).
- `db/migrations/YYYY-MM-DD-*.sql`: **dated, additive, re-runnable** migrations, applied in order by `npm run migrate`. A test enforces "additive only". Never edit an old migration; add a new dated file.
- Older undated files in `db/migrations/` were one-off manual migrations. They are never run automatically.
- Feature modules also create their own new tables on first use, because Hostinger deploys do not run migrations. Running `npm run migrate` after a deploy is still recommended.

## Code map
| Area | Files |
| --- | --- |
| Server, security, observability | `src/server.js`, `src/security.js`, `src/observability.js`, `src/retention.js`, `src/privacy.js` |
| Auth, registration, sessions | `src/auth.js`, `src/registration*.js`, `src/sessions.js`, `src/password-reset.js` |
| Orders, menu, payments | `src/checkout.js`, `src/operations.js`, `src/payment-options.js`, `src/payments/*` |
| Plans, billing, usage | `src/subscriptions.js`, `src/tools.js`, `src/billing.js`, `src/stripe-billing.js`, `src/usage-limits.js` |
| WhatsApp | webhook `src/integrations.js`; worker `src/whatsapp-ai-worker.js`; `src/whatsapp-orders.js`, `src/whatsapp-reliability.js`, `src/whatsapp-language.js`, `src/whatsapp-templates.js` |
| AI calls (Vapi) | `src/vapi-events.js`, `src/vapi-tool-runner.js`, `src/vapi-call-log.js`, `src/vapi-transfer.js`, `src/voice-tools.js`, `src/voice-bookings.js`, `src/voice-autoprovision.js` |
| Bookings | `src/bookings*.js`, `src/booking-*.js` |
| Websites | `src/sites.js`, `src/site-*.js`, `src/widget*.js`, `src/domains.js` |

Detailed docs: [`docs/`](docs/). Start with `docs/HANDOVER.md`, `docs/whatsapp-ai-staging.md`, `docs/vapi-integration.md`, `docs/payments.md`, `docs/operations.md`, `docs/hostinger-deployment.md`.

## Webhook URLs (production)
| Provider | URL | Secret / setting |
| --- | --- | --- |
| Meta WhatsApp (callback + verify) | `https://mar-khoor.com/integrations/webhooks/whatsapp` | verify token `WHATSAPP_VERIFY_TOKEN`; signature `META_APP_SECRET`; subscribe to `messages` (and `calls` for the calling pilot) |
| Vapi server URL (all server messages and tools) | `https://mar-khoor.com/integrations/webhooks/vapi` | Bearer `VAPI_WEBHOOK_SECRET` (or HMAC `VAPI_WEBHOOK_HMAC_SECRET`) |
| Vapi function tools (optional separate URL) | `https://mar-khoor.com/integrations/vapi/tools` | header `x-markhoor-tool-secret: VAPI_TOOL_SECRET` |
| Stripe, plans and tools (your account) | `https://mar-khoor.com/webhooks/stripe` | `STRIPE_WEBHOOK_SECRET` |
| Stripe Connect, customer order payments (connected accounts) | `https://mar-khoor.com/webhooks/payments/stripe` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

## Environment variables
Set them in hPanel → Websites → mar-khoor.com → Node.js → Environment variables. Never commit real values; `.env.example` has placeholders. `npm run integrations:check` lists missing names without printing values.

**Core**
| Name | Purpose |
| --- | --- |
| `PORT` | Port (Hostinger sets it) |
| `DB_HOST` (`127.0.0.1`), `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MariaDB |
| `PUBLIC_BASE_URL` | `https://mar-khoor.com` (links in emails and payments) |
| `TRUST_PROXY` | Proxy hops (default 1) |
| `DATA_ENCRYPTION_KEY` | Encrypts stored provider tokens (WhatsApp Embedded Signup) |
| `PRIMARY_HOSTS`, `PROTECTED_RESTAURANT_SLUGS`, `SUPER_ADMIN_OWNER_EMAIL` | Platform hosts / protected demo data / owner account |

**Observability and data**
| Name | Purpose |
| --- | --- |
| `ERROR_TRACKING_WEBHOOK_URL` | HTTPS webhook (Slack / Discord / collector) for error alerts |
| `APP_RELEASE`, `LOG_LEVEL` (`info`), `SLOW_REQUEST_MS` (3000) | Release tag in logs and alerts; log level; slow-request threshold |
| `MESSAGE_RETENTION_DAYS` (90), `TRANSCRIPT_RETENTION_DAYS` (30), `AUDIT_RETENTION_DAYS` (365) | Retention periods (see the privacy page) |
| `RETENTION_WORKER_ENABLED` | `1` = run the daily clean-up in the app. Set on **production only**: PR previews share the production database |

**WhatsApp (Meta Cloud API)**
| Name | Purpose |
| --- | --- |
| `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_VERSION` (`v23.0`), `WHATSAPP_WABA_ID` | Webhook and sending |
| `WHATSAPP_AI_MODEL`, `WHATSAPP_TRANSCRIBE_MODEL`, `WHATSAPP_TTS_MODEL`, `WHATSAPP_TTS_VOICE` | AI reply, voice-note transcription and voice replies |
| `WHATSAPP_AI_WORKER_RESTAURANT_ID` | Pilot restaurants without a plan (comma-separated) |
| `WHATSAPP_AI_MAX_ATTEMPTS` (5), `WHATSAPP_AI_RETRY_BASE_SECONDS` (30), `WHATSAPP_AI_RETRY_MAX_SECONDS` (900) | Retries |
| `WHATSAPP_ORDER_STATUS_TEMPLATE` / `_LANG`, `WHATSAPP_REMINDER_TEMPLATE`, `WHATSAPP_REMINDER_LANG` | Approved templates outside the 24 h window |
| `WHATSAPP_SIP_FAIL_CLOSED_ENABLED` | WhatsApp calling pilot routing |

**AI (OpenAI)**
| Name | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required for every AI feature |
| `OPENAI_ASSISTANT_MODEL`, `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`, `SITE_AI_MODEL`, `MENU_IMPORT_MODEL`, `I18N_MODEL` | Optional model overrides |
| `RESTAURANT_WEBSITE_ASSISTANT_ENABLED`, `RESTAURANT_WEBSITE_VOICE_ENABLED`, `WEBSITE_AI_ASSISTANT_PAUSED`, `REGISTRATION_WEBSITE_ASSISTANT_ENABLED`, `SITE_PUBLISH_FREE` | Feature switches |
| `WEBSITE_VOICE_MAX_MINUTES`, `WEBSITE_VOICE_FREE_MINUTES`, `WEBSITE_VOICE_PLAN_MINUTES_JSON` | Website voice limits |

**AI calls (Vapi, Telnyx)**
| Name | Purpose |
| --- | --- |
| `VAPI_WEBHOOK_SECRET` or `VAPI_WEBHOOK_HMAC_SECRET` (+ `VAPI_HMAC_SIGNATURE_HEADER`, `VAPI_HMAC_TIMESTAMP_HEADER`) | Webhook auth |
| `VAPI_TOOL_SECRET` | Tool URL auth |
| `VAPI_API_KEY`, `VAPI_TEMPLATE_ASSISTANT_ID`, `VAPI_TELNYX_CREDENTIAL_ID`, `VAPI_VOICE_JSON` | Assistant sync and auto-provisioning |
| `TELNYX_API_KEY`, `TELNYX_MAX_MONTHLY_USD`, `TELNYX_MAX_UPFRONT_USD`, `VOICE_AUTOPROVISION_ENABLED`, `REGISTRATION_VOICE_POOL_ENABLED` | Automatic phone numbers (spends money) |

**Plans, payments, limits (Stripe)**
| Name | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` (`sk_test_...` first), `STRIPE_WEBHOOK_SECRET`, `STRIPE_BILLING_ENABLED` | Plan and tool subscriptions |
| `STRIPE_CONNECT_WEBHOOK_SECRET`, `PAYMENTS_PLATFORM_FEE_BPS` (0), `ORDER_PAYMENTS_ENABLED` | Customer card payments (Connect) |
| `SUBSCRIPTION_PRICES_JSON`, `SUBSCRIPTION_LIMITS_JSON`, `SUBSCRIPTION_FX_JSON`, `PLAN_CATALOG_JSON`, `TOOL_NUMBER_COSTS_JSON` | Price and limit overrides |
| `USAGE_LIMIT_MODE` (`hard` / `soft`), `USAGE_LIMIT_GRACE_PERCENT` (10) | Usage limit enforcement |

**Email and Hostinger**
| Name | Purpose |
| --- | --- |
| `MAIL_FROM` + `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (or `RESEND_API_KEY`) | Password reset and contact emails |
| `HOSTINGER_API_TOKEN`, `HOSTINGER_USERNAME`, `HOSTINGER_WEBSITE_DOMAIN`, `HOSTINGER_SERVER_IP`, `HOSTINGER_MAIL_API_TOKEN`, `HOSTINGER_MAILBOX_RESOURCE_ID` | Custom-domain automation and mail |

## Deploy checklist
1. **Branch → PR → green CI → merge.** Merging to `main` deploys automatically. Never push to `main` directly.
2. Before a schema change: export the database (phpMyAdmin) and keep a copy off Hostinger.
3. After the deploy:
   - run `npm run migrate` from the hPanel terminal (safe to repeat);
   - check `https://mar-khoor.com/health`, `/health/database` and `/health/workers`.
4. New env variables: add them **one by one** in hPanel (never use a tool that replaces the whole list), then restart the app.
5. Check hPanel → Node.js → runtime logs for `"level":"error"` lines, and Super admin → Integration health → Background workers.
6. Smoke test:
   - website order (cash);
   - WhatsApp: message the number, get a reply, send `STOP` → silence, send `START`;
   - a call to the AI number appears under AI calls;
   - Stripe test payment if card payments are on.
7. Monitoring: uptime monitor on `/health`, `/health/database` and `/health/workers`; set `ERROR_TRACKING_WEBHOOK_URL` for alerts.

## Rules
- No secrets in the repo, in logs, or in browser JavaScript. Database changes are additive only. Tenant identity always comes from server-side mappings, never from payloads or AI output.
- Add tests for everything; `npm test` must pass before a PR.
