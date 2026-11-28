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

test('every country is offered once, including Greece, with a usable placeholder', () => {
  const rows = [...source.matchAll(/\['([A-Z]{2})','(\d{1,4})',/g)];
  const isos = rows.map(r => r[1]);
  assert.ok(isos.length >= 190, 'about every country: ' + isos.length);
  assert.equal(new Set(isos).size, isos.length, 'no duplicates');
  for (const iso of ['GR', 'JP', 'BR', 'MX', 'KR', 'PH', 'TH', 'VN', 'PL', 'CH', 'AT', 'BE', 'DK', 'FI', 'IL', 'LB', 'HK']) assert.ok(isos.includes(iso), iso);
  const phone = load();
  assert.equal(phone.countryOf('+30 691 234 5678'), 'GR');
  assert.equal(phone.countryOf('+1 876 555 0123'), 'JM');
  assert.equal(phone.countryOf('+1 201 555 0123'), 'US');
  assert.equal(phone.countryOf('+7 912 345 6789'), 'RU');
  assert.match(source, /BY\[iso\]\[3\] \|\| 'phone number'/);
});

test('a local number typed without the country code gets the chosen code on blur', () => {
  assert.match(source, /else if \(\/\^\[1-9\]\[\\d\\s\(\)\.-\]\{5,\}\$\/\.test\(value\)\) value = code \+ ' ' \+ value;/);
});
