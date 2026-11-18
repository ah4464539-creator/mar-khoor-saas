# COD checkout rollout

## Current implementation
- The restaurant AI Assistant asks for phone, delivery or pickup, address for delivery, and final cash payment confirmation before submitting.
- Delivery uses `cod`; pickup uses `cash_pickup`. Both start with payment status `unpaid`.
- The checkout API validates details and stores them in `order_fulfillment` in the same transaction as the order.
- Legacy website checkout requests without fulfillment details remain supported.
- Prices and menu availability are verified server-side. Delivery fees, taxes, and tips are **not** calculated; do not claim they are included.
- Stripe Checkout and webhook signature helpers are implemented in `src/stripe-checkout.js` but **not routed/enabled**. No Stripe payments are possible until merchant onboarding and a separate verified integration.

## Deployment gate
1. Back up production database and record current rollback commit.
2. Apply additive `order_fulfillment` migration from `db/schema.sql` to a separate staging database.
3. Test delivery and pickup orders, malformed phone/address, tenant isolation, payment status, history/tracking, and duplicate request behavior.
4. Apply the additive migration to production **before** deploying this code. Otherwise detailed COD orders fail and roll back; do not deploy first.
5. Deploy the tested GitHub commit to the existing Hostinger Node.js application without altering environment variables.
6. Verify `/health`, `/health/database`, `/r/urban-cafe`, and a safe test checkout. Avoid creating real customer orders without permission.

## Stripe later
Leave `STRIPE_CHECKOUT_ENABLED` unset or `0`. When an account is connected, configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` securely in hPanel, implement and test the actual checkout/webhook routes with restaurant authorization and paid-state transitions, then enable. Never request card details in AI chat or mark paid based only on browser redirects.
