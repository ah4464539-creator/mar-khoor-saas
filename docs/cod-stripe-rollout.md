# COD checkout rollout

## Current implementation
- The restaurant AI Assistant asks for phone, delivery or pickup, address for delivery, and final cash payment confirmation before submitting.
- Delivery uses `cod`; pickup uses `cash_pickup`. Both start with payment status `unpaid`.
- The checkout API validates details and stores them in `order_fulfillment` in the same transaction as the order.
- Legacy website checkout requests without fulfillment details remain supported.
- Prices and menu availability are verified server-side. Delivery fees, taxes, and tips are **not** calculated; do not claim they are included.
- Stripe Checkout and webhook signature helpers are implemented in `src/stripe-checkout.js` but **not routed/enabled**. No Stripe payments are possible until merchant onboarding and a separate verified integration.

## Fixes on top of eedf61e (branch fix/cod-checkout-completion)
- Phone validation regex required a literal backslash, so every COD order was rejected. Fixed and moved to `src/order-fulfillment.js` (7–15 digits).
- Assistant summary showed literal `\n`. Fixed; summary is now itemized with name, phone, address/instructions, payment and unpaid status.
- Assistant now asks optional delivery instructions and an explicit cash payment step; card/online requests are refused.
- Network timeout on submit no longer says "try again"; it tells the customer to check Order History first (no duplicate orders).
- Restaurant dashboard `/orders` API and table show fulfilment (type, phone, address, instructions) and payment (method + status), joined on both order and restaurant id.
- Customer tracking shows order type, payment method and payment status (no phone/address).
- Both read paths fall back safely if the migration has not run yet; checkout rolls the whole order back instead.
- Stripe helper: restaurant id in metadata and idempotency key; `applyVerifiedStripeEvent` checks session id, restaurant, amount and currency and is replay-safe. Still not routed.
- Standalone additive migration: `db/migrations/order-fulfillment.sql`.

## Deployment gate
1. Back up production database and record current rollback commit.
2. Apply `db/migrations/order-fulfillment.sql` to a separate staging database (compare the row counts noted in the file).
3. Test delivery and pickup orders, malformed phone/address, tenant isolation, payment status, history/tracking, and duplicate request behavior.
4. Apply the additive migration to production **before** deploying this code. Otherwise detailed COD orders fail and roll back; do not deploy first.
5. Deploy the tested GitHub commit to the existing Hostinger Node.js application without altering environment variables.
6. Verify `/health`, `/health/database`, `/r/urban-cafe`, and a safe test checkout. Avoid creating real customer orders without permission.

## Stripe later
Leave `STRIPE_CHECKOUT_ENABLED` unset or `0`. When an account is connected, configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` securely in hPanel, implement and test the actual checkout/webhook routes with restaurant authorization and paid-state transitions, then enable. Never request card details in AI chat or mark paid based only on browser redirects.
