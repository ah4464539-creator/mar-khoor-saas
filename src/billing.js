// Routes for paying Mar-Khoor plans with Stripe.
import express from 'express';
import { requireAuth } from './auth.js';
import { audit, rateLimit } from './security.js';
import { chooseSubscription, getSubscription, planCatalog, validateSubscriptionChoice } from './subscriptions.js';
import { getUsdRates } from './fx-rates.js';
import { provisionSubscriptionNumber } from './voice-autoprovision.js';
import { billingConfig, createStripeClient, ensureBillingTables, checkoutParams, verifyStripeSignature, applyBillingEvent, addonPeriodMinor, hasNumberAddon, TOOL_KEYS } from './stripe-billing.js';

/** Stripe webhook. Mount BEFORE express.json(): the signature is over the raw body. */
export function billingWebhookRouter(pool, { config = billingConfig(), stripe = createStripeClient(config), provision = provisionSubscriptionNumber } = {}) {
  const router = express.Router();
  router.post('/webhooks/stripe', express.raw({ type: 'application/json', limit: '512kb' }), async (req, res) => {
    if (!config) return res.status(404).json({ error: 'Billing not configured' });
    const event = verifyStripeSignature(req.body, req.get('stripe-signature'), config.webhookSecret);
    if (!event) return res.status(400).json({ error: 'Invalid signature' });
    try {
      const outcome = await applyBillingEvent(pool, event, { stripe });
      if (outcome.restaurantId) audit(pool, { restaurantId: outcome.restaurantId, action: 'billing.' + event.type + ':' + outcome.result });
      // Same as a super admin confirming payment: plans with a dedicated number get one now.
      if (outcome.activated) provision(pool, outcome.restaurantId).catch(() => {});
      res.json({ received: true, result: outcome.result });
    } catch (error) {
      console.error(JSON.stringify({ event: 'stripe_webhook_failed', type: event.type, code: error?.code }));
      res.status(500).json({ error: 'Webhook processing failed' }); // Stripe retries
    }
  });
  return router;
}

