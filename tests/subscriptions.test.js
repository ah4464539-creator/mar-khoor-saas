import test from 'node:test';
import assert from 'node:assert/strict';
import { planCatalog, validateSubscriptionChoice, warningLevel, usageSummary, nextPlan, usagePeriod, chooseSubscription, recordUsage, getUsage, FEATURES } from '../src/subscriptions.js';

test('every plan includes every feature; plans differ only by limits', () => {
  const plans = planCatalog('PKR', { pricesJson: '', limitsJson: '' });
  assert.deepEqual(plans.map(p => p.key), ['starter', 'premium', 'enterprise']);
  for (const plan of plans) assert.deepEqual(plan.features, [...FEATURES]);
  assert.ok(plans[0].limits.ai_chats < plans[1].limits.ai_chats && plans[1].limits.ai_chats < plans[2].limits.ai_chats);
});

test('owner-approved USD prices, limits and number add-on are the defaults', () => {
  const plans = planCatalog('USD', { pricesJson: '', limitsJson: '' });
  assert.deepEqual(plans.map(p => [p.key, p.price_minor.monthly, p.price_minor.yearly]), [['starter', 3900, 39000], ['premium', 19900, 199000], ['enterprise', 59900, 599000]]);
  assert.deepEqual(plans.map(p => [p.limits.ai_chats, p.limits.whatsapp_messages, p.limits.ai_call_minutes]), [[1500, 1000, 100], [5000, 3000, 400], [15000, 8000, 1200]]);
  assert.deepEqual(plans.map(p => [p.dedicated_number.included, p.dedicated_number.addon_price_minor]), [[false, 4900], [true, null], [true, null]]);
  assert.equal(plans[0].converted, false);
});

test('prices convert automatically to the restaurant currency with clean rounding', () => {
  const fx = { rates: { USD: 1, PKR: 280.37, AED: 3.6725, KWD: 0.3071 } };
  const pkr = planCatalog('PKR', { pricesJson: '', limitsJson: '', fx });
  assert.equal(pkr[0].currency, 'PKR');
  assert.equal(pkr[0].price_minor.monthly, 1090000, '39 x 280.37 = 10,934 -> PKR 10,900');
  assert.equal(pkr[1].price_minor.monthly, 5580000, '199 x 280.37 = 55,794 -> PKR 55,800');
  assert.equal(pkr[0].dedicated_number.addon_price_minor, 1370000, '49 x 280.37 = 13,738 -> PKR 13,700');
  assert.equal(pkr[0].base_price_minor.monthly, 3900);
  assert.equal(pkr[0].converted, true);
  assert.equal(planCatalog('AED', { pricesJson: '', fx })[0].price_minor.monthly, 14000, '39 x 3.6725 = 143.2 -> AED 140');
  assert.equal(planCatalog('KWD', { pricesJson: '', fx })[0].price_minor.monthly, 1200, '39 x 0.3071 = 11.98 -> KWD 12');
});

test('without an exchange rate prices are shown in USD, never invented', () => {
  const plans = planCatalog('PKR', { pricesJson: '', limitsJson: '', fx: null });
  assert.equal(plans[0].currency, 'USD');
  assert.equal(plans[0].price_minor.monthly, 3900);
  assert.equal(plans[0].converted, false);
});

test('prices and limits come from configuration for the restaurant currency only', () => {
  const pricesJson = JSON.stringify({ PKR: { starter: { monthly: 500000, yearly: 5000000 } }, USD: { starter: { monthly: 1900 } } });
  const plans = planCatalog('PKR', { pricesJson, limitsJson: JSON.stringify({ starter: { ai_chats: 999, whatsapp_messages: -5 } }) });
  assert.deepEqual(plans[0].price_minor, { monthly: 500000, yearly: 5000000 });
  assert.equal(plans[0].limits.ai_chats, 999);
  assert.equal(plans[0].limits.whatsapp_messages, 1000, 'invalid override ignored');
  assert.equal(plans[0].converted, false, 'explicit local prices are not conversions');
  assert.deepEqual(planCatalog('AED', { pricesJson })[0].price_minor, { monthly: 1900, yearly: 39000 }, 'no AED price or rate: USD (with the USD override)');
  assert.equal(planCatalog('AED', { pricesJson })[0].currency, 'USD');
  assert.deepEqual(planCatalog('USD', { pricesJson })[0].price_minor, { monthly: 1900, yearly: 39000 }, 'USD override wins over default');
  assert.deepEqual(planCatalog('USD', { pricesJson: '{broken' })[0].price_minor, { monthly: 3900, yearly: 39000 });
});

test('plan choice validation', () => {
  assert.deepEqual(validateSubscriptionChoice({ plan: 'premium', billing_cycle: 'yearly' }).value, { plan: 'premium', cycle: 'yearly' });
  assert.ok(validateSubscriptionChoice({ plan: 'gold', billing_cycle: 'monthly' }).error);
  assert.ok(validateSubscriptionChoice({ plan: 'starter', billing_cycle: 'weekly' }).error);
  assert.ok(validateSubscriptionChoice(null).error);
});

test('warnings at 75, 90 and 100 percent; service is never blocked', () => {
  assert.equal(warningLevel(74, 100), 0);
  assert.equal(warningLevel(75, 100), 75);
  assert.equal(warningLevel(90, 100), 90);
  assert.equal(warningLevel(100, 100), 100);
  assert.equal(warningLevel(250, 100), 100);
  assert.equal(warningLevel(5, 0), 0);
  const [chats] = usageSummary('starter', { ai_chats: 300, whatsapp_messages: 100, ai_call_minutes: 30 }, { ai_chats: 330 });
  assert.equal(chats.warning, 100);
  assert.equal(chats.overage, 30);
  assert.equal(chats.suggestion, 'upgrade_to_premium');
  assert.equal(nextPlan('enterprise'), null);
  assert.equal(usageSummary('enterprise', { ai_chats: 10 }, { ai_chats: 10 })[0].suggestion, null);
});

