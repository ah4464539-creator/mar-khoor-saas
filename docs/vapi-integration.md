# Vapi integration status

The server currently exposes `POST /integrations/webhooks/vapi`. It is **not yet a live Vapi integration**.

- The current stub expects a custom `x-markhoor-webhook-secret` header and a configured `VAPI_WEBHOOK_SECRET`.
- It returns HTTP 202 with `processed:false` and deliberately does not create orders.
- Before production: confirm Vapi's current server URL/event payload and official request-authentication mechanism, then replace this stub with signature verification and an idempotent event processor.
- Map each Vapi assistant/phone number to a specific restaurant ID, never trust a tenant ID supplied by the caller.
- Implement tool endpoints for menu lookup, availability and confirmed checkout; reuse the same transactional order service as the website.
- Keep provider credentials server-side, record event IDs and failures, and add integration tests against redacted provider fixtures.

No real calls, messages or provider API requests have been made in this phase.
