# WhatsApp AI auto-reply

AI replies are **off by default**. A restaurant admin turns on "AI auto-replies" in the dashboard (WhatsApp inbox). The signed Meta webhook (`POST /integrations/webhooks/whatsapp`) stores each inbound message once and queues one AI job per message. No AI request is made inside the webhook.

The worker (inside the Node service, every ~5 s; on/off switch in super admin) answers for every restaurant that has (1) the AI switch on, (2) its WhatsApp number linked by the platform, and (3) an active paid plan or single WhatsApp tool. `WHATSAPP_AI_WORKER_RESTAURANT_ID` (comma-separated IDs) adds pilot/demo restaurants without a plan. `npm run whatsapp-ai:once` runs one batch from a scheduler instead.

## What the AI does
- Uses only the restaurant's active menu, prices, currency and owner notes. It never invents items: an order is a `propose_order` with menu IDs, the system builds the exact summary with Confirm / Change buttons, and only after **Confirm** is a **pending** order created (prices from the database). Staff accept it on the dashboard.
- Remembers the conversation: the last 10 messages with the same customer from the last 24 hours go into the prompt.
- Replies in the customer's language. Urdu, Roman Urdu, English and Arabic are detected explicitly (`src/whatsapp-language.js`) and the reply is asked to use the same language and script; other languages are mirrored.
- Voice notes are transcribed and answered with text plus a voice note. Payment screenshots and transaction IDs are attached to the order.

## Human handoff
- The customer asks for a person ("human", "insaan se baat", "کسی انسان", "موظف", ...), or the AI is not sure and calls `talk_to_staff`. Either way the AI goes quiet for that customer for 2 hours and the owner gets a push alert.
- The keyword path answers without calling the AI ("a person from our team will reply shortly", in the customer's language).
- Dashboard → WhatsApp inbox → "Waiting for a person" → **Let AI reply again** resumes the AI for that customer.

## Consent (opt-out)
- `STOP`, `band karo`, `بند کرو`, `إيقاف`, `unsubscribe` (exact message): the customer is opted out, gets one confirmation, and receives **no automatic messages** after that. That covers AI replies, order status updates, booking reminders and templates. Staff can still answer manually from their phone.
- `START` / `shuru karo` / `ابدأ` opts back in.
- Only the exact keyword counts, so "stop the onions please" is a normal message. Stored in `whatsapp_contacts`.

## Reliability: never twice, retries, dead-letter
- **Send lock**: right before calling Meta the worker sets `whatsapp_job_state.send_started_at` once, with a conditional UPDATE. A job whose lock is already taken is never sent again automatically.
- **Retry with exponential backoff**: failures before sending (AI provider down, DB hiccup) and Meta error replies 429 / 5xx (Meta did not accept the message) are retried after 30 s, 60 s, 120 s, ... capped at 15 min. After 5 attempts the job is dead-lettered. Tune with `WHATSAPP_AI_MAX_ATTEMPTS`, `WHATSAPP_AI_RETRY_BASE_SECONDS`, `WHATSAPP_AI_RETRY_MAX_SECONDS`.
- **Dead-letter** (`whatsapp_ai_jobs.status='failed'` and `whatsapp_job_state.dead_letter=1`) when:
  - Meta rejected the message permanently (other 4xx, e.g. invalid number or re-engagement required);
  - the send outcome is unknown (timeout, network error, missing message id);
  - Meta accepted the message but saving it failed;
  - or attempts ran out.
  Dead-lettered jobs are never retried automatically: check outbound history, then reply manually if needed.
- **Crash recovery**: jobs stuck in `processing` for 10+ minutes are requeued if the send lock was never taken (Meta was never called). Otherwise they are dead-lettered.
- Jobs only run while the customer's message is under 23 hours old (Meta's 24-hour window, with a buffer).

## Templates outside the 24-hour window
- `POST /api/restaurants/:id/whatsapp/templates/send` (restaurant admin) with `{ "customer": "923001234567", "template": { "name": "order_status_update", "language": "en", "params": ["#12", "ready"] } }` sends an **approved** template. Only to customers who messaged this restaurant before, never to opted-out customers. Audited.
- Order status updates use a free-form message inside the window and `WHATSAPP_ORDER_STATUS_TEMPLATE` (body `{{1}}` order number, `{{2}}` status; language `WHATSAPP_ORDER_STATUS_TEMPLATE_LANG`) outside it.
- Booking reminders use `WHATSAPP_REMINDER_TEMPLATE` (`{{1}}` name, `{{2}}` business, `{{3}}` date and time).
- Templates must be created and approved in Meta WhatsApp Manager first. Without one, out-of-window messages are skipped and logged, never faked.

## Usage
Every AI reply sent adds 1 to the plan's `whatsapp_messages` usage for the month.

## Monitoring
`GET /api/platform/whatsapp-ai/monitor` (super admin) returns:
- job counts by state, stale processing jobs, delayed pending jobs, and outbound delivery states for the last 24 h;
- `dead_letter`, `waiting_retry` and `opted_out_contacts`.

No message text is included. Each batch logs a JSON line with `claimed`, `sent`, `failed`, `retried` and `duration_ms`. Alert on a growing `dead_letter` count.

## Database
`db/migrations/2026-11-26-whatsapp-reliability.sql`: two new tables (`whatsapp_job_state`, `whatsapp_contacts`). Additive only. Applied by `npm run migrate` and created by the app on first use.

## Setup checklist
1. Server env: `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `OPENAI_API_KEY`, `DB_*`, optionally `WHATSAPP_AI_MODEL` and the template names above.
2. Meta app → WhatsApp → Configuration: callback `https://mar-khoor.com/integrations/webhooks/whatsapp`, same verify token, subscribe to the `messages` field.
3. Super admin → WhatsApp numbers: link the Meta phone number ID to the restaurant.
4. Restaurant → WhatsApp inbox → turn on AI auto-replies, then send a real test message. Check the reply, `whatsapp_ai_jobs`, outbound history and delivery status.
5. Send `STOP`, check the confirmation and silence; send `START`.

Meta's 24-hour window, template and business policies always apply. Check costs and privacy before enabling for many restaurants.
