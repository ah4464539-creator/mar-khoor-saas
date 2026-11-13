# Vapi integration status

The server exposes `POST /integrations/webhooks/vapi` for Vapi **server messages**. Call lifecycle tracking is implemented; it has **not yet been verified against a live Vapi call**.

## What it does
- Authenticates in one of two ways. (1) Shared secret: `VAPI_WEBHOOK_SECRET`, accepted as `Authorization: Bearer <secret>`, `X-Vapi-Secret`, or `x-markhoor-webhook-secret`. Create a matching **Bearer Token** custom credential in Vapi (Integrations > Server Configuration) and attach it to the assistant's server URL. (2) HMAC: set `VAPI_WEBHOOK_HMAC_SECRET` to the secret key of a Vapi **HMAC** credential (SHA256, hex, payload format `{timestamp}.{body}`). The server checks `HMAC-SHA256(secret, timestamp + "." + rawBody)` and rejects timestamps more than 5 minutes old. Defaults are the headers `x-signature` and `x-timestamp`; override with `VAPI_HMAC_SIGNATURE_HEADER` and `VAPI_HMAC_TIMESTAMP_HEADER` if the Vapi credential uses other names. Use one credential type per server URL.
- Stores `status-update` and `end-of-call-report` messages in `voice_calls` (status, ended reason, transcript, timestamps). The restaurant is resolved from the `voice_assistants` mapping, never from the payload.
- Idempotent: replays are safe, and a call that has `ended` never moves back to an earlier status.
- Every other message type is acknowledged with `{"received":true,"processed":false}` and ignored. Orders are created only by the tool adapter (`/integrations/vapi/tools`), never by this webhook.
- Restaurant admins can read calls at `GET /api/restaurants/:id/voice-calls` (paged with `before`) and `GET /api/restaurants/:id/voice-calls/:callRowId` (includes transcript).

## Still pending
- The HMAC check is implemented and unit-tested, but has not been tried against real Vapi traffic (for example, the timestamp must be numeric). If a live call is rejected with 401, switch the Vapi credential to Bearer first and compare the real headers.
- Transcripts contain customer speech: decide a retention period and privacy notice before production.
- A real sandbox call to confirm the payload fields (`call.id`, `call.assistantId`, `artifact.transcript`) match what Vapi actually sends.
- Add fixtures from real redacted payloads to the tests.

No real calls, messages or provider API requests have been made in this phase.
