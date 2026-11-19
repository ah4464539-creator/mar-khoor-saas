import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { onboardingRouter } from '../src/onboarding.js';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

async function withServer(loadRates, fn) {
  const app = express(); app.use(express.json());
  app.use('/api', onboardingRouter({ execute: async () => [[]] }, { loadRates, assignVoiceNumber: async () => ({ status: 'pending' }) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { return await fn('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('public plans list the real catalog in the country currency without login', async () => {
  await withServer(async () => ({ rates: { USD: 1, PKR: 280 }, asOf: 'today', source: 'exchangerate-api' }), async base => {
    const pk = await (await fetch(base + '/api/public/plans?country=PK')).json();
    assert.deepEqual(pk.plans.map(plan => plan.key), ['starter', 'premium', 'enterprise']);
    assert.equal(pk.plans[0].currency, 'PKR');
    assert.equal(pk.plans[0].base_price_minor.monthly, 3900);
    assert.ok(pk.plans[0].price_minor.monthly > 1000000, 'converted to rupees');
    assert.equal(pk.exchange.attribution.name, 'ExchangeRate-API');
    const usd = await (await fetch(base + '/api/public/plans')).json();
    assert.equal(usd.plans[1].currency, 'USD');
    assert.equal(usd.plans[1].price_minor.monthly, 19900);
    const bad = await (await fetch(base + '/api/public/plans?country=pk-evil')).json();
    assert.equal(bad.country, null);
  });
});

test('public plans fall back to USD when no exchange rate is available', async () => {
  await withServer(async () => null, async base => {
    const data = await (await fetch(base + '/api/public/plans?country=PK')).json();
    assert.equal(data.plans[0].currency, 'USD');
    assert.equal(data.exchange, null);
  });
});

test('build-plan page uses the real plans and hands the choice to registration', () => {
  const html = read('public/build-plan.html'), js = read('public/build-plan.js'), home = read('public/index.html');
  for (const id of ['plan', 'country', 'plans', 'continue', 'summary-text', 'status']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.ok(js.includes("fetch('/api/public/plans'"));
  assert.ok(!js.includes('plan-quote'), 'no longer uses the unpriced per-service quote');
  assert.ok(js.includes("'/register.html?'"));
  for (const plan of ['starter', 'premium', 'enterprise']) assert.ok(home.includes('/build-plan.html?plan=' + plan), plan);
  assert.ok(!home.includes('Professional</h3>'), 'homepage uses the real plan name');
  assert.ok(read('public/register.js').includes("'mar-khoor.chosen-plan'"));
  assert.ok(read('public/restaurant.js').includes('rememberedPlan()'));
});
