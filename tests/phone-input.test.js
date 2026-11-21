import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('public/phone-input.js', 'utf8');
const load = () => {
  const window = {};
  vm.runInNewContext(source, { window, document: { readyState: 'complete', querySelectorAll: () => [] }, navigator: { languages: ['en-US'] }, localStorage: { getItem: () => null, setItem() {} }, Intl, String, Object, Set, Event: class {} });
  return window.mkPhone;
};

test('dial codes are recognised, longest first', () => {
  const phone = load();
  assert.equal(phone.countryOf('+92 300 1234567'), 'PK');
  assert.equal(phone.countryOf('+971 50 123 4567'), 'AE');
  assert.equal(phone.countryOf('00966 50 123 4567'), 'SA');
  assert.equal(phone.countryOf('+1 506 234 5678', 'CA'), 'CA');
  assert.equal(phone.countryOf('0300 1234567'), null);
});

test('every phone box carries the country picker', () => {
  const dashboard = readFileSync('public/restaurant.html', 'utf8');
  for (const id of ['setup-wa', 'setup-call', 'site-phone', 'widget-whatsapp-number', 'widget-call-number']) assert.match(dashboard, new RegExp('id="' + id + '" data-phone'));
  assert.match(dashboard, /\/phone-input\.js\?v=/);
  assert.match(readFileSync('public/menu.html', 'utf8'), /id="customer-phone" data-phone/);
  assert.ok(!/innerHTML/.test(source));
  assert.match(source, /\['PK','92','Pakistan','300 1234567'\]/);
  assert.match(source, /\['AE','971','United Arab Emirates','50 123 4567'\]/);
});
