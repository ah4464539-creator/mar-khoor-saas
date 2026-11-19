// Automatic AI Caller number for paid subscriptions (no express import; testable with mocks).
//
// Runs when the super admin confirms a subscription payment (status -> active) for a plan that
// includes a dedicated number (Premium, Enterprise). Steps, each safe to repeat:
//   1. make sure the restaurant has exactly one active Vapi assistant (copy the template if none);
//   2. if the restaurant has no number yet, search Telnyx in its country and pick the first number
//      whose provider cost is known and within the configured caps;
//   3. claim it in restaurant_numbers (one subscription number per restaurant, enforced by a unique
//      key), order it from Telnyx, and import it into Vapi bound to the assistant.
// Countries that need documents leave the number "pending provider"; the retry job finishes it.
// This spends real money: it only runs for an active, paid subscription, never twice per restaurant.
import { randomUUID } from 'node:crypto';
import { searchNumbers, orderNumber, E164 } from './providers/telnyx.js';
import { importTelnyxNumber, findTelnyxCredential } from './providers/vapi-numbers.js';
import { cloneAssistant } from './providers/vapi-assistants.js';
import { retryNumber } from './provisioning.js';
import { planCatalog } from './subscriptions.js';

export function autoProvisionDeps(env = process.env) {
  const cap = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  return {
    fetcher: fetch,
    telnyxKey: env.TELNYX_API_KEY,
    vapiKey: env.VAPI_API_KEY,
    credentialId: env.VAPI_TELNYX_CREDENTIAL_ID,
    templateAssistantId: env.VAPI_TEMPLATE_ASSISTANT_ID,
    maxMonthlyUsd: cap(env.TELNYX_MAX_MONTHLY_USD, 15),
    maxUpfrontUsd: cap(env.TELNYX_MAX_UPFRONT_USD, 15),
    requirementGroup: country => env['TELNYX_REQUIREMENT_GROUP_' + country],
  };
}

export function missingConfig(deps) {
  const missing = [];
  if (!deps.telnyxKey) missing.push('TELNYX_API_KEY');
  if (!deps.vapiKey) missing.push('VAPI_API_KEY');
  if (!deps.templateAssistantId) missing.push('VAPI_TEMPLATE_ASSISTANT_ID');
  return missing;
}

export function includesNumber(planKey) {
  return Boolean(planCatalog('USD').find(plan => plan.key === planKey)?.dedicated_number?.included);
}

// Picks the first candidate whose cost is known, in USD and within the caps. Unknown cost = skip.
export function pickNumber(candidates, { maxMonthlyUsd, maxUpfrontUsd }) {
  for (const item of candidates) {
    if (!E164.test(item.phone_number || '')) continue;
    if (item.currency !== 'USD') continue;
    const known = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
    if (!known(item.monthly_cost)) continue; // a number whose monthly cost Telnyx does not state is never bought
    if (item.upfront_cost != null && !known(item.upfront_cost)) continue;
    const monthly = Number(item.monthly_cost), upfront = Number(item.upfront_cost ?? 0);
    if (monthly < 0 || upfront < 0) continue;
    if (monthly <= maxMonthlyUsd && upfront <= maxUpfrontUsd) return item;
  }
  return null;
}

const result = (status, detail, extra = {}) => ({ status, detail, ...extra });

async function markCaller(pool, restaurantId, status, detail) {
  // Reflect the outcome in the restaurant's setup box (only if they chose the AI Caller).
  await pool.execute("UPDATE restaurant_integrations SET status=?,detail=? WHERE restaurant_id=? AND kind='ai_caller' AND status<>'skipped'",
    [status, detail.slice(0, 500), restaurantId]).catch(() => {});
}

async function ensureAssistant(pool, restaurant, deps) {
  const [rows] = await pool.execute('SELECT assistant_id FROM voice_assistants WHERE restaurant_id=? AND active=1 LIMIT 2', [restaurant.id]);
  if (rows.length === 1) return rows[0].assistant_id;
  if (rows.length > 1) throw Object.assign(Error('This restaurant has more than one active voice assistant; keep one in Voice integrations'), { needsReview: true });
  const created = await cloneAssistant({ apiKey: deps.vapiKey, templateId: deps.templateAssistantId, name: 'MarKhoor ' + restaurant.id + ' ' + restaurant.name, restaurantId: restaurant.id, restaurantName: restaurant.name, fetcher: deps.fetcher });
  await pool.execute('INSERT INTO voice_assistants(assistant_id,restaurant_id,active) VALUES (?,?,TRUE)', [created.id, restaurant.id]);
  return created.id;
}

