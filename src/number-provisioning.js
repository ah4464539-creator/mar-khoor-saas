import { randomUUID } from 'node:crypto';
import { audit, rateLimit } from './security.js';
import { isPhoneNumber, telnyxNumbers } from './telnyx.js';

const providerIdPattern = /^[a-f\d-]{36}$/i;
export const telnyxConfigured = () => Boolean(process.env.TELNYX_API_KEY?.trim());

export function addNumberProvisioningRoutes(router, pool, requireAuth, superOnly) {
  const route = '/platform/plan-orders/:orderId/telnyx';
  router.use(route, requireAuth, superOnly, rateLimit({ windowMs: 60000, max: 30, name: 'telnyx' }));

  async function load(req, res, next) {
    if (!telnyxConfigured()) return res.status(503).json({ error: 'Telnyx is not configured' });
    const id = Number(req.params.orderId);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid plan order' });
    try {
      const [rows] = await pool.execute(
        'SELECT o.id,o.restaurant_id,o.country_code,o.status,o.number_mode,r.provider,r.mode,p.phone_number,p.customer_reference,p.provider_order_id,p.provider_status FROM plan_orders o LEFT JOIN number_routes r ON r.country_code=o.country_code LEFT JOIN telnyx_number_orders p ON p.plan_order_id=o.id WHERE o.id=?',
        [id],
      );
      if (!rows.length) return res.status(404).json({ error: 'Plan order not found' });
      req.planOrder = rows[0];
      req.telnyx = telnyxNumbers(process.env.TELNYX_API_KEY);
      next();
    } catch (error) { next(error); }
  }

  function eligible(order) {
    return order.number_mode === 'new' && order.status === 'provisioning' && order.provider === 'telnyx' && order.mode === 'auto';
  }

  async function storeStatus(order, result) {
    if (!providerIdPattern.test(result?.id) || typeof result.status !== 'string' || result.status.length > 64 ||
        result.customer_reference !== order.customer_reference ||
        !result.phone_numbers?.some(number => number.phone_number === order.phone_number)) {
      throw new Error('Telnyx order does not match');
    }
    await pool.execute(
      'UPDATE telnyx_number_orders SET provider_order_id=?,provider_status=? WHERE plan_order_id=?',
      [result.id, result.status, order.id],
    );
    return { provider_order_id: result.id, status: result.status, phone_number: order.phone_number };
  }

  router.get(route + '/available', load, async (req, res) => {
    const order = req.planOrder;
    if (!eligible(order) || order.customer_reference) return res.status(409).json({ error: 'Plan order is not eligible for another number purchase' });
    try {
      res.json({ numbers: await req.telnyx.search(order.country_code) });
    } catch {
      res.status(502).json({ error: 'Telnyx number search failed' });
    }
  });

  router.post(route, load, async (req, res, next) => {
    const order = req.planOrder;
    const phoneNumber = req.body?.phone_number;
    if (!isPhoneNumber(phoneNumber) || req.body?.confirm_purchase !== true) {
      return res.status(400).json({ error: 'Select a number and confirm the purchase' });
    }
    if (!eligible(order) || order.customer_reference) return res.status(409).json({ error: 'Plan order is not eligible for another number purchase' });
    try {
      const available = await req.telnyx.search(order.country_code, phoneNumber).catch(() => null);
      if (!available) return res.status(502).json({ error: 'Telnyx number search failed' });
      if (!available.some(item => item.phone_number === phoneNumber)) {
        return res.status(409).json({ error: 'Number availability changed. Search again.' });
      }
      const reference = 'mar-khoor-' + randomUUID();
      try {
        const [claim] = await pool.execute(
          "INSERT INTO telnyx_number_orders (plan_order_id,phone_number,customer_reference) SELECT o.id,?,? FROM plan_orders o JOIN number_routes r ON r.country_code=o.country_code WHERE o.id=? AND o.status='provisioning' AND o.number_mode='new' AND r.provider='telnyx' AND r.mode='auto'",
          [phoneNumber, reference, order.id],
        );
        if (!claim.affectedRows) return res.status(409).json({ error: 'Plan order changed. Reload and review it.' });
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Number purchase has already been submitted' });
        throw error;
      }
      await audit(pool, { actorUserId: req.user.id, restaurantId: order.restaurant_id, action: 'telnyx.purchase:' + order.id });
      try {
        const result = await req.telnyx.order(phoneNumber, reference);
        res.status(201).json(await storeStatus({ ...order, phone_number: phoneNumber, customer_reference: reference }, result));
      } catch {
        console.warn(JSON.stringify({ event: 'telnyx_purchase_needs_review', plan_order_id: order.id }));
        res.status(502).json({ error: 'Purchase outcome is uncertain. Check Telnyx using the reference before taking further action.', customer_reference: reference });
      }
    } catch (error) { next(error); }
  });

  router.get(route, load, (req, res) => {
    const { customer_reference, phone_number, provider_order_id, provider_status } = req.planOrder;
    res.set('Cache-Control', 'no-store').json({ customer_reference, phone_number, provider_order_id, status: provider_status });
  });

  router.post(route + '/refresh', load, async (req, res) => {
    const order = req.planOrder;
    const id = order.provider_order_id ?? req.body?.provider_order_id;
    if (!order.customer_reference || typeof id !== 'string' || !providerIdPattern.test(id)) {
      return res.status(400).json({ error: 'Enter the matching Telnyx order ID' });
    }
    try {
      res.json(await storeStatus(order, await req.telnyx.status(id)));
    } catch {
      res.status(502).json({ error: 'Could not verify the matching Telnyx order' });
    }
  });
}
