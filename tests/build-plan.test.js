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
  for (const plan of ['starter', 'premium', 'enterprise']) assert.ok(home.includes('href="/register.html?plan=' + plan + '" data-plan="' + plan + '"'), plan);
  assert.ok(home.includes("'/restaurant.html?plan='"), 'signed-in owners go to their dashboard');
  assert.ok(js.includes("'/restaurant.html?'") && js.includes("'/register.html?'"));
  assert.ok(!home.includes('Professional</h3>'), 'homepage uses the real plan name');
  assert.ok(read('public/register.js').includes("'mar-khoor.chosen-plan'"));
  assert.ok(read('public/restaurant.js').includes('rememberedPlan()'));
});

test('registration keeps the chosen plan and signs the new owner in to continue setup', () => {
  const html = read('public/register.html'), js = read('public/register.js');
  for (const id of ['chosen-plan-select', 'chosen-cycle-select', 'signin-link']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.ok(js.includes("fetch('/auth/login'"), 'auto sign-in after registration');
  assert.ok(js.includes("localStorage.setItem('mar-khoor.owner-session'"), 'new owner stays signed in');
  assert.ok(js.includes("'/restaurant.html'"));
  const dashboard = read('public/restaurant.js');
  assert.ok(dashboard.includes("sessionStorage.getItem(sessionKey)"), 'dashboard picks up the new session');
  assert.ok(dashboard.includes('planIntent'), 'a plan clicked on the landing page opens setup on that plan');
});

test('setup asks for WhatsApp and AI Caller numbers, then opens the AI Website Builder', () => {
  const html = read('public/restaurant.html'), js = read('public/restaurant.js');
  const dialog = html.slice(html.indexOf('<dialog id="setup-dialog"'), html.indexOf('</dialog>'));
  const order = ['data-step="plan"', 'data-step="connect"', 'data-step="website"', 'data-step="done"'].map(marker => dialog.indexOf(marker));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), 'plan → numbers → website → status');
  const connect = dialog.slice(order[1], order[2]);
  assert.ok(connect.includes('name="whatsapp_value"') && connect.includes('name="ai_caller_value"') && !connect.includes('website_mode'));
  const website = dialog.slice(order[2], order[3]);
  for (const mode of ['builder', 'domain', 'embed']) assert.ok(website.includes('name="website_mode" value="' + mode + '"'), mode);
  assert.ok(website.includes('name="website_value"'));
  assert.ok(js.includes("location.hash = '#website'"), 'builder opens after setup');
  assert.ok(js.includes('function websiteNeedsBuilder'));
  assert.ok(js.includes("jsonBody('PUT', { whatsapp, ai_caller })"), 'numbers are saved before the website step');
});