// VAPI_TELNYX_CREDENTIAL_ID is optional: without it the Telnyx credential saved in the Vapi
// dashboard is looked up once and reused.
let discoveredCredential = null;
async function withCredential(deps) {
  if (deps.credentialId) return deps;
  if (!discoveredCredential) discoveredCredential = await findTelnyxCredential({ apiKey: deps.vapiKey, fetcher: deps.fetcher });
  return { ...deps, credentialId: discoveredCredential };
}
export function resetDiscoveredCredential() { discoveredCredential = null; }

export async function provisionSubscriptionNumber(pool, restaurantId, baseDeps = autoProvisionDeps()) {
  const missing = missingConfig(baseDeps);
  if (missing.length) return result('not_configured', 'Automatic numbers are off until these server settings are added: ' + missing.join(', ') + '.');
  let deps;
  try { deps = await withCredential(baseDeps); }
  catch (error) { return result('not_configured', error.message); }

  const [subs] = await pool.execute('SELECT plan_key,status FROM restaurant_subscriptions WHERE restaurant_id=? LIMIT 1', [restaurantId]);
  const sub = subs[0];
  if (!sub || sub.status !== 'active') return result('skipped', 'The subscription is not active (payment not confirmed).');
  if (!includesNumber(sub.plan_key)) return result('skipped', 'This plan does not include a dedicated AI number.');

  const [restaurants] = await pool.execute('SELECT id,name,country_code FROM restaurants WHERE id=? LIMIT 1', [restaurantId]);
  const restaurant = restaurants[0];
  if (!restaurant) return result('failed', 'Restaurant not found.');

  // Already has a number (inventory, earlier purchase, or one in progress)? Never buy a second one.
  const [inventory] = await pool.execute('SELECT phone_number FROM registration_voice_inventory WHERE restaurant_id=? LIMIT 1', [restaurantId]);
  if (inventory.length) return result('active', 'AI Caller number ' + inventory[0].phone_number + ' is already assigned.', { phone_number: inventory[0].phone_number });
  const [existing] = await pool.execute("SELECT id,phone_number,status FROM restaurant_numbers WHERE restaurant_id=? AND status<>'failed' ORDER BY id DESC LIMIT 1", [restaurantId]);
  if (existing.length) {
    const row = existing[0];
    if (row.status === 'active') return result('active', 'AI Caller number ' + row.phone_number + ' is active.', { phone_number: row.phone_number });
    if (['pending_provider', 'import_failed'].includes(row.status)) return finishPending(pool, restaurantId, row, deps);
    return result('needs_review', 'A purchase for ' + row.phone_number + ' is in progress or its outcome is unknown. Check the Telnyx portal before doing anything else.');
  }

  const [routes] = await pool.execute('SELECT provider,mode FROM number_routes WHERE country_code=? LIMIT 1', [restaurant.country_code]);
  if (!routes.length || routes[0].provider !== 'telnyx' || routes[0].mode === 'unavailable')
    return result('unavailable', 'Automatic numbers are not set up for ' + restaurant.country_code + ' yet. Add a Telnyx route for this country in "Phone numbers by country".');

  let assistantId;
  try { assistantId = await ensureAssistant(pool, restaurant, deps); }
  catch (error) { return result(error.needsReview ? 'needs_review' : 'failed', 'Could not prepare the voice assistant: ' + error.message); }

  let candidates;
  try { candidates = await searchNumbers({ apiKey: deps.telnyxKey, country: restaurant.country_code, limit: 10, fetcher: deps.fetcher }); }
  catch (error) { return result('failed', 'Telnyx search failed: ' + error.message + '. It will be retried.'); }
  const choice = pickNumber(candidates, deps);
  if (!choice) return result('unavailable', 'No Telnyx number in ' + restaurant.country_code + ' fits the cost limit (US$' + deps.maxMonthlyUsd + '/month, US$' + deps.maxUpfrontUsd + ' upfront). Raise TELNYX_MAX_MONTHLY_USD or buy one by hand.');

  let rowId;
  try {
    const [claim] = await pool.execute(
      "INSERT INTO restaurant_numbers(restaurant_id,plan_order_id,subscription_restaurant_id,country_code,phone_number,provider,status) VALUES (?,NULL,?,?,?,'telnyx','ordering')",
      [restaurantId, restaurantId, restaurant.country_code, choice.phone_number]);
    rowId = claim.insertId;
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return result('needs_review', 'A subscription number already exists for this restaurant or that number is taken.');
    return result('failed', 'Database unavailable.');
  }

  const reference = 'mar-khoor-sub-' + restaurantId + '-' + randomUUID();
  let ordered;
  try {
    ordered = await orderNumber({ apiKey: deps.telnyxKey, phoneNumber: choice.phone_number, requirementGroupId: deps.requirementGroup(restaurant.country_code), customerReference: reference, fetcher: deps.fetcher });
  } catch (error) {
    if (error.providerStatus) {
      // Telnyx answered with an error: nothing was bought. Free the slot so a later run can try again.
      await pool.execute("UPDATE restaurant_numbers SET status='failed',subscription_restaurant_id=NULL,last_error=? WHERE id=?", [String(error.message).slice(0, 255), rowId]);
      return result('failed', 'Telnyx did not sell ' + choice.phone_number + ': ' + error.message);
    }
    // No answer: the purchase may exist. Keep the claim so nothing is bought twice.
    await pool.execute('UPDATE restaurant_numbers SET last_error=? WHERE id=?', [('Outcome unknown. Check Telnyx for reference ' + reference).slice(0, 255), rowId]);
    console.warn(JSON.stringify({ event: 'telnyx_auto_purchase_needs_review', restaurant_id: restaurantId }));
    return result('needs_review', 'Telnyx did not answer; check the Telnyx portal for reference ' + reference + '.', { customer_reference: reference });
  }
  await pool.execute('UPDATE restaurant_numbers SET provider_order_id=? WHERE id=?', [ordered.orderId, rowId]);
  const row = { id: rowId, restaurant_id: restaurantId, plan_order_id: null, phone_number: choice.phone_number };
  if (ordered.status !== 'success') {
    await pool.execute("UPDATE restaurant_numbers SET status='pending_provider' WHERE id=?", [rowId]);
    const detail = 'Number ' + choice.phone_number + ' is reserved; the phone company is still activating it (documents may be needed). It connects automatically when ready.';
    await markCaller(pool, restaurantId, 'pending', detail);
    return result('pending_provider', detail, { phone_number: choice.phone_number });
  }
  try {
    const imported = await importTelnyxNumber({ apiKey: deps.vapiKey, credentialId: deps.credentialId, number: choice.phone_number, assistantId, name: 'MarKhoor ' + restaurantId, fetcher: deps.fetcher });
    await pool.execute("UPDATE restaurant_numbers SET status='active',vapi_phone_id=?,last_error=NULL WHERE id=?", [imported.id, rowId]);
  } catch (error) {
    await pool.execute("UPDATE restaurant_numbers SET status='import_failed',last_error=? WHERE id=?", [String(error.message).slice(0, 255), rowId]);
    return result('import_failed', 'Number ' + choice.phone_number + ' was bought but connecting it to the AI failed: ' + error.message + '. It will be retried.', { phone_number: row.phone_number });
  }
  const detail = 'AI Caller is answering on ' + choice.phone_number + '. Forward your restaurant calls to it, or share it with customers.';
  await markCaller(pool, restaurantId, 'connected', detail);
  return result('active', detail, { phone_number: choice.phone_number });
}

