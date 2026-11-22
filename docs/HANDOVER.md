# Mar-Khoor — handover for the next work session

Give this file to any new Claude session (or developer) so work can continue without re-explaining.
Last updated: 2026-11-22 (after PR #130).

## 1. What the project is
- Multi-business SaaS: restaurants (orders), clinics / salons (appointments), hotels (rooms).
- Repo: `ah4464539-creator/mar-khoor-saas` (branch `main`).
- Live: https://mar-khoor.com — Hostinger Node.js (Express), entry `src/server.js`, MariaDB.
- Owner dashboard `public/restaurant.html` (+ `restaurant.js`, `bookings.js`, `owner.css`).
- Super admin: `/super-admin` (`src/views/super-admin.html`, `public/platform.js`).
- Public pages: `index.html` (landing), `register.html`, `book.html?b=<slug>` (online booking), `/r/<slug>` (AI website).

## 2. Safety rules (must keep)
1. Keep existing features and data working. **Database: additive only** — new tables with `CREATE TABLE IF NOT EXISTS`; never `ALTER`, `DROP`, `TRUNCATE` or delete production data.
2. Never print or commit secrets. Never ask the owner for tokens.
3. Never call `hosting_nodejs_replace-environment-variables` (it wipes every env var).
4. Ask the owner (yes/no) before any deletion, purchase (e.g. VPS), or creating test accounts on production. Restaurant #4 "Urban Cafe" is the owner's real business — protect it.
5. Talk to the owner in Roman Urdu, short and clear.

## 3. Workflow after every change
1. Branch from `main`, make the change, add/update tests in `tests/`.
2. Local tests: `node --test tests/*.test.js` (locally ~25 tests fail only because `express` is not installed; CI has it).
   For local runs link the stub: `ln -sfn /tmp/stubs/node_modules/mysql2 node_modules/mysql2`, then `rm -f node_modules/mysql2`.
3. Commit, push, open PR with `gh api repos/ah4464539-creator/mar-khoor-saas/pulls -f title=... -f head=<branch> -f base=main -f body=...`.
4. Wait for GitHub Actions (check-runs on the branch) → must be `success`.
5. Squash merge: `gh api -X PUT repos/.../pulls/<n>/merge -f merge_method=squash`.
6. Deploy with Hostinger MCP `hosting_deploy` `{domain:"mar-khoor.com", git:{repository:"ah4464539-creator/mar-khoor-saas", branch:"main"}, type:"nodejs"}`,
   then `hosting_get-deployment` with the buildUuid until `completed`.
7. Check `hosting_nodejs_runtime-logs` `{domain:"mar-khoor.com", username:"u927386692", period:"1h"}` and the live page (bump `?v=` on changed JS/CSS in the HTML).
8. Report to the owner in Roman Urdu (what changed, what is verified, what is not).

## 4. Built and live
- Restaurant: menu, live orders (compact 3-line cards), payment methods page, order tracking, push alerts, owner PWA app.
- WhatsApp AI: orders with Confirm/Change buttons, voice notes, payments (JazzCash/Easypaisa/Raast/bank with transaction ID or screenshot), number activation with code.
- AI website builder (11 templates, sections, blog & pages, live website button).
- Plans & billing (Stripe): complete plans or single tools; new owners land on Plans & billing; after payment a "Connect your tools" card.
- **Business types + bookings** (PR #121–#123):
  - Registration asks the type (restaurant, clinic, hotel, salon); stored in `business_profiles`.
  - Dashboard menu changes by type (Appointments / Reservations / Table bookings; Doctors & services, Rooms & rates, Services & staff).
  - Booking core `src/bookings.js` (slots, rooms, re-checked on the server); routes `src/bookings-routes.js`; public page `book.html`.
  - WhatsApp booking assistant `src/booking-assistant.js` (check_availability → propose_booking → mk_bconfirm/mk_bchange buttons).
  - AI calls `src/voice-bookings.js` (get_business_info, check_availability, book_appointment) — added to a business's Vapi assistant when bookings are on or the assistant is created; per-type rule between `[[MK-BUSINESS]]` markers.

- **Booking batches A–C** (PR #128–#130):
  - Doctor/staff own schedules, specialties/categories, reschedule, Arrived/Check-in, week calendar, search/filter, CSV export, audit history, Patients/Clients/Guests list, delete (archives if used).
  - WhatsApp reminders (`src/booking-reminders.js`; needs `WHATSAPP_REMINDER_TEMPLATE` for customers outside the 24h window).
  - Hotel rooms per room type, Housekeeping page, room status on check-in/out.
  - Booking payments/refunds, advance payment + customer transaction ID (`src/booking-extras.js`).
  - AI self-service: my_bookings / cancel_booking / reschedule_booking on WhatsApp and calls; WhatsApp `talk_to_staff` hand-over; call transfer to the reception phone.
  - Booking-aware AI websites, discount codes, Reports page, staff accounts (role `staff`, front-desk only).

## 5. Not finished / waiting
- **Owner tests needed:** WhatsApp booking and call booking end to end (suggested: Urban Cafe → Tables & hours → enable bookings → add "Table for 2" → book on WhatsApp). Note: saving services adds booking tools to Urban Cafe's Vapi assistant (order flow unchanged).
- Landing page, setup dialog and login now speak to every business type (PR #124).
- Reminders outside the 24h window need an approved Meta template; set `WHATSAPP_REMINDER_TEMPLATE` (body params: name, business, date-time) — never via the replace-env tool; ask the owner to add it in hPanel.
- Not built yet: online card payments for bookings (Stripe for customers), restaurant deals and tables pages beyond table bookings, separate templates per business type in the website builder (sections adapt, designs are shared), a full end-to-end test on a test account for each of the four types (needs the owner's OK to create test accounts on production).
- WhatsApp calling: needs a VPS media bridge (Opus/SDES). Waiting for the owner's yes and monthly vs. yearly choice (KVM1 ~$9.99 first month, then $19.49/month). Calling pilot is still ON for Urban Cafe and failing.
- New plan prices (Starter $299 / Premium $599 / Unlimited $1,299) — awaiting approval.
- Embedded Signup for WhatsApp needs NTN, Meta business verification and Tech Provider status.

## 6. Useful places in the code
| Area | Files |
| --- | --- |
| Server, routes | `src/server.js`, `src/api.js`, `src/operations.js` |
| Registration | `src/registration.js`, `src/registration-core.js`, `public/register.*` |
| Bookings | `src/bookings.js`, `src/bookings-routes.js`, `public/bookings.js`, `public/book.*` |
| WhatsApp AI | `src/whatsapp-ai-worker.js`, `src/whatsapp-orders.js`, `src/booking-assistant.js`, webhook `src/integrations.js` |
| AI calls (Vapi) | `src/vapi-adapter.js`, `src/voice-tools.js`, `src/voice-bookings.js`, `src/voice-autoprovision.js` |
| Billing | `src/billing.js`, `src/stripe-billing.js` |
| Push / app | `src/web-push.js`, `public/sw.js`, `public/owner-app.js` |

## 7. Prompt to start a new session
> "Read docs/HANDOVER.md in ah4464539-creator/mar-khoor-saas and continue. Follow its safety rules and workflow. Next task: <write task here>. Reply to me in Roman Urdu."
