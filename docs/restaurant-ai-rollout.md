# Restaurant website assistant — rollout checklist

This change adds a tenant-bound conversational JSON chat API to the existing floating restaurant assistant. It does not add automated order placement, telephone number purchases, data migrations or stored recordings.

## Server-side configuration (variable names only)

- `OPENAI_API_KEY`: valid key with available quota; configure only in Hostinger secrets/environment.
- `OPENAI_ASSISTANT_MODEL`: supported Responses API text model (existing default is `gpt-4.1-mini`).
- `REGISTRATION_WEBSITE_ASSISTANT_ENABLED`: new restaurants with `website_assistant_provisioned=1` automatically receive the assistant on their **published** website by default. Set to `false` only to temporarily disable this automatic behavior (emergency switch).
- `RESTAURANT_WEBSITE_ASSISTANT_ENABLED=true`: optional broad enablement for all published restaurant websites; do not use before tenant and owner readiness.
- `WEBSITE_AI_ASSISTANT_ENABLED=true`: separately enables the Mar-Khoor SaaS landing page public FAQ assistant.
- `RESTAURANT_WEBSITE_VOICE_ENABLED`: leave disabled until separately verified Realtime voice tests and consent design are approved.
- `REGISTRATION_VOICE_POOL_ENABLED`: leave disabled; this change does not allocate numbers.

Never commit or print actual API keys, DB credentials, session tokens or customer data.

## Safe verification

1. Run `npm test` on a staging copy; the tenant chat tests mock AI and database calls.
2. Verify `GET /health` and `GET /health/database`.
3. Verify `GET /api/public/assistant/status` reports enabled only after the landing-page flag and API key are configured.
4. Verify `GET /r/<published-slug>/assistant/status`: `enabled`, `provider_configured`, and `voice_enabled` are operational indicators, **not proof** that the AI provider accepts requests.
5. On a consented test restaurant's published site, open floating assistant; submit a text message, then a follow-up. If provider is down, the JSON result is tagged `source: "menu_fallback"`, never `source: "ai"`.
6. Confirm different test restaurant slugs yield only their own menu items and no cross-tenant data.
7. Observe upstream provider status/quotas in private Hostinger logs. Do not expose keys or full response bodies in public logs.
8. Confirm no real orders, WhatsApp replies, Vapi calls or paid number provisioning occurred.
9. For rollback, redeploy the recorded prior main commit and disable `REGISTRATION_WEBSITE_ASSISTANT_ENABLED` / `WEBSITE_AI_ASSISTANT_ENABLED` if necessary.

No production rollout should be called complete based only on a live fallback answer or a successful health endpoint.