async function finishPending(pool, restaurantId, row, deps) {
  const outcome = await retryNumber(pool, row.id, { fetcher: deps.fetcher, telnyxKey: deps.telnyxKey, vapiKey: deps.vapiKey, credentialId: deps.credentialId });
  if (outcome.status === 200) {
    const detail = 'AI Caller is answering on ' + row.phone_number + '. Forward your restaurant calls to it, or share it with customers.';
    await markCaller(pool, restaurantId, 'connected', detail);
    return result('active', detail, { phone_number: row.phone_number });
  }
  if (outcome.status === 202) return result('pending_provider', 'Number ' + row.phone_number + ' is still being activated by the phone company.', { phone_number: row.phone_number });
  return result('failed', outcome.body?.error || 'Retry failed.', { phone_number: row.phone_number });
}

// Background job: finishes subscription numbers that were waiting on the phone company or the
// Vapi import. Small batches; never buys anything new.
export async function retryPendingSubscriptionNumbers(pool, baseDeps = autoProvisionDeps(), limit = 10) {
  if (missingConfig(baseDeps).length) return [];
  let deps;
  try { deps = await withCredential(baseDeps); } catch { return []; }
  const [rows] = await pool.execute(
    "SELECT id,restaurant_id,phone_number,status FROM restaurant_numbers WHERE subscription_restaurant_id IS NOT NULL AND status IN ('pending_provider','import_failed') ORDER BY updated_at LIMIT " + Math.min(Math.max(Number(limit) || 10, 1), 50));
  const outcomes = [];
  for (const row of rows) {
    try { outcomes.push({ id: row.id, ...(await finishPending(pool, row.restaurant_id, row, deps)) }); }
    catch { outcomes.push({ id: row.id, status: 'failed' }); }
  }
  return outcomes;
}
