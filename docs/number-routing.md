# Country-wise number routing and plan orders

A restaurant registers (`POST /auth/register`), logs in, and adds services and an optional **new phone number** to a plan order (its cart). The price of the number depends on the restaurant's country.

## Provisioning

Payment confirmation remains manual. For automatic Telnyx purchase, back up MariaDB and run `npm run migrate`, then set `TELNYX_API_KEY` in the server environment and restart. Configure a Telnyx country route in `auto` mode. Check country requirements and provider charges before accepting an order.

For a paid order with a new number, the super admin moves it to Provisioning, opens **Manage Telnyx number**, selects an available local voice number and confirms the provider purchase. Refresh Telnyx status on the order. Finish country verification where required, configure Vapi and verify a call before setting the plan order Active.

If submission times out, look up the displayed customer reference in Telnyx and enter the matching provider order ID. The app blocks repeat purchases for the same plan order, including after an uncertain response. If Telnyx confirms no order was created, resolve the attempt manually before arranging a replacement.

## Number routes (super admin)
`GET /api/platform/number-routes`, `PUT /api/platform/number-routes/:country` (two-letter code, e.g. `AE`)

```json
{ "provider": "telnyx", "mode": "manual", "monthly_minor": 2500, "setup_minor": 500, "requirements": "Trade licence and proof of address" }
```
- `provider`: `telnyx`, `twilio`, `didww` or `manual`
- `mode`: `auto` (configured Telnyx only), `manual` or `unavailable`. Prices are **USD cents**.
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
