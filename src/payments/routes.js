// HTTP routes for online payments.
//   POST /webhooks/payments/:provider             provider webhook (raw body; mount before express.json)
//   GET  /api/restaurants/:id/payments/online     owner: online payment status
//   POST /api/restaurants/:id/payments/online/connect   owner: create / continue the provider account
//   POST /api/restaurants/:id/payments/online/refresh   owner: re-check the account with the provider
//   PUT  /api/restaurants/:id/payments/online     owner: offer online payment to customers or not
//   POST /api/restaurants/:id/orders/:orderId/refund    owner: refund an online order payment
//   GET  /api/platform/revenue                    super admin: revenue and subscriptions
import express from 'express';
import { requireAuth } from '../auth.js';
import { audit, rateLimit } from '../security.js';
import { getProvider } from './provider.js';
import { maskText } from '../observability.js';
import { ensurePaymentsTables, paymentAccount, saveAccount, applyPaymentEvent, refundOrder, revenueReport, orderProvider } from './service.js';

const safeCode = error => /^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(error?.code ?? '') ? error.code : 'UNKNOWN';
// Provider error details for logs: Stripe's message and the parameter it rejected (no keys or card data).
const providerDetail = error => ({ status: error?.status, code: safeCode(error), param: error?.param || undefined, message: maskText(error?.stripeMessage || '') || undefined });
export const COUNTRY_NOT_SUPPORTED = 'Stripe card payments are not available for businesses in your country yet. Use cash, JazzCash, Easypaisa or a bank transfer under "Bank & wallet accounts".';

export function paymentsWebhookRouter(pool, { providerFor = name => getProvider(name) } = {}) {
  const router = express.Router();
  router.post('/webhooks/payments/:provider', express.raw({ type: 'application/json', limit: '512kb' }), async (req, res) => {
    const provider = /^[a-z][a-z0-9_]{1,30}$/.test(req.params.provider) ? providerFor(req.params.provider) : null;
    if (!provider) return res.status(404).json({ error: 'Payment provider not configured' });
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Invalid body' });
    const event = provider.verifyWebhook(req.body, { get: name => req.get(name) });
    if (!event) return res.status(400).json({ error: 'Invalid signature' });
    try {
      const normalised = provider.handlePaymentEvent(event);
      if (!normalised) return res.json({ received: true, result: 'ignored' });
      const outcome = await applyPaymentEvent(pool, normalised);
      if (outcome.result !== 'duplicate') audit(pool, { restaurantId: normalised.restaurantId || null, action: 'payment.' + provider.name + '.' + normalised.type + ':' + outcome.result });
      res.json({ received: true, result: outcome.result });
    } catch (error) {
      console.error(JSON.stringify({ event: 'payment_webhook_failed', provider: provider.name, code: safeCode(error) }));
      res.status(500).json({ error: 'Webhook processing failed' }); // the provider retries
    }
  });
  return router;
}

