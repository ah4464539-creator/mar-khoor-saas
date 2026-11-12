# Vapi tool adapter — staging checklist

## Endpoint
POST `https://YOUR-STAGING-HOST/integrations/vapi/tools`

Configure a Vapi tool/server request with header `x-markhoor-tool-secret: <VAPI_TOOL_SECRET>`. Store the value in deployment secrets, not in GitHub. This custom header is a shared-secret gate, **not a verified Vapi cryptographic signature**. Check current provider support and test with a real sandbox call before production.

## Tool functions
- `get_menu`: no arguments. Responds with active menu items and minor-unit prices for the mapped assistant.
- `place_order`: arguments `{ "customer_name": "Customer", "confirmed": true, "items": [{ "menu_item_id": 1, "quantity": 2 }] }`. Explicit confirmation is mandatory. The adapter uses `message.call.id` for idempotency and does not trust a model-supplied call ID.

## Expected envelope (illustrative; verify against actual provider version)
```json
{"message":{"assistant":{"id":"assistant-id"},"call":{"id":"call-id"},"toolCallList":[{"id":"tool-call-id","function":{"name":"get_menu","arguments":{}}}]}}
```

The adapter responds with `{"results":[{"toolCallId":"tool-call-id","result":{...}}]}`. An active assistant mapping must be configured by super admin before testing. Prices come from MariaDB, never the model. The same call ID is idempotent for orders; placing two different orders in one call is **not supported** by the current design.

## Release blockers
- Verify provider tool schema, authentication/header forwarding, request envelope, and response handling against current Vapi docs.
- Run GitHub Actions and inspect failures.
- Verify real HTTPS staging request and a test phone call; check order appears in the correct restaurant dashboard.
- Confirm multilingual prompt behavior and consent/privacy policy.
- WhatsApp calling and messaging are separate integrations and remain pending.
