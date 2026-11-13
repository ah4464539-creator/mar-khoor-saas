# Connecting Vapi to Mar-Khoor (staging)

## Requirements
- Deploy this API to a reachable **HTTPS** URL. GitHub repository hosting alone does not run the Node.js API.
- Apply MariaDB migrations, create the platform super admin, onboard a restaurant and add active menu items.
- Set a long random `VAPI_TOOL_SECRET` on the server. Do not put it in browser JavaScript or GitHub.
- Sign in as super admin. Under **Connect Vapi assistant**, map the Vapi assistant ID to the restaurant ID shown in the directory.

## Internal tool endpoints
These are **Mar-Khoor endpoints**, not a claim of Vapi's native tool schema.

1. `GET https://YOUR_API_HOST/voice-tools/assistants/ASSISTANT_ID/menu`
   Header: `x-markhoor-tool-secret: YOUR_SECRET`
   Returns current active menu with item IDs and prices in minor currency units.
2. `POST https://YOUR_API_HOST/voice-tools/assistants/ASSISTANT_ID/orders`
   Header: `x-markhoor-tool-secret: YOUR_SECRET`
   JSON body:
   ```json
   {"call_id":"unique-provider-call-id","customer_name":"Customer","confirmed":true,"items":[{"menu_item_id":1,"quantity":2}]}
   ```
   The customer must explicitly confirm the order before this endpoint is called. Prices are recalculated on the server. Reusing the same assistant and call ID returns the existing order.

## Important integration gap
Vapi's current native tool-call envelope, credentials mechanism, and server URL configuration must be verified against the provider's current documentation before wiring these endpoints. A server-side adapter should extract the authenticated Vapi assistant/call IDs from provider-verified requests, then call the internal endpoints. Do **not** trust caller-supplied assistant or call IDs as proof of origin.

`/integrations/webhooks/vapi` records call lifecycle events in `voice_calls` (see [Vapi integration status](vapi-integration.md)). It is shared-secret protected only and unverified against live Vapi traffic.

## Testing
- `npm test` runs mocked API tests.
- CI also runs MariaDB schema and rollback checks.
- A successful GitHub push does not confirm CI success, live phone calls, or provider connectivity.