export function paymentsRouter(pool, { providerFor = () => orderProvider(), baseUrl = process.env.PUBLIC_BASE_URL || 'https://mar-khoor.com' } = {}) {
  baseUrl = String(baseUrl).replace(/\/+$/, '');
  ensurePaymentsTables(pool).catch(() => {});
  const router = express.Router();
  const restaurantAdmin = async (req, res, next) => {
    const id = Number(req.params.restaurantId);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid restaurant' });
    try {
      if (req.user.platformRole !== 'super_admin') {
        const [rows] = await pool.execute("SELECT 1 FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1", [id, req.user.id]);
        if (!rows.length) return res.status(403).json({ error: 'Only restaurant admins can manage payments' });
      }
      const [restaurants] = await pool.execute('SELECT id,name,country_code,currency FROM restaurants WHERE id=? LIMIT 1', [id]);
      if (!restaurants.length) return res.status(404).json({ error: 'Restaurant not found' });
      req.restaurant = restaurants[0];
      next();
    } catch { res.status(503).json({ error: 'Database unavailable' }); }
  };
  const base = '/api/restaurants/:restaurantId/payments/online';
  const view = async (restaurantId, provider) => {
    const account = await paymentAccount(pool, restaurantId, provider?.name);
    const [[restaurant]] = await pool.execute('SELECT country_code FROM restaurants WHERE id=? LIMIT 1', [restaurantId]);
    const countrySupported = provider?.supportsCountry ? provider.supportsCountry(restaurant?.country_code) : Boolean(provider);
    return { configured: Boolean(provider), provider: provider?.name ?? null, test_mode: provider ? !provider.live : null, country_supported: countrySupported,
      connected: Boolean(account), charges_enabled: Boolean(account?.chargesEnabled), online_enabled: Boolean(account?.onlineEnabled && account?.chargesEnabled) };
  };

  router.get(base, requireAuth, restaurantAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    try { res.json(await view(req.restaurant.id, providerFor())); } catch { res.status(503).json({ error: 'Payments unavailable' }); }
  });

  router.post(base + '/connect', requireAuth, restaurantAdmin, rateLimit({ windowMs: 60000, max: 5, name: 'payments-connect' }), async (req, res) => {
    const provider = providerFor();
    if (!provider?.createAccount) return res.status(503).json({ error: 'Online payment is not available yet' });
    try {
      let account = await paymentAccount(pool, req.restaurant.id, provider.name);
      if (!account && provider.supportsCountry && !provider.supportsCountry(req.restaurant.country_code)) return res.status(409).json({ error: COUNTRY_NOT_SUPPORTED, country_supported: false });
      if (!account) {
        const created = await provider.createAccount({ country: req.restaurant.country_code, email: req.user.email, restaurantId: req.restaurant.id });
        await saveAccount(pool, req.restaurant.id, { accountId: created.accountId, chargesEnabled: false, onlineEnabled: false }, provider.name);
        account = { accountId: created.accountId };
      }
      const link = await provider.onboardingLink({ account: account.accountId, refreshUrl: baseUrl + '/restaurant.html#payment-methods', returnUrl: baseUrl + '/restaurant.html#payment-methods' });
      await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurant.id, action: 'payments.connect:' + provider.name });
      res.json({ url: link.url });
    } catch (error) {
      console.error(JSON.stringify({ event: 'payments_connect_failed', ...providerDetail(error) }));
      // A 4xx from Stripe will fail the same way again: say why instead of "try again".
      if (error?.status >= 400 && error?.status < 500 && error?.stripeMessage) return res.status(409).json({ error: 'Stripe: ' + error.stripeMessage });
      res.status(502).json({ error: 'Could not open the payment setup. Please try again in a minute.' });
    }
  });

  router.post(base + '/refresh', requireAuth, restaurantAdmin, rateLimit({ windowMs: 60000, max: 10, name: 'payments-refresh' }), async (req, res) => {
    const provider = providerFor();
    if (!provider?.accountStatus) return res.status(503).json({ error: 'Online payment is not available yet' });
    try {
      const account = await paymentAccount(pool, req.restaurant.id, provider.name);
      if (!account) return res.status(409).json({ error: 'Connect your payment account first' });
      const status = await provider.accountStatus(account.accountId);
      await saveAccount(pool, req.restaurant.id, { accountId: account.accountId, chargesEnabled: status.chargesEnabled, onlineEnabled: status.chargesEnabled ? null : false }, provider.name);
      res.json(await view(req.restaurant.id, provider));
    } catch (error) {
      console.error(JSON.stringify({ event: 'payments_refresh_failed', ...providerDetail(error) }));
      res.status(502).json({ error: 'Payment provider unavailable' });
    }
  });

  router.put(base, requireAuth, restaurantAdmin, express.json({ limit: '2kb' }), async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
    const provider = providerFor();
    try {
      const account = await paymentAccount(pool, req.restaurant.id, provider?.name);
      if (req.body.enabled && (!provider || !account?.chargesEnabled)) return res.status(409).json({ error: 'Finish the payment account setup first' });
      if (!account) return res.json(await view(req.restaurant.id, provider));
      await saveAccount(pool, req.restaurant.id, { accountId: account.accountId, onlineEnabled: req.body.enabled }, provider.name);
      await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurant.id, action: 'payments.online:' + (req.body.enabled ? 'on' : 'off') });
      res.json(await view(req.restaurant.id, provider));
    } catch { res.status(503).json({ error: 'Payments unavailable' }); }
  });

  router.post('/api/restaurants/:restaurantId/orders/:orderId/refund', requireAuth, restaurantAdmin, rateLimit({ windowMs: 60000, max: 10, name: 'payments-refund' }), express.json({ limit: '2kb' }), async (req, res) => {
    const orderId = Number(req.params.orderId);
    const amount = req.body?.amount_minor === undefined || req.body?.amount_minor === null ? null : req.body.amount_minor;
    if (!Number.isSafeInteger(orderId) || orderId < 1 || (amount !== null && !Number.isSafeInteger(amount))) return res.status(400).json({ error: 'Invalid refund' });
    try {
      const result = await refundOrder(pool, { restaurantId: req.restaurant.id, orderId, amountMinor: amount, provider: providerFor() });
      if (result.status === 200) await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurant.id, action: 'payments.refund:order#' + orderId });
      res.status(result.status).json(result.body);
    } catch (error) {
      console.error(JSON.stringify({ event: 'payments_refund_failed', ...providerDetail(error) }));
      res.status(502).json({ error: 'The refund could not be made. Check the payment in your Stripe dashboard.' });
    }
  });

  router.get('/api/platform/revenue', requireAuth, async (req, res) => {
    if (req.user.platformRole !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
    res.set('Cache-Control', 'no-store, private');
    try { res.json(await revenueReport(pool, { months: Number(req.query.months) || 12 })); }
    catch { res.status(503).json({ error: 'Revenue unavailable' }); }
  });
  return router;
}
