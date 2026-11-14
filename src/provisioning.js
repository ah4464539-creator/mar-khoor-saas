// Human-confirmed phone number provisioning (no express import; testable with mocks).
// Flow: super admin searches candidates for a paid order, picks ONE number and confirms.
// Then: claim row -> Telnyx order -> (when Telnyx says success) import into Vapi bound to the
// restaurant's single active assistant. Nothing is bought without an explicit admin action.
import { randomUUID } from 'node:crypto';
import { searchNumbers, orderNumber, getOrderStatus, E164 } from './providers/telnyx.js';
import { importTelnyxNumber } from './providers/vapi-numbers.js';

const defaultDeps = () => ({ fetcher: fetch, telnyxKey: process.env.TELNYX_API_KEY, vapiKey: process.env.VAPI_API_KEY, credentialId: process.env.VAPI_TELNYX_CREDENTIAL_ID });
const fail = (status, error) => ({ status, body: { error } });
const configured = d => Boolean(d.telnyxKey && d.vapiKey && d.credentialId);

async function loadContext(pool, orderId) {
  if (!Number.isSafeInteger(orderId) || orderId < 1) return { error: fail(400, 'Invalid order') };
  const [orders] = await pool.execute('SELECT id,restaurant_id,country_code,number_mode,status FROM plan_orders WHERE id=? LIMIT 1', [orderId]);
  const order = orders[0];
  if (!order) return { error: fail(404, 'Order not found') };
  if (order.number_mode !== 'new') return { error: fail(409, 'This order did not ask for a new number') };
  if (!['paid', 'provisioning'].includes(order.status)) return { error: fail(409, 'Confirm payment first: the order must be paid or provisioning') };
  const [routes] = await pool.execute('SELECT provider,mode FROM number_routes WHERE country_code=? LIMIT 1', [order.country_code]);
  if (!routes.length || routes[0].provider !== 'telnyx' || routes[0].mode !== 'manual') return { error: fail(409, 'This country is not routed to Telnyx') };
  return { order };
}

export async function listCandidates(pool, orderId, deps = defaultDeps()) {
  const ctx = await loadContext(pool, orderId);
  if (ctx.error) return ctx.error;
  if (!deps.telnyxKey) return fail(503, 'Telnyx key is not configured');
  try {
    const candidates = await searchNumbers({ apiKey: deps.telnyxKey, country: ctx.order.country_code, fetcher: deps.fetcher });
    return { status: 200, body: { country: ctx.order.country_code, candidates } };
  } catch (error) { return fail(502, 'Telnyx search failed: ' + error.message); }
}

async function importStep(pool, row, assistantId, deps) {
  try {
    const imported = await importTelnyxNumber({ apiKey: deps.vapiKey, credentialId: deps.credentialId, number: row.phone_number, assistantId, name: 'MarKhoor ' + row.restaurant_id, fetcher: deps.fetcher });
    await pool.execute("UPDATE restaurant_numbers SET status='active',vapi_phone_id=?,last_error=NULL WHERE id=?", [imported.id, row.id]);
    await pool.execute("UPDATE plan_orders SET status='provisioning' WHERE id=? AND status='paid'", [row.plan_order_id]);
    return { status: 200, body: { number_id: row.id, phone_number: row.phone_number, status: 'active' } };
  } catch (error) {
    await pool.execute("UPDATE restaurant_numbers SET status='import_failed',last_error=? WHERE id=?", [String(error.message).slice(0, 255), row.id]);
    return fail(502, 'The number was ordered but importing it into Vapi failed: ' + error.message + '. Use Retry import.');
  }
}

async function singleAssistant(pool, restaurantId) {
  const [rows] = await pool.execute('SELECT assistant_id FROM voice_assistants WHERE restaurant_id=? AND active=1 LIMIT 2', [restaurantId]);
  return rows.length === 1 ? rows[0].assistant_id : null;
}

