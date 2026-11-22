import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDraft, summaryText, buttonsFor, parseReply, receivedText, statusText, notifyOrderStatus, placeOrder } from '../src/whatsapp-orders.js';
import { processWhatsAppAIJobs } from '../src/whatsapp-ai-worker.js';

const menu = [{ id: 1, name: 'Chicken Karahi', price_minor: 160000 }, { id: 2, name: 'Naan', price_minor: 5000 }];

test('AI proposal is checked against the real menu; prices come from the menu', () => {
  assert.match(buildDraft(menu, { items: [{ menu_item_id: 9, quantity: 1 }], order_type: 'pickup', customer_name: 'Ali' }).error, /Unknown/);
  assert.match(buildDraft(menu, { items: [{ menu_item_id: 1, quantity: 1 }], order_type: 'delivery', customer_name: 'Ali' }).error, /address/);
  assert.match(buildDraft(menu, { items: [{ menu_item_id: 1, quantity: 1 }], order_type: 'pickup', customer_name: ' ' }).error, /name/);
  const d = buildDraft(menu, { items: [{ menu_item_id: 1, quantity: 1 }, { menu_item_id: 2, quantity: 3 }, { menu_item_id: 2, quantity: 1 }], order_type: 'delivery', customer_name: 'Ali', delivery_address: 'House 5, DHA Lahore', language: 'roman', price: 1 }).value;
  assert.equal(d.total_minor, 160000 + 4 * 5000);
  assert.deepEqual(d.items.map(i => [i.name, i.quantity]), [['Chicken Karahi', 1], ['Naan', 4]]);
  const text = summaryText(d, 'PKR');
  assert.match(text, /1 × Chicken Karahi — Rs 1,600/);
  assert.match(text, /\*Total: Rs 1,800\*/);
  assert.match(text, /Delivery: House 5, DHA Lahore/);
  assert.deepEqual(buttonsFor(12, 'roman').map(b => b.reply.id), ['mk_confirm:12', 'mk_change:12']);
  assert.ok(buttonsFor(12, 'ur').every(b => b.reply.title.length <= 20));
});

test('replies: button ids and typed yes in several languages; other text is not a confirmation', () => {
  assert.deepEqual(parseReply('mk_confirm:42'), { action: 'confirm', draftId: 42 });
  assert.deepEqual(parseReply('mk_change:7'), { action: 'change', draftId: 7 });
  for (const s of ['Haan', 'yes', 'ji', 'ہاں', 'confirm!', '1']) assert.equal(parseReply(s)?.action, 'confirm', s);
  for (const s of ['haan ek naan aur', 'no', 'mk_confirm:abc', 'menu?']) assert.equal(parseReply(s), null, s);
});

