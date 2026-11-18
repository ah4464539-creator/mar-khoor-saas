// Restaurant onboarding API: plan choice, usage, and the setup box.
import express from 'express';
import { requireAuth } from './auth.js';
import { audit } from './security.js';
import { planCatalog, chooseSubscription, getSubscription, getUsage } from './subscriptions.js';
import { getIntegrations, saveSetup, finishSetup } from './setup-integrations.js';
import { assignRegistrationNumber } from './registration-voice.js';
import { getUsdRates, FX_ATTRIBUTION } from './fx-rates.js';

export function onboardingRouter(pool, { assignVoiceNumber = assignRegistrationNumber, loadRates = getUsdRates } = {}) {
 const router = express.Router();
 // Restaurant admins (or the super admin) only; every query below is scoped by req.restaurantId.
 const restaurantAdmin = async (req, res, next) => {
  const id = Number(req.params.restaurantId);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid restaurant' });
  try {
   if (req.user.platformRole !== 'super_admin') {
    const [rows] = await pool.execute("SELECT role FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1", [id, req.user.id]);
    if (!rows.length) return res.status(403).json({ error: 'Forbidden' });
   }
   req.restaurantId = id;
   next();
  } catch { res.status(503).json({ error: 'Database unavailable' }); }
 };
 const base = '/restaurants/:restaurantId';

 router.get(base + '/subscription', requireAuth, restaurantAdmin, async (req, res) => {
  try {
   const [restaurants] = await pool.execute('SELECT currency FROM restaurants WHERE id=? LIMIT 1', [req.restaurantId]);
   if (!restaurants.length) return res.status(404).json({ error: 'Restaurant not found' });
   const fx = await loadRates();
   res.json({ plans: planCatalog(restaurants[0].currency, { fx }), subscription: await getSubscription(pool, req.restaurantId),
    exchange: fx ? { source: fx.source, as_of: fx.asOf, attribution: fx.source === 'exchangerate-api' ? FX_ATTRIBUTION : null } : null });
  } catch { res.status(503).json({ error: 'Plans unavailable' }); }
 });
 router.put(base + '/subscription', requireAuth, restaurantAdmin, async (req, res) => {
  const result = await chooseSubscription(pool, req.restaurantId, req.body, { fx: await loadRates() });
  if (result.status === 200) await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'subscription.choose:' + req.body.plan + ':' + req.body.billing_cycle });
  res.status(result.status).json(result.body);
 });
 router.get(base + '/usage', requireAuth, restaurantAdmin, async (req, res) => {
  try { res.json(await getUsage(pool, req.restaurantId)); }
  catch { res.status(503).json({ error: 'Usage unavailable' }); }
 });

 router.get(base + '/integrations', requireAuth, restaurantAdmin, async (req, res) => {
  try { res.json({ integrations: await getIntegrations(pool, req.restaurantId) }); }
  catch { res.status(503).json({ error: 'Setup unavailable' }); }
 });
 router.put(base + '/integrations', requireAuth, restaurantAdmin, async (req, res) => {
  const result = await saveSetup(pool, req.restaurantId, req.body);
  res.status(result.status).json(result.body);
 });
 router.post(base + '/integrations/finish', requireAuth, restaurantAdmin, async (req, res) => {
  const result = await finishSetup(pool, req.restaurantId, { assignVoiceNumber, baseUrl: process.env.PUBLIC_BASE_URL });
  if (result.status === 200) await audit(pool, { actorUserId: req.user.id, restaurantId: req.restaurantId, action: 'setup.finish' });
  res.status(result.status).json(result.body);
 });
 return router;
}