export async function purchaseNumber(pool, orderId, phoneNumber, deps = defaultDeps()) {
  if (typeof phoneNumber !== 'string' || !E164.test(phoneNumber)) return fail(400, 'Invalid phone number');
  const ctx = await loadContext(pool, orderId);
  if (ctx.error) return ctx.error;
  const { order } = ctx;
  if (!configured(deps)) return fail(503, 'Telnyx and Vapi keys are not configured');
  const assistantId = await singleAssistant(pool, order.restaurant_id);
  if (!assistantId) return fail(409, 'Map exactly one active Vapi assistant to this restaurant first');

  let rowId;
  try {
    const [claim] = await pool.execute("INSERT INTO restaurant_numbers(restaurant_id,plan_order_id,country_code,phone_number,provider,status) VALUES (?,?,?,?,'telnyx','ordering')", [order.restaurant_id, order.id, order.country_code, phoneNumber]);
    rowId = claim.insertId;
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return fail(409, 'This order already has a number, or that number is already taken');
    return fail(503, 'Database unavailable');
  }
  const row = { id: rowId, restaurant_id: order.restaurant_id, plan_order_id: order.id, phone_number: phoneNumber };

  const reference = 'mar-khoor-' + order.id + '-' + randomUUID();
  let ordered;
  try {
    ordered = await orderNumber({ apiKey: deps.telnyxKey, phoneNumber, requirementGroupId: process.env['TELNYX_REQUIREMENT_GROUP_' + order.country_code], customerReference: reference, fetcher: deps.fetcher });
  } catch (error) {
    if (error.providerStatus) {
      // Telnyx answered with an error: nothing was bought.
      await pool.execute("UPDATE restaurant_numbers SET status='failed',last_error=? WHERE id=?", [String(error.message).slice(0, 255), rowId]);
      return fail(502, 'Telnyx order failed: ' + error.message);
    }
    // No answer (timeout/network): the order may or may not exist. Keep the claim so it cannot be bought twice.
    await pool.execute("UPDATE restaurant_numbers SET last_error=? WHERE id=?", [('Outcome unknown. Check Telnyx for reference ' + reference).slice(0, 255), rowId]);
    console.warn(JSON.stringify({ event: 'telnyx_purchase_needs_review', plan_order_id: order.id }));
    return { status: 502, body: { error: 'Telnyx did not answer, so the purchase outcome is unknown. Check the Telnyx portal for reference ' + reference + ' before doing anything else.', customer_reference: reference } };
  }
  await pool.execute('UPDATE restaurant_numbers SET provider_order_id=? WHERE id=?', [ordered.orderId, rowId]);
  if (ordered.status !== 'success') {
    await pool.execute("UPDATE restaurant_numbers SET status='pending_provider' WHERE id=?", [rowId]);
    return { status: 202, body: { number_id: rowId, phone_number: phoneNumber, status: 'pending_provider', note: 'Telnyx has not activated this number yet (documents may be required). Use Retry import later.' } };
  }
  return importStep(pool, row, assistantId, deps);
}

// Re-checks the Telnyx order and finishes the Vapi import if the number is now active.
export async function retryNumber(pool, numberId, deps = defaultDeps()) {
  if (!Number.isSafeInteger(numberId) || numberId < 1) return fail(400, 'Invalid number');
  if (!configured(deps)) return fail(503, 'Telnyx and Vapi keys are not configured');
  const [rows] = await pool.execute('SELECT id,restaurant_id,plan_order_id,phone_number,provider_order_id,status FROM restaurant_numbers WHERE id=? LIMIT 1', [numberId]);
  const row = rows[0];
  if (!row) return fail(404, 'Number not found');
  if (!['pending_provider', 'import_failed'].includes(row.status) || !row.provider_order_id) return fail(409, 'Nothing to retry for this number');
  const assistantId = await singleAssistant(pool, row.restaurant_id);
  if (!assistantId) return fail(409, 'Map exactly one active Vapi assistant to this restaurant first');
  let status;
  try { status = await getOrderStatus({ apiKey: deps.telnyxKey, orderId: row.provider_order_id, fetcher: deps.fetcher }); }
  catch (error) { return fail(502, 'Telnyx status check failed: ' + error.message); }
  if (status === 'failure' || status === 'cancelled' || status === 'deleted') {
    await pool.execute("UPDATE restaurant_numbers SET status='failed',last_error=? WHERE id=?", ['Telnyx order ' + status, row.id]);
    return fail(409, 'Telnyx order ended as ' + status);
  }
  if (status !== 'success') return { status: 202, body: { number_id: row.id, status: 'pending_provider', telnyx_status: status } };
  return importStep(pool, row, assistantId, deps);
}
