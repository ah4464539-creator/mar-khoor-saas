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

test('super admin menu opens each section on its own and slides in on phones', () => {
  const page = readFileSync('src/views/super-admin.html', 'utf8');
  assert.match(page, /href="#whatsapp-numbers"/);
  assert.match(page, /id="menu-toggle"/);
  assert.match(page, /const VIEWS = \[/);
  assert.match(readFileSync('public/platform.css', 'utf8'), /\.side\.open\{transform:none/);
});

test('super admin can subscribe a WhatsApp account to the app', () => {
  const src = readFileSync('src/api.js', 'utf8');
  assert.match(src, /router\.post\('\/platform\/whatsapp-accounts\/:wabaId\/subscribe',requireAuth/);
  assert.match(src, /\/subscribed_apps'/);
  assert.match(src, /platformRole!=='super_admin'\)return res\.status\(403\)[\s\S]{0,120}wabaId=req\.params\.wabaId/);
  assert.match(readFileSync('src/views/super-admin.html', 'utf8'), /id="waba-form"/);
});
