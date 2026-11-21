import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('super admin lists WhatsApp numbers with the real phone number from Meta', async () => {
  const src = readFileSync('src/api.js', 'utf8');
  assert.match(src, /withDisplayNumbers\(rows\)/);
  assert.match(src, /fields=display_phone_number,verified_name/);
  const page = readFileSync('src/views/super-admin.html', 'utf8');
  assert.match(page, /id="wa-number-list"/);
  assert.match(page, /id="wa-number-form"/);
  const js = readFileSync('public/platform.js', 'utf8');
  assert.match(js, /\[loadWhatsAppNumbers, '#wa-number-list'\]/);
  assert.ok(!/loadWhatsAppNumbers[\s\S]*innerHTML/.test(js.slice(js.indexOf('async function loadWhatsAppNumbers'))));
});
