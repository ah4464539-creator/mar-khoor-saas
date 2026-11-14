# Country-wise number routing and plan orders

A restaurant registers (`POST /auth/register`), logs in, and adds services and an optional **new phone number** to a plan order (its cart). The price of the number depends on the restaurant's country.

## Status: implemented, not yet tested against a live database or a number provider
- No provider API is called yet. Every number is provisioned **by hand** by the super admin (buy the number with the provider, import it into Vapi, link it to the restaurant's assistant, then mark the order active).
- A route cannot be set to `auto` yet; the API rejects it until a provider adapter exists.
- Payment is **not** collected online. The super admin confirms payment manually and moves the order to `paid`.

## Number routes (super admin)
`GET /api/platform/number-routes`, `PUT /api/platform/number-routes/:country` (two-letter code, e.g. `AE`)

```json
{ "provider": "telnyx", "mode": "manual", "monthly_minor": 2500, "setup_minor": 500, "requirements": "Trade licence and proof of address" }
```
- `provider`: `telnyx`, `twilio`, `didww` or `manual`
- `mode`: `manual` (done by hand) or `unavailable` (not offered). Prices are **USD cents**.
- A stored route overrides the same country in `PLAN_CATALOG_JSON`. Countries with no route show "availability pending" and cannot be ordered.
- Check the provider's current price and documents before setting a route. Some countries (for example Pakistan) need identity documents and proof of address, so approval takes time.

## Plan catalog (`PLAN_CATALOG_JSON`, optional)
USD cents. Services without a price show "pricing pending" and cannot be ordered.
```json
{ "services": { "website": 1900, "webAi": 2900, "whatsapp": 2900, "voice": 4900 }, "voiceMinutes": 300, "voiceExtra": 15 }
```

## Plan orders
- Restaurant admin: `GET/POST /api/restaurants/:id/plan-orders`, `POST /api/restaurants/:id/plan-orders/:orderId/cancel` (only before payment).
- Super admin: `GET /api/platform/plan-orders`, `PUT /api/platform/plan-orders/:orderId/status` with `{ "status": "paid" }`.
- The country comes from the restaurant's record and the quote is computed on the server; nothing price-related is trusted from the request.
- One open order per restaurant. Status moves forward only: `pending_payment` -> `paid` -> `provisioning` -> `active` (or `cancelled`).
- Run `npm run migrate` to create the `number_routes` and `plan_orders` tables.

## Adding a provider later
A provider adapter should expose: search numbers, order a number, submit documents, check status, import into Vapi and link the assistant. Add providers only when a country needs a cheaper or easier option than the existing ones.
