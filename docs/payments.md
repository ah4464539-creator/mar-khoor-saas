# Payments

Two separate money flows:

| Flow | Who gets the money | Code | Stripe webhook |
| --- | --- | --- | --- |
| **Plans & single tools** (Starter / Premium / Enterprise, AI Website / WhatsApp / Calling tools) | Mar-Khoor (platform Stripe account) | `src/billing.js`, `src/stripe-billing.js` | `https://mar-khoor.com/webhooks/stripe` (`STRIPE_WEBHOOK_SECRET`) |
| **Customer order payments** (optional per restaurant) | The restaurant's own Stripe account (Stripe Connect, direct charges) | `src/payments/` | `https://mar-khoor.com/webhooks/payments/stripe` (`STRIPE_CONNECT_WEBHOOK_SECRET`) |

Cash on delivery / at pickup stays the default. Online card payment shows at checkout only after a restaurant connects its own Stripe account **and** switches it on.

## Provider-agnostic interface (`src/payments/provider.js`)
Every payment provider is an adapter with four methods:

- `createCheckout({ kind, orderId, restaurantId, amountMinor, currency, description, successUrl, cancelUrl, account, idempotencyKey })` returns `{ provider, sessionId, url, feeMinor }`.
- `verifyWebhook(rawBody, headers)` returns the event, or `null` when the signature is bad.
- `handlePaymentEvent(event)` returns a normalised event `{ type: paid | failed | expired | refunded, restaurantId, orderId, sessionId, paymentRef, amountMinor, currency, refundedMinor, account }`, or `null`.
- `refund({ paymentRef, amountMinor, currency, account, idempotencyKey })` returns `{ refundId, status }`.

Adapters never touch the database; `src/payments/service.js` applies normalised events. Amounts are always Mar-Khoor minor units (price × 100).

**Adding JazzCash / Easypaisa later**:
1. Write `src/payments/jazzcash-provider.js` with the four methods.
2. Call `registerProvider('jazzcash', env => createJazzCashProvider(config(env)))` in `service.js`.
3. The webhook becomes `/webhooks/payments/jazzcash` automatically.

## Order payment flow
1. Customer picks **Pay online now (card)** on the website menu. The order is created as usual (status `pending`) with `order_fulfillment.payment_method='stripe'` and `payment_status='pending'`.
2. The server creates a Stripe Checkout session **on the restaurant's connected account**. The amount comes from the database, never from the browser. Optional platform fee: `PAYMENTS_PLATFORM_FEE_BPS`.
3. Stripe sends `checkout.session.completed` to the Connect webhook. The order is marked `paid` only if restaurant, account, session, amount and currency all match. Replays are ignored (`payment_events`).
4. If the checkout cannot be created, the order is kept and switched to cash, and the customer is told. Expired or failed payments mark `payment_status='failed'`, and staff collect cash.
5. Refunds: the order card shows **Refund payment** (restaurant admin). `POST /api/restaurants/:id/orders/:orderId/refund` supports full or partial refunds. Refunds made in the Stripe dashboard arrive as `charge.refunded`.

Restaurant setup: Dashboard → Payment methods → **Online card payments**:
1. **Set up card payments** opens Stripe Connect onboarding (Express account).
2. **Check status** confirms the account can take charges.
3. Turn on **Offer “Pay online now” at checkout**.

## Plans, tools and usage limits
- Plans and tools are unchanged (Stripe Checkout in subscription mode, prices from `src/subscriptions.js` and `src/tools.js`).
- Paid plan and tool invoices (`invoice.paid`) are now also recorded in `payment_transactions` for the revenue report.
- **Usage limits are enforced per tenant** (`src/usage-limits.js`):

  | Channel | Metered when | Enforced at |
  | --- | --- | --- |
  | AI chats | Website assistant reply | Website chat (menu fallback answers instead) |
  | WhatsApp AI replies | Each AI reply sent | WhatsApp webhook (no AI job; the message stays in the inbox for staff) |
  | AI call minutes | End of each call | Call tools: no new orders or bookings; the AI apologises and takes a callback or transfers |

  The AI pauses at **limit + 10%** (`USAGE_LIMIT_GRACE_PERCENT`) until next month or an upgrade, and the owner gets a push alert (once a day). `USAGE_LIMIT_MODE=soft` turns enforcement off. Restaurants without a plan or tool (super-admin pilots) have no limit. If usage cannot be read, the AI keeps working (fail open).

## Super admin
**Revenue** view (`GET /api/platform/revenue`):
- MRR per currency from active plans and tools (yearly ÷ 12);
- active plans and tools, and subscription statuses;
- payments per month: plan invoices, tool invoices, and customer card payments with refunds and platform fees.

## Database
`db/migrations/2026-11-26-payments.sql`: `restaurant_payment_accounts`, `payment_transactions`, `payment_events`. Additive only. Applied by `npm run migrate` and created on first use.

## Stripe setup (test mode first)
1. Stripe Dashboard (test mode) → Developers → API keys. Set `STRIPE_SECRET_KEY=sk_test_...` on the server.
2. Webhook 1 (your account): `https://mar-khoor.com/webhooks/stripe`. Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`. Signing secret → `STRIPE_WEBHOOK_SECRET`.
3. Connect → enable Connect (Express accounts). Then Webhook 2 with **Listen to events on Connected accounts**: `https://mar-khoor.com/webhooks/payments/stripe`. Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`. Signing secret → `STRIPE_CONNECT_WEBHOOK_SECRET`.
4. Settings → Billing → Customer portal: turn on (used by "Manage billing").
5. Test with card `4242 4242 4242 4242`, then switch to live keys.
