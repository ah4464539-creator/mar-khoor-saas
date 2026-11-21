import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('WhatsApp AI talks step by step and remembers the conversation', () => {
  const src = readFileSync('src/whatsapp-ai-worker.js', 'utf8');
  assert.match(src, /When they ask for the menu, list the dish names only, without prices/);
  assert.match(src, /Give prices only when they ask about prices/);
  assert.match(src, /\.\.\.history,\{role:'user'/);
  assert.match(src, /FROM whatsapp_outbound_messages WHERE restaurant_id=\? AND phone_number_id=\? AND recipient=\?/);
  assert.match(src, /LIMIT 10/);
});

test('call forwarding card shows ready codes with the AI number', () => {
  const source = readFileSync('public/call-forwarding.js', 'utf8');
  const made = [];
  const node = tag => ({ tag, children: [], className: '', textContent: '', set href(v) { this._href = v; }, get href() { return this._href; },
    append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; }, addEventListener() {} });
  const document = { createElement: tag => { const n = node(tag); made.push(n); return n; } };
  const window = {};
  vm.runInNewContext(source, { window, document, navigator: {}, setTimeout, String, RegExp });
  const box = node('div');
  window.mkForwarding.render(box, { aiNumber: '+92 42 3456 7890' });
  const codes = made.filter(n => n.tag === 'code').map(n => n.textContent);
  assert.deepEqual(codes, ['**21*+924234567890#', '**67*+924234567890#', '**61*+924234567890#', '##21#']);
  assert.ok(made.some(n => n.tag === 'a' && n._href === 'tel:%2A%2A21%2A+924234567890%23'));
  const empty = node('div');
  window.mkForwarding.render(empty, {});
  assert.ok(!/innerHTML/.test(source));
  const page = readFileSync('public/restaurant.html', 'utf8');
  assert.match(page, /id="setup-forwarding"/);
  assert.match(page, /\/call-forwarding\.js\?v=/);
});
