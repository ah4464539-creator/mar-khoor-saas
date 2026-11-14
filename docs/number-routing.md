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

## Telnyx provisioning (human-confirmed)
**Status: built and unit-tested against mocks that follow Telnyx's and Vapi's published API reference. Not yet tried against the live Telnyx or Vapi APIs.**

Nothing is bought automatically. Flow for an order that asked for a new number:
1. Route the country to `telnyx` with mode `manual` (super admin, "Phone numbers by country").
2. The restaurant places the order, you confirm payment (status `paid`).
3. Map exactly one active Vapi assistant to the restaurant (existing Voice integrations panel).
4. In "Plan orders" press **Find numbers**. The server searches Telnyx (`GET /v2/available_phone_numbers`, local numbers with voice). Compare the provider cost shown with the price you charge.
5. Press **Buy this number** and confirm. The server claims the number in `restaurant_numbers`, orders it (`POST /v2/number_orders`), and when Telnyx reports `success` imports it into Vapi (`POST /phone-number`, provider `telnyx`) bound to the restaurant's assistant. The plan order moves to `provisioning`; move it to `active` yourself when the restaurant has tested a call.
6. If Telnyx leaves the order `pending` (many countries need identity documents or a requirement group first) the number shows `pending provider`. Finish the documents in the Telnyx portal, then press **Retry import**. A failed import shows `import failed` and can be retried; the number is already paid for at that point.

Environment variables (names only): `TELNYX_API_KEY`, `VAPI_API_KEY`, `VAPI_TELNYX_CREDENTIAL_ID` (the Telnyx credential you add once in Vapi), and optionally `TELNYX_REQUIREMENT_GROUP_<COUNTRY>` (for example `TELNYX_REQUIREMENT_GROUP_AE`) for countries that need a requirement group on the order.

Each order carries a customer reference (`mar-khoor-<order>-<uuid>`). If Telnyx gives an error answer, the row is `failed` (nothing was bought). If Telnyx does not answer at all (timeout), the purchase outcome is unknown: the row stays claimed with the reference in `last_error`, no second purchase is possible, and you must check the Telnyx portal for that reference before doing anything else. The buy request must also carry `confirm_purchase: true`, which the admin screen sends only after the confirmation dialog.

Safety: super admin only; one number per order and one order per number (database unique keys, so a double click cannot buy twice); keys never leave the server; every purchase and retry is written to the audit log. Telnyx only lets you order numbers returned by a recent search, so buy soon after searching. Verify the first purchase in a country with a cheap local number before promising prices to restaurants.