export function billingRouter(pool, { config = billingConfig(), stripe = createStripeClient(config), loadRates = getUsdRates, baseUrl = process.env.PUBLIC_BASE_URL || 'https://mar-khoor.com' } = {}) {
  baseUrl = String(baseUrl).replace(/\/+$/, '');
  const router = express.Router();
  const restaurantAdmin = async (req, res, next) => {
    const id = Number(req.params.restaurantId);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid restaurant' });
    try {
      if (req.user.platformRole !== 'super_admin') {
        const [rows] = await pool.execute("SELECT role FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1", [id, req.user.id]);
        if (!rows.length) return res.status(403).json({ error: 'Only restaurant admins can manage billing' });
      }
      const [restaurants] = await pool.execute('SELECT id,name,currency FROM restaurants WHERE id=? LIMIT 1', [id]);
      if (!restaurants.length) return res.status(404).json({ error: 'Restaurant not found' });
      req.restaurant = restaurants[0];
      next();
    } catch { res.status(503).json({ error: 'Database unavailable' }); }
  };
  const billingRow = async id => {
    if (!config) return null;
    await ensureBillingTables(pool);
    const [rows] = await pool.execute('SELECT stripe_customer_id,stripe_subscription_id,stripe_status,current_period_end FROM restaurant_billing WHERE restaurant_id=? LIMIT 1', [id]);
    return rows[0] ?? null;
  };

  router.get('/api/restaurants/:restaurantId/billing', requireAuth, restaurantAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try {
      const row = await billingRow(req.restaurant.id);
      res.json({
        enabled: Boolean(config), test_mode: Boolean(config && !config.live),
        subscription: await getSubscription(pool, req.restaurant.id),
        stripe: row ? { has_customer: Boolean(row.stripe_customer_id), status: row.stripe_status, renews_at: row.current_period_end } : null,
        number_addon: config ? await hasNumberAddon(pool, req.restaurant.id) : false,
      });
    } catch { res.status(503).json({ error: 'Billing unavailable' }); }
  });

  router.post('/api/restaurants/:restaurantId/billing/checkout', requireAuth, restaurantAdmin,
    rateLimit({ windowMs: 60000, max: 6, name: 'billing-checkout' }), async (req, res) => {
      if (!config) return res.status(503).json({ error: 'Online payment is not available yet. The platform will confirm your payment manually.' });
      try {
        const current = await getSubscription(pool, req.restaurant.id);
        const row = await billingRow(req.restaurant.id);
        // Snapshot the plan and price on the server; the client never sends an amount. An active
        // plan stays active while the owner pays for a change; the webhook switches it.
        const choice = validateSubscriptionChoice(req.body);
        if (choice.error) return res.status(400).json({ error: choice.error });
        const tools = Array.isArray(req.body?.tools) ? TOOL_KEYS.filter(key => req.body.tools.includes(key)) : [...TOOL_KEYS];
        if (!tools.length) return res.status(400).json({ error: 'Choose at least one tool' });
        const fx = await loadRates();
        const plan = planCatalog(req.restaurant.currency, { fx }).find(entry => entry.key === choice.value.plan);
        const subscription = { plan: plan.key, billing_cycle: choice.value.cycle, currency: plan.currency, price_minor: plan.price_minor[choice.value.cycle] };
        const wantsNumber = req.body?.dedicated_number === true && !plan.dedicated_number.included;
        const addonMinor = wantsNumber ? addonPeriodMinor(plan, choice.value.cycle) : null;
        if (wantsNumber && addonMinor == null) return res.status(409).json({ error: 'The dedicated number add-on has no price in your currency yet' });
        const paidAddon = await hasNumberAddon(pool, req.restaurant.id);
        if (current?.status === 'active' && row?.stripe_subscription_id && current.plan === plan.key && current.billing_cycle === choice.value.cycle && (plan.dedicated_number.included || paidAddon === wantsNumber))
          return res.status(409).json({ error: 'This plan is already active. Use "Manage billing" to change your card or cancel.' });
        if (current?.status !== 'active') {
          const chosen = await chooseSubscription(pool, req.restaurant.id, req.body, { fx });
          if (chosen.status !== 200) return res.status(chosen.status).json(chosen.body);
        }
        const params = checkoutParams({ restaurant: req.restaurant, subscription, plan, email: req.user.email, customerId: row?.stripe_customer_id, baseUrl, addonMinor, tools });
        if (!params) return res.status(409).json({ error: 'This plan has no confirmed price in your currency yet' });
        const key = ['plan', req.restaurant.id, subscription.plan, subscription.billing_cycle, subscription.currency, subscription.price_minor, addonMinor ?? 0, tools.join('.'), Math.floor(Date.now() / 600000)].join('-');
        const session = await stripe.checkout(params, key);
        if (!/^https:\/\/checkout\.stripe\.com\//.test(session?.url || '')) throw new Error('Invalid payment session');
        await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurant.id, action: 'billing.checkout:' + subscription.plan + ':' + subscription.billing_cycle });
        res.json({ url: session.url });
      } catch (error) {
        console.error(JSON.stringify({ event: 'stripe_checkout_failed', status: error?.status, code: error?.code }));
        res.status(502).json({ error: 'Could not start the payment. Please try again in a minute.' });
      }
    });

  router.post('/api/restaurants/:restaurantId/billing/portal', requireAuth, restaurantAdmin, async (req, res) => {
    if (!config) return res.status(503).json({ error: 'Online billing is not available' });
    try {
      const row = await billingRow(req.restaurant.id);
      if (!row?.stripe_customer_id) return res.status(409).json({ error: 'No card payment on file yet' });
      const session = await stripe.portal({ customer: row.stripe_customer_id, return_url: baseUrl + '/restaurant.html#plan' });
      if (!/^https:\/\/billing\.stripe\.com\//.test(session?.url || '')) throw new Error('Invalid portal session');
      res.json({ url: session.url });
    } catch (error) {
      console.error(JSON.stringify({ event: 'stripe_portal_failed', status: error?.status, code: error?.code }));
      res.status(502).json({ error: 'Billing page unavailable. In Stripe, turn on the customer portal (Settings → Billing → Customer portal).' });
    }
  });
  return router;
}