test('usage period is the UTC month', () => {
  assert.equal(usagePeriod(new Date('2026-11-30T23:30:00Z')), '2026-11');
});

function fakePool({ currency = 'PKR', restaurant = true } = {}) {
  const state = { subscription: null, counters: new Map(), executed: [] };
  return { state, async execute(sql, args) {
    state.executed.push(sql);
    if (sql.startsWith('SELECT currency FROM restaurants')) return [restaurant ? [{ currency }] : []];
    if (sql.startsWith('INSERT INTO restaurant_subscriptions')) {
      const [restaurant_id, plan_key, billing_cycle, limits, cur, price_minor] = args;
      state.subscription = { restaurant_id, plan_key, billing_cycle, status: 'pending_payment', limits, currency: cur, price_minor };
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT plan_key')) return [state.subscription && args[0] === state.subscription.restaurant_id ? [state.subscription] : []];
    if (sql.startsWith('INSERT INTO usage_counters')) {
      const key = args.slice(0, 3).join('|');
      state.counters.set(key, (state.counters.get(key) || 0) + args[3]);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT metric,used')) {
      return [[...state.counters].filter(([k]) => k.startsWith(args[0] + '|' + args[1] + '|')).map(([k, used]) => ({ metric: k.split('|')[2], used }))];
    }
    throw Error('unexpected ' + sql);
  } };
}

test('a converted price is locked in the shown currency when the plan is chosen', async () => {
  const pool = fakePool();
  const result = await chooseSubscription(pool, 7, { plan: 'starter', billing_cycle: 'monthly' }, { pricesJson: '', limitsJson: '', fx: { rates: { USD: 1, PKR: 280.37 } } });
  assert.equal(result.body.subscription.currency, 'PKR');
  assert.equal(result.body.subscription.price_minor, 1090000);
  const noRate = await chooseSubscription(pool, 7, { plan: 'starter', billing_cycle: 'monthly' }, { pricesJson: '', limitsJson: '', fx: null });
  assert.equal(noRate.body.subscription.currency, 'USD');
  assert.equal(noRate.body.subscription.price_minor, 3900);
});

test('choosing a plan snapshots server limits and price for the restaurant currency', async () => {
  const pool = fakePool();
  const pricesJson = JSON.stringify({ PKR: { premium: { monthly: 900000 } } });
  const result = await chooseSubscription(pool, 7, { plan: 'premium', billing_cycle: 'monthly', price_minor: 1, limits: { ai_chats: 999999 } }, { pricesJson, limitsJson: '' });
  assert.equal(result.status, 200);
  assert.equal(result.body.price_confirmed, true);
  assert.equal(result.body.subscription.price_minor, 900000);
  assert.equal(result.body.subscription.status, 'pending_payment');
  assert.equal(result.body.subscription.limits.ai_chats, 5000, 'client-supplied limits ignored');
  assert.equal(result.body.subscription.currency, 'PKR');
  const yearly = await chooseSubscription(pool, 7, { plan: 'premium', billing_cycle: 'yearly' }, { pricesJson, limitsJson: '' });
  assert.equal(yearly.body.price_confirmed, false);
  assert.equal(yearly.body.subscription.price_minor, null);
});

test('plan choice errors: invalid input, unknown restaurant, database down', async () => {
  assert.equal((await chooseSubscription(fakePool(), 7, { plan: 'x', billing_cycle: 'monthly' })).status, 400);
  assert.equal((await chooseSubscription(fakePool({ restaurant: false }), 7, { plan: 'starter', billing_cycle: 'monthly' })).status, 404);
  assert.equal((await chooseSubscription({ execute: async () => { throw Error('down'); } }, 7, { plan: 'starter', billing_cycle: 'monthly' })).status, 503);
});

test('usage is recorded per restaurant and month and reported with warnings', async () => {
  const pool = fakePool();
  await chooseSubscription(pool, 7, { plan: 'starter', billing_cycle: 'monthly' }, { pricesJson: '', limitsJson: '' });
  const now = new Date('2026-11-18T12:00:00Z');
  for (let i = 0; i < 230; i++) assert.equal(await recordUsage(pool, 7, 'ai_chats', 1, now), true);
  await recordUsage(pool, 8, 'ai_chats', 50, now);
  await recordUsage(pool, 7, 'ai_chats', 999, new Date('2026-10-01T00:00:00Z'));
  const usage = await getUsage(pool, 7, now);
  let chats = usage.usage.find(u => u.metric === 'ai_chats');
  assert.equal(chats.used, 230, 'other restaurants and months are not counted');
  assert.equal(chats.warning, 0);
  await recordUsage(pool, 7, 'ai_chats', 900, now);
  chats = (await getUsage(pool, 7, now)).usage.find(u => u.metric === 'ai_chats');
  assert.equal(chats.used, 1130);
  assert.equal(chats.warning, 75);
});

test('metering never throws and rejects bad input', async () => {
  const broken = { execute: async () => { throw Error('down'); } };
  assert.equal(await recordUsage(broken, 7, 'ai_chats'), false);
  assert.equal(await recordUsage(fakePool(), 7, 'unknown_metric'), false);
  assert.equal(await recordUsage(fakePool(), 0, 'ai_chats'), false);
  assert.equal(await recordUsage(fakePool(), 7, 'ai_chats', -3), false);
});
