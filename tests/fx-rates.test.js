import test from 'node:test';
import assert from 'node:assert/strict';
import { getUsdRates, resetFxCache, niceAmount, convertUsdMinor, FX_SOURCE_URL } from '../src/fx-rates.js';

const ok = rates => async url => { assert.equal(url, FX_SOURCE_URL); return { ok: true, json: async () => ({ result: 'success', base_code: 'USD', time_last_update_utc: 'Wed, 18 Nov 2026 00:02:31 +0000', rates }) }; };

test('rates are fetched once and cached for 12 hours', async () => {
  resetFxCache();
  let calls = 0;
  const fetcher = async url => { calls++; return ok({ USD: 1, PKR: 280.4 })(url); };
  const t0 = Date.UTC(2026, 10, 18);
  assert.equal((await getUsdRates({ fetcher, now: t0 })).rates.PKR, 280.4);
  await getUsdRates({ fetcher, now: t0 + 11 * 3600e3 });
  assert.equal(calls, 1);
  await getUsdRates({ fetcher, now: t0 + 13 * 3600e3 });
  assert.equal(calls, 2);
});

test('a failed refresh keeps the last good rates; bad data is rejected', async () => {
  resetFxCache();
  const t0 = Date.UTC(2026, 10, 18);
  await getUsdRates({ fetcher: ok({ USD: 1, PKR: 280 }), now: t0 });
  const down = async () => { throw Error('offline'); };
  assert.equal((await getUsdRates({ fetcher: down, now: t0 + 13 * 3600e3, envJson: '' })).rates.PKR, 280);
  resetFxCache();
  const junk = async () => ({ ok: true, json: async () => ({ result: 'error', rates: { PKR: 1 } }) });
  assert.equal(await getUsdRates({ fetcher: junk, now: t0, envJson: '' }), null);
});

test('configured fallback rates are used when the source is unavailable', async () => {
  resetFxCache();
  const fx = await getUsdRates({ fetcher: async () => ({ ok: false }), now: Date.UTC(2026, 10, 18), envJson: '{"PKR":281,"bad":5,"AED":-1}' });
  assert.deepEqual(fx.rates, { PKR: 281, USD: 1 });
  assert.equal(fx.source, 'configured');
});

test('clean rounding and conversion', () => {
  assert.equal(niceAmount(10934.43), 10900);
  assert.equal(niceAmount(143.23), 140);
  assert.equal(niceAmount(11.98), 12);
  assert.equal(niceAmount(0.2), 1);
  assert.equal(convertUsdMinor(3900, 'USD', null), 3900);
  assert.equal(convertUsdMinor(3900, 'PKR', { rates: { PKR: 280.37 } }), 1090000);
  assert.equal(convertUsdMinor(3900, 'EUR', { rates: { PKR: 280 } }), null);
});
