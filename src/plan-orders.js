// Plan "cart" logic: builds a server-side quote for a restaurant and stores it as an order.
// No express import here, so it can be tested with a mock pool.
import { quotePlan, readCatalog } from './plan-quote.js';
import { catalogWithRoutes, isOrderable, orderTotals, NEXT_STATUS } from './number-routes.js';

// strict=true throws when routes cannot be read (orders must never use a partial price list).
export async function loadCatalog(pool, { strict = false } = {}) {
  const base = readCatalog(process.env.PLAN_CATALOG_JSON);
  try {
    const [rows] = await pool.query('SELECT country_code,mode,monthly_minor,setup_minor FROM number_routes');
    return catalogWithRoutes(base, rows);
  } catch (error) {
    if (strict) throw error;
    return base;
  }
}

const parseQuote = text => { try { return JSON.parse(text); } catch { return null; } };
const present = row => ({ ...row, features: String(row.features).split(','), quote: parseQuote(row.quote) });

// The country always comes from the restaurant's own record, never from the request.
export async function createPlanOrder(pool, restaurantId, body) {
  const { features, numberMode = 'existing' } = body ?? {};
  if (!Array.isArray(features) || features.some(key => typeof key !== 'string')) return { status: 400, body: { error: 'Select valid services' } };
  try {
    const [restaurants] = await pool.execute('SELECT country_code FROM restaurants WHERE id=? LIMIT 1', [restaurantId]);
    if (!restaurants.length) return { status: 404, body: { error: 'Restaurant not found' } };
    const selected = [...new Set(features)];
    const wantsNumber = selected.includes('voice') && numberMode === 'new';
    let quote;
    try {
      quote = quotePlan({ country: restaurants[0].country_code, features: selected, numberMode: wantsNumber ? 'new' : 'existing' }, await loadCatalog(pool, { strict: true }));
    } catch (error) {
      if (error instanceof TypeError) return { status: 400, body: { error: error.message } };
      throw error;
    }
    if (!isOrderable(quote)) return { status: 409, body: { error: 'Some selected services have no confirmed price or are unavailable in your country yet', quote } };
    const [open] = await pool.execute("SELECT id FROM plan_orders WHERE restaurant_id=? AND status IN ('pending_payment','paid','provisioning') LIMIT 1", [restaurantId]);
    if (open.length) return { status: 409, body: { error: 'You already have an open order', order_id: open[0].id } };
    const totals = orderTotals(quote);
    const [created] = await pool.execute(
      'INSERT INTO plan_orders(restaurant_id,country_code,features,number_mode,quote,monthly_minor,first_payment_minor) VALUES (?,?,?,?,?,?,?)',
      [restaurantId, restaurants[0].country_code, selected.join(','), wantsNumber ? 'new' : 'existing', JSON.stringify(quote), totals.monthly, totals.firstPayment]
    );
    return { status: 201, body: { order_id: created.insertId, status: 'pending_payment', monthly_minor: totals.monthly, first_payment_minor: totals.firstPayment, quote } };
  } catch {
    return { status: 503, body: { error: 'Orders unavailable' } };
  }
}

export async function listPlanOrders(pool, { restaurantId = null } = {}) {
  const [rows] = restaurantId === null
    ? await pool.query('SELECT o.id,o.restaurant_id,r.name AS restaurant_name,o.country_code,o.features,o.number_mode,o.quote,o.monthly_minor,o.first_payment_minor,o.status,o.created_at FROM plan_orders o JOIN restaurants r ON r.id=o.restaurant_id ORDER BY o.id DESC LIMIT 200')
    : await pool.execute('SELECT id,restaurant_id,country_code,features,number_mode,quote,monthly_minor,first_payment_minor,status,created_at FROM plan_orders WHERE restaurant_id=? ORDER BY id DESC LIMIT 50', [restaurantId]);
  return rows.map(present);
}

// Moves an order forward. The UPDATE re-checks the previous status so two admins cannot race.
export async function changeOrderStatus(pool, orderId, status, { restaurantId = null, onlyFrom = null } = {}) {
  if (!Number.isSafeInteger(orderId) || orderId < 1 || typeof status !== 'string') return { status: 400, body: { error: 'Invalid order' } };
  try {
    const [rows] = restaurantId === null
      ? await pool.execute('SELECT status FROM plan_orders WHERE id=? LIMIT 1', [orderId])
      : await pool.execute('SELECT status FROM plan_orders WHERE id=? AND restaurant_id=? LIMIT 1', [orderId, restaurantId]);
    if (!rows.length) return { status: 404, body: { error: 'Order not found' } };
    const current = rows[0].status;
    if (onlyFrom !== null && current !== onlyFrom) return { status: 409, body: { error: 'This order can no longer be changed here', current } };
    if (!(NEXT_STATUS[current] ?? []).includes(status)) return { status: 409, body: { error: 'This status change is not allowed', current } };
    const [result] = await pool.execute('UPDATE plan_orders SET status=? WHERE id=? AND status=?', [status, orderId, current]);
    if (!result.affectedRows) return { status: 409, body: { error: 'Order changed; reload and retry' } };
    return { status: 200, body: { order_id: orderId, status } };
  } catch {
    return { status: 503, body: { error: 'Orders unavailable' } };
  }
}
