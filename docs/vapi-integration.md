# Vapi integration (AI Caller)

`POST /integrations/webhooks/vapi` receives Vapi **server messages**. Tool calls can also go to the
dedicated URL `POST /integrations/vapi/tools` (secret `VAPI_TOOL_SECRET`); both answer the same tools.
Implemented and covered by automated tests; **not yet verified against a live Vapi call** (see "Still pending").

## Authentication
One of two ways, set on the server:
1. Shared secret `VAPI_WEBHOOK_SECRET`, accepted as `Authorization: Bearer <secret>`, `X-Vapi-Secret`, or `x-markhoor-webhook-secret`. In Vapi create a **Bearer Token** custom credential (Integrations → Server Configuration) and attach it to the assistant's server URL.
2. HMAC: `VAPI_WEBHOOK_HMAC_SECRET` = the secret key of a Vapi **HMAC** credential (SHA256, hex, payload `{timestamp}.{body}`). Timestamps older than 5 minutes are rejected. Header names default to `x-signature` / `x-timestamp`; override with `VAPI_HMAC_SIGNATURE_HEADER` / `VAPI_HMAC_TIMESTAMP_HEADER`.

Requests without a valid secret get `401` and nothing is read or stored.

## Messages handled
| Vapi message | What happens |
| --- | --- |
| `status-update` | Call row in `voice_calls` (`in-progress` = call started, `ended`, ...). An ended call never moves back. |
| `end-of-call-report` | Ended reason and full transcript in `voice_calls`; caller number, duration, summary and recording link in `voice_call_details`; call minutes added to the plan usage (`ai_call_minutes`) **once per call**, rounded up per started minute. Owner gets a push alert. |
| `transcript` (final only) | Each final line (caller / AI) in `voice_call_transcript_lines`. Partial transcripts are ignored. |
| `tool-calls` | Runs the tools below and answers `{ results: [...] }`. |
| `transfer-destination-request` | Answers with the restaurant's reception phone (`{ destination: { type: 'number', number } }`), or an error telling the AI to take a callback. |
| anything else | `202 {"received":true,"processed":false}`; nothing stored. |

The restaurant is always resolved from the server-side `voice_assistants` mapping (or the validated WhatsApp SIP route), **never** from IDs in the payload or the model's tool arguments. Replays are safe.

## Tools
| Tool | Purpose |
| --- | --- |
| `get_menu` | Active menu items of the mapped restaurant. |
| `place_order` (alias `create_order`) | Creates an order with status `pending` from menu item IDs only (prices from the database, one order per call). Staff confirm it on the dashboard. Needs `confirmed: true`. |
| `get_business_info`, `check_availability`, `book_appointment` (alias `create_table_booking`), `my_bookings`, `cancel_booking`, `reschedule_booking` | Table / appointment / room bookings when the business has bookings switched on. |
| `transferCall` (Vapi built-in) | Added to the assistant automatically when the owner saves a reception phone (Dashboard → AI receptionist), for restaurants with or without bookings. |

## Dashboard
Restaurant admins see **AI calls** in the sidebar: caller, time, duration, order created, transfer, summary, recording and transcript.
API: `GET /api/restaurants/:id/voice-calls` (paged with `before`), `GET /api/restaurants/:id/voice-calls/:callRowId`.

## Vapi assistant settings
- Server URL: `https://mar-khoor.com/integrations/webhooks/vapi` with the credential above.
- Server messages: `status-update`, `end-of-call-report`, `tool-calls`, `transfer-destination-request`, and `transcript` if you want live transcript lines.
- Function tools (`get_menu`, `place_order`, ...): server URL either the same webhook, or `https://mar-khoor.com/integrations/vapi/tools` with header `x-markhoor-tool-secret: <VAPI_TOOL_SECRET>`.

## Database
Migration `db/migrations/2026-11-26-vapi-call-log.sql` (two new tables, additive). `npm run migrate` applies it; the app also creates the tables on first use.

## Still pending
- A real sandbox call to confirm payload fields (`call.id`, `call.assistantId`, `durationSeconds`, `analysis.summary`, `artifact.recordingUrl`) match what Vapi sends today; then add redacted real payloads as test fixtures.
- The HMAC path is unit-tested only. If a live call gets 401, switch the Vapi credential to Bearer and compare headers.
- Transcripts and recordings contain customer speech: `npm run purge-old-data` clears transcripts after `TRANSCRIPT_RETENTION_DAYS`.