test('received and status texts', () => {
  const r = receivedText({ order_id: 55, total_minor: 180000, tracking_token: 'a'.repeat(48) }, { language: 'en' }, 'PKR', 'https://mar-khoor.com/');
  assert.match(r, /Order #55 received! Total Rs 1,800/);
  assert.match(r, /https:\/\/mar-khoor\.com\/track\.html#id=55&t=a{48}/);
  assert.match(statusText('ready', 55, 'pickup', 'roman'), /pickup ke liye tayyar/);
  assert.match(statusText('ready', 55, 'delivery', 'en'), /on its way/);
  assert.equal(statusText('pending', 55, 'pickup', 'en'), null);
});

function orderPool({ menuRows = menu, awaiting = true } = {}) {
  const log = [];
  const connection = { log, async beginTransaction() {}, async commit() { log.push('commit'); }, async rollback() { log.push('rollback'); }, release() {},
    async execute(sql, p) { log.push(sql.split(' ').slice(0, 3).join(' ')); if (sql.startsWith("UPDATE whatsapp_order_drafts SET status='confirmed'")) return [{ affectedRows: awaiting ? 1 : 0 }]; if (sql.startsWith('INSERT INTO orders')) return [{ insertId: 77 }]; return [{ affectedRows: 1 }]; },
    async query(sql, p) { return [menuRows.filter(m => p.slice(1).includes(m.id))]; } };
  return { connection, async getConnection() { return connection; } };
}
const job = { restaurant_id: 4, phone_number_id: '148', sender: '923001234567' };
const draft = { id: 9, status: 'awaiting', items: [{ id: 1, quantity: 2 }], total_minor: 1, order_type: 'pickup', customer_name: 'Ali', delivery_address: null, language: 'en' };

test('placing a confirmed order re-prices from the menu, links it to WhatsApp, and is idempotent', async () => {
  const pool = orderPool();
  const placed = await placeOrder(pool, job, draft);
  assert.equal(placed.order_id, 77);
  assert.equal(placed.total_minor, 320000, 'price from menu, not from the draft');
  assert.match(placed.tracking_token, /^[a-f0-9]{48}$/);
  assert.ok(pool.connection.log.includes('INSERT INTO whatsapp_orders(order_id,restaurant_id,phone_number_id,customer,language,order_type)'));
  assert.equal(pool.connection.log.at(-1), 'commit');
  assert.deepEqual(await placeOrder(orderPool(), job, { ...draft, status: 'confirmed', order_id: 77 }), { order_id: 77, total_minor: 1, repeat: true });
  assert.deepEqual(await placeOrder(orderPool({ awaiting: false }), job, draft), { error: 'not_awaiting' });
  assert.deepEqual(await placeOrder(orderPool({ menuRows: [] }), job, draft), { error: 'unavailable' });
});

test('status updates go only to WhatsApp orders inside the 24h window', async () => {
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.s1' }] }) }; };
  const pool = (linked, recent) => ({ async execute(sql) {
    if (sql.startsWith('SELECT phone_number_id,customer')) return [linked ? [{ phone_number_id: '148', customer: '923001234567', language: 'roman', order_type: 'delivery' }] : []];
    if (sql.startsWith('SELECT 1 FROM whatsapp_inbound_messages')) return [recent ? [{ 1: 1 }] : []];
    return [{ affectedRows: 1 }];
  } });
  const env = { WHATSAPP_ACCESS_TOKEN: 't' }, log = { log() {}, warn() {} };
  assert.equal((await notifyOrderStatus(pool(false, true), 4, 77, 'accepted', { fetcher, env, log })).reason, 'not_whatsapp');
  assert.equal((await notifyOrderStatus(pool(true, false), 4, 77, 'accepted', { fetcher, env, log })).reason, 'window_closed');
  assert.equal((await notifyOrderStatus(pool(true, true), 4, 77, 'preparing', { fetcher, env, log })).sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '923001234567');
  assert.match(sent[0].text.body, /Order #77 tayyar ho raha hai/);
});

function workerPool(job, extra = () => undefined) {
  const queries = [];
  return { queries, async execute(sql, args = []) {
    queries.push({ sql, args });
    const r = extra(sql, args); if (r) return r;
    if (sql.startsWith('SELECT j.inbound_message_id')) return [[job]];
    if (sql.startsWith('UPDATE whatsapp_ai_jobs j JOIN')) return [{ affectedRows: 1 }];
    if (sql.startsWith('SELECT id,name,description')) return [menu.map(m => ({ ...m, description: '' }))];
    if (sql.startsWith('SELECT s.enabled FROM whatsapp_ai_settings')) return [[{ enabled: 1 }]];
    if (sql.startsWith('SELECT role,text_body')) return [[]];
    return [{ affectedRows: 1, insertId: 31 }];
  } };
}
async function withKeys(fn) {
  const a = process.env.OPENAI_API_KEY, b = process.env.WHATSAPP_ACCESS_TOKEN;
  process.env.OPENAI_API_KEY = 'k'; process.env.WHATSAPP_ACCESS_TOKEN = 't';
  try { await fn(); } finally { if (a === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = a; if (b === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN; else process.env.WHATSAPP_ACCESS_TOKEN = b; }
}

test('worker: AI proposes an order -> customer gets our exact summary with Confirm/Change buttons', () => withKeys(async () => {
  const job = { inbound_message_id: 'wamid.in', restaurant_id: 4, phone_number_id: '148', sender: '923001234567', message_type: 'text', text_body: 'Mera naam Ali, pickup', name: 'Urban Cafe', locale: 'en', currency: 'PKR' };
  const pool = workerPool(job);
  const sent = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.includes('openai')) {
      assert.ok(body.tools?.[0]?.function?.name === 'propose_order');
      assert.match(body.messages[0].content, /"id":1/);
      return { ok: true, json: async () => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'propose_order', arguments: JSON.stringify({ items: [{ menu_item_id: 1, quantity: 1 }], order_type: 'pickup', customer_name: 'Ali', language: 'roman' }) } }] } }] }) };
    }
    sent.push(body); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.out' }] }) };
  };
  assert.deepEqual(await processWhatsAppAIJobs(pool, { fetcher }), { claimed: 1, sent: 1, failed: 0 });
  assert.equal(sent[0].type, 'interactive');
  assert.match(sent[0].interactive.body.text, /1 × Chicken Karahi — Rs 1,600/);
  assert.deepEqual(sent[0].interactive.action.buttons.map(b => b.reply.id), ['mk_confirm:31', 'mk_change:31']);
  assert.ok(pool.queries.some(q => q.sql.startsWith('INSERT INTO whatsapp_order_drafts')));
}));

