# WhatsApp AI auto-reply staging

AI replies are **disabled by default**. A restaurant admin must enable the checkbox in the restaurant dashboard. The verified Meta webhook stores inbound text and queues a job only once per message. No AI request is made inside the webhook.

Configure META_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, OPENAI_API_KEY, DB_* and optionally WHATSAPP_AI_MODEL on the server. Apply migrations with npm run migrate. Run npm run whatsapp-ai:once on a reliable scheduler (e.g. every minute). Without a scheduler, queued messages are not sent. Do not publish API keys in the browser.

The worker uses only the mapped restaurant's active menu, currency and locale, and instructs the model not to invent products or finalize orders. It replies via the Meta Cloud API, records outbound history and marks jobs sent/failed. Failed jobs do not retry automatically, because Meta may have accepted a message even if a later database write failed. This is an initial integration, not a guarantee against duplicate sends across process crashes.

Limitations: no live provider verification yet; no customer consent flow, per-customer handoff, conversation context, template messaging outside 24 hours, or AI-based order creation. Meta's 24-hour customer service window and platform policies must be respected. The worker only processes inbound messages stored within 24 hours. Check costs and privacy/data processing requirements before enabling in production.