test('worker: incomplete proposal goes back to the AI, which asks for the missing detail', () => withKeys(async () => {
  const job = { inbound_message_id: 'wamid.in2', restaurant_id: 4, phone_number_id: '148', sender: '923001234567', message_type: 'text', text_body: 'delivery please', name: 'Urban Cafe', locale: 'en', currency: 'PKR' };
  const pool = workerPool(job);
  let calls = 0; const sent = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.includes('openai')) {
      calls++;
      if (calls === 1) return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'propose_order', arguments: JSON.stringify({ items: [{ menu_item_id: 1, quantity: 1 }], order_type: 'delivery', customer_name: 'Ali', language: 'en' }) } }] } }] }) };
      assert.match(body.messages.at(-1).content, /delivery address/);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'What is your full delivery address?' } }] }) };
    }
    sent.push(body); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.out' }] }) };
  };
  await processWhatsAppAIJobs(pool, { fetcher });
  assert.equal(calls, 2);
  assert.equal(sent[0].text.body, 'What is your full delivery address?');
}));

test('worker: Change button marks the summary changed and asks what to change (no AI call)', () => withKeys(async () => {
  const job = { inbound_message_id: 'wamid.in3', restaurant_id: 4, phone_number_id: '148', sender: '923001234567', message_type: 'interactive', text_body: 'mk_change:31', name: 'Urban Cafe', locale: 'en', currency: 'PKR' };
  const pool = workerPool(job, sql => sql.startsWith('SELECT id,items,total_minor') ? [[{ id: 31, items: '[]', total_minor: 1, order_type: 'pickup', customer_name: 'Ali', delivery_address: null, language: 'roman', status: 'awaiting', order_id: null, fresh: 1 }]] : undefined);
  const sent = [];
  const fetcher = async (url, init) => { assert.ok(!url.includes('openai'), 'no AI call'); sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.out' }] }) }; };
  await processWhatsAppAIJobs(pool, { fetcher });
  assert.match(sent[0].text.body, /kya badalna hai/);
  assert.ok(pool.queries.some(q => q.sql.startsWith('UPDATE whatsapp_order_drafts SET status=?') && q.args[0] === 'changed'));
}));

test('webhook stores button ids and voice notes; status route notifies WhatsApp customers', () => {
  const hook = readFileSync('src/integrations.js', 'utf8');
  assert.match(hook, /mk_\(confirm\|change\|bconfirm\|bchange\)/);
  assert.match(hook, /saveInboundMedia/);
  assert.match(readFileSync('src/operations.js', 'utf8'), /notifyOrderStatus\(pool,req\.restaurantId,id,status/);
});

import { paymentList, choosePayment, extractReference, submitReference, pendingTransfer, notifyPaymentStatus } from '../src/whatsapp-orders.js';

const paySettings = { cash: true, card_on_delivery: true, transfers: [{ id: 'jc01', type: 'jazzcash', label: 'JazzCash', account_title: 'Urban Cafe', account_number: '03001234567', instructions: 'Use your order number as the note' }] };

test('payment list shows only the restaurant methods; none when cash only', () => {
  assert.equal(paymentList(77, { cash: true, card_on_delivery: false, transfers: [] }, 'pickup', 'en'), null);
  const list = paymentList(77, paySettings, 'delivery', 'roman');
  assert.deepEqual(list.action.sections[0].rows.map(r => r.id), ['mk_pay:77:cash', 'mk_pay:77:card', 'mk_pay:77:transfer:jc01']);
  assert.ok(list.action.sections[0].rows.every(r => r.title.length <= 24 && r.description.length <= 72));
  assert.ok(list.action.button.length <= 20);
  assert.deepEqual(parseReply('mk_pay:77:transfer:jc01'), { action: 'pay', orderId: 77, key: 'transfer:jc01' });
  assert.equal(parseReply('mk_pay:77:transfer:../x'), null);
});

function payPool({ owned = true, status = null, settings = paySettings } = {}) {
  const writes = [];
  return { writes, async query() { return [[]]; }, async execute(sql, p = []) {
    if (sql.startsWith('SELECT w.order_id,w.language,w.order_type')) return [owned ? [{ order_id: 77, language: 'en', order_type: 'delivery', total_minor: 180000, status: 'pending' }] : []];
    if (sql.startsWith('SELECT status FROM order_payments')) return [status ? [{ status }] : []];
    if (sql.startsWith('SELECT config FROM restaurant_payment_settings')) return [[{ config: JSON.stringify(settings) }]];
    writes.push({ sql: sql.slice(0, 40), p }); return [{ affectedRows: 1 }];
  } };
}
const pjob = { restaurant_id: 4, phone_number_id: '148', sender: '923001234567', inbound_message_id: 'wamid.x' };

test('choosing a transfer records it and sends the restaurant account details', async () => {
  const pool = payPool();
  const text = await choosePayment(pool, pjob, 77, 'transfer:jc01', 'PKR');
  assert.match(text, /\*Rs 1,800\* for order #77/);
  assert.match(text, /JazzCash[\s\S]*Urban Cafe[\s\S]*03001234567/);
  assert.match(text, /transaction ID/);
  assert.ok(pool.writes.some(w => w.sql.startsWith('INSERT INTO order_payments') && w.p[2] === 'transfer:jc01'));
  assert.match(await choosePayment(payPool(), pjob, 77, 'cash', 'PKR'), /Cash noted/);
  assert.match(await choosePayment(payPool({ owned: false }), pjob, 77, 'cash', 'PKR'), /expired/, 'another customer cannot touch the order');
  assert.match(await choosePayment(payPool({ status: 'confirmed' }), pjob, 77, 'transfer:jc01', 'PKR'), /Payment received/);
  assert.match(await choosePayment(payPool(), pjob, 77, 'transfer:nope', 'PKR'), /valid payment method/);
});

test('transaction IDs are recognised in short messages only', () => {
  for (const [s, ref] of [['TID 123456789', '123456789'], ['Trx: AB12CD3456', 'AB12CD3456'], ['My transaction id is 98765432', '98765432'], ['0312345678901', '0312345678901']]) assert.equal(extractReference(s), ref, s);
  for (const s of ['haan ek naan aur', '2 naan', 'ok', 'menu please']) assert.equal(extractReference(s), null, s);
});

test('owner confirm/reject is sent to the WhatsApp customer', async () => {
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.p' }] }) }; };
  const pool = { async query() { return [[]]; }, async execute(sql) {
    if (sql.startsWith('SELECT phone_number_id,customer,language FROM whatsapp_orders')) return [[{ phone_number_id: '148', customer: '923001234567', language: 'roman' }]];
    if (sql.startsWith('SELECT 1 FROM whatsapp_inbound_messages')) return [[{ 1: 1 }]];
    return [{}];
  } };
  await notifyPaymentStatus(pool, 4, 77, 'confirmed', { fetcher, env: { WHATSAPP_ACCESS_TOKEN: 't' }, log: { warn() {} } });
  await notifyPaymentStatus(pool, 4, 77, 'rejected', { fetcher, env: { WHATSAPP_ACCESS_TOKEN: 't' }, log: { warn() {} } });
  assert.match(sent[0].text.body, /payment mil gayi/);
  assert.match(sent[1].text.body, /payment nahi mili/);
});

test('worker: a typed transaction ID while a transfer waits is saved and the owner is alerted', () => withKeys(async () => {
  const job = { inbound_message_id: 'wamid.in9', restaurant_id: 4, phone_number_id: '148', sender: '923001234567', message_type: 'text', text_body: 'TID 99887766', name: 'Urban Cafe', locale: 'en', currency: 'PKR' };
  const pool = workerPool(job, sql => sql.startsWith('SELECT w.order_id,w.language FROM whatsapp_orders w JOIN order_payments') ? [[{ order_id: 77, language: 'en' }]] : undefined);
  pool.query = async () => [[]];
  const sent = [];
  const fetcher = async (url, init) => { assert.ok(!url.includes('openai'), 'no AI call'); sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.out' }] }) }; };
  await processWhatsAppAIJobs(pool, { fetcher });
  assert.match(sent[0].text.body, /payment details for order #77 have been sent/);
  assert.ok(pool.queries.some(q => q.sql.startsWith("UPDATE order_payments SET reference=?,status='submitted'") && q.args[0] === '99887766'));
}));

test('webhook takes list replies and pictures; dashboard can show the screenshot', () => {
  const hook = readFileSync('src/integrations.js', 'utf8');
  assert.match(hook, /list_reply/);
  assert.match(hook, /type==='image'\?msg\.image/);
  assert.match(readFileSync('src/operations.js', 'utf8'), /payment-proof/);
  assert.match(readFileSync('public/restaurant.js', 'utf8'), /View screenshot/);
});
