// WhatsApp ordering: the AI proposes an order, the customer confirms it with a button, the order
// lands in the restaurant dashboard, and status changes are sent back on WhatsApp.
// Also: voice notes in (transcribed) and voice replies out. Additive tables only. No express import.
//
// Safety: prices and totals always come from the menu table, never from the AI. An order is only
// created after the customer taps Confirm (or replies "yes") on a summary we generated ourselves.
import { newTrackingToken, hashTrackingToken } from './order-tracking.js';
import { isMissingFulfillmentSchema } from './order-fulfillment.js';
import { URDU_SPEECH_RULES } from './speech-rules.js';

export const ORDER_SQL = [
  `CREATE TABLE IF NOT EXISTS whatsapp_order_drafts (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 phone_number_id VARCHAR(64) NOT NULL,
 customer VARCHAR(64) NOT NULL,
 items TEXT NOT NULL,
 total_minor BIGINT UNSIGNED NOT NULL,
 order_type ENUM('delivery','pickup') NOT NULL,
 customer_name VARCHAR(160) NOT NULL,
 delivery_address VARCHAR(500) NULL,
 language VARCHAR(8) NOT NULL DEFAULT 'en',
 status ENUM('awaiting','confirmed','changed','expired') NOT NULL DEFAULT 'awaiting',
 order_id BIGINT UNSIGNED NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_wa_draft_customer (restaurant_id, phone_number_id, customer, status),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS whatsapp_orders (
 order_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 phone_number_id VARCHAR(64) NOT NULL,
 customer VARCHAR(64) NOT NULL,
 language VARCHAR(8) NOT NULL DEFAULT 'en',
 order_type ENUM('delivery','pickup') NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS whatsapp_inbound_media (
 message_id VARCHAR(255) NOT NULL PRIMARY KEY,
 media_id VARCHAR(128) NOT NULL,
 mime_type VARCHAR(100) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB`,
];
const ready = new WeakMap();
export function ensureOrderTables(pool) {
  if (typeof pool?.query !== 'function') return Promise.resolve();
  if (!ready.has(pool)) ready.set(pool, (async () => { for (const sql of ORDER_SQL) await pool.query(sql); })().catch(e => { ready.delete(pool); throw e; }));
  return ready.get(pool);
}

export const LANGS = ['en', 'roman', 'ur', 'ar'];
const T = {
  en: { unavailable: 'Sorry, some items in that order are no longer available. Please tell me your order again.', check: 'Please check your order:', total: 'Total', pickup: 'Pickup', delivery: 'Delivery to', name: 'Name', payCod: 'Payment: cash on delivery', payPickup: 'Payment: cash at pickup', ask: 'Tap Confirm to place the order, or Change to edit it.', confirm: '✅ Confirm', change: '✏️ Change',
    received: (id, total) => `✅ Order #${id} received! Total ${total}. The restaurant will accept it shortly and you will get updates here.`, track: 'Track your order:', changeAsk: 'Sure — tell me what you would like to change.', expired: 'That order summary has expired. Please tell me your order again.',
    status: { accepted: id => `👍 Order #${id} has been accepted.`, preparing: id => `👨‍🍳 Order #${id} is being prepared.`, ready: (id, t) => t === 'delivery' ? `🛵 Order #${id} is ready and will be on its way soon.` : `🛍️ Order #${id} is ready for pickup.`, completed: id => `🎉 Order #${id} is complete. Thank you!`, cancelled: id => `❌ Sorry, order #${id} was cancelled by the restaurant.` } },
  roman: { unavailable: 'Maazrat, is order ki kuch cheezein ab dastiyab nahi. Baraye meharbani order dobara batayein.', check: 'Apna order check karein:', total: 'Total', pickup: 'Pickup', delivery: 'Delivery', name: 'Naam', payCod: 'Payment: delivery par cash', payPickup: 'Payment: pickup par cash', ask: 'Order dene ke liye Confirm dabayein, ya tabdeeli ke liye Change.', confirm: '✅ Confirm', change: '✏️ Change',
    received: (id, total) => `✅ Order #${id} mil gaya! Total ${total}. Restaurant jald order accept karega, updates aapko yahin milengi.`, track: 'Order track karein:', changeAsk: 'Ji zaroor — batayein kya badalna hai.', expired: 'Ye order summary purani ho gayi hai. Baraye meharbani apna order dobara batayein.',
    status: { accepted: id => `👍 Order #${id} accept ho gaya hai.`, preparing: id => `👨‍🍳 Order #${id} tayyar ho raha hai.`, ready: (id, t) => t === 'delivery' ? `🛵 Order #${id} tayyar hai aur jald aap tak pahunchega.` : `🛍️ Order #${id} pickup ke liye tayyar hai.`, completed: id => `🎉 Order #${id} mukammal. Shukriya!`, cancelled: id => `❌ Maazrat, restaurant ne order #${id} cancel kar diya.` } },
  ur: { unavailable: 'معذرت، اس آرڈر کی کچھ چیزیں اب دستیاب نہیں۔ براہ کرم آرڈر دوبارہ بتائیں۔', check: 'براہ کرم اپنا آرڈر چیک کریں:', total: 'ٹوٹل', pickup: 'پک اپ', delivery: 'ڈیلیوری', name: 'نام', payCod: 'ادائیگی: ڈیلیوری پر کیش', payPickup: 'ادائیگی: پک اپ پر کیش', ask: 'آرڈر دینے کے لیے Confirm دبائیں، یا تبدیلی کے لیے Change۔', confirm: '✅ تصدیق', change: '✏️ تبدیلی',
    received: (id, total) => `✅ آرڈر #${id} موصول ہو گیا! ٹوٹل ${total}۔ ریسٹورنٹ جلد آرڈر قبول کرے گا، اپڈیٹس آپ کو یہیں ملیں گی۔`, track: 'آرڈر ٹریک کریں:', changeAsk: 'جی ضرور — بتائیں کیا بدلنا ہے۔', expired: 'یہ آرڈر سمری پرانی ہو گئی ہے۔ براہ کرم اپنا آرڈر دوبارہ بتائیں۔',
    status: { accepted: id => `👍 آرڈر #${id} قبول ہو گیا ہے۔`, preparing: id => `👨‍🍳 آرڈر #${id} تیار ہو رہا ہے۔`, ready: (id, t) => t === 'delivery' ? `🛵 آرڈر #${id} تیار ہے اور جلد آپ تک پہنچے گا۔` : `🛍️ آرڈر #${id} پک اپ کے لیے تیار ہے۔`, completed: id => `🎉 آرڈر #${id} مکمل۔ شکریہ!`, cancelled: id => `❌ معذرت، ریسٹورنٹ نے آرڈر #${id} منسوخ کر دیا۔` } },
  ar: { unavailable: 'عذراً، بعض الأصناف لم تعد متوفرة. يرجى إخباري بطلبك مرة أخرى.', check: 'يرجى مراجعة طلبك:', total: 'المجموع', pickup: 'استلام', delivery: 'توصيل إلى', name: 'الاسم', payCod: 'الدفع: نقداً عند التوصيل', payPickup: 'الدفع: نقداً عند الاستلام', ask: 'اضغط تأكيد لإرسال الطلب، أو تعديل للتغيير.', confirm: '✅ تأكيد', change: '✏️ تعديل',
    received: (id, total) => `✅ تم استلام الطلب #${id}! المجموع ${total}. سيقبل المطعم الطلب قريباً وستصلك التحديثات هنا.`, track: 'تتبع طلبك:', changeAsk: 'بالتأكيد — أخبرني بما تريد تغييره.', expired: 'انتهت صلاحية ملخص الطلب. يرجى إخباري بطلبك مرة أخرى.',
    status: { accepted: id => `👍 تم قبول الطلب #${id}.`, preparing: id => `👨‍🍳 جاري تحضير الطلب #${id}.`, ready: (id, t) => t === 'delivery' ? `🛵 الطلب #${id} جاهز وسيصلك قريباً.` : `🛍️ الطلب #${id} جاهز للاستلام.`, completed: id => `🎉 اكتمل الطلب #${id}. شكراً لك!`, cancelled: id => `❌ عذراً، ألغى المطعم الطلب #${id}.` } },
};
export const lang = value => (LANGS.includes(value) ? value : 'en');
export function money(minor, currency) {
  const code = /^[A-Z]{3}$/.test(String(currency || '')) ? currency + ' ' : '';
  const amount = Number(minor) / 100;
  return code + (Number.isInteger(amount) ? amount.toLocaleString('en') : amount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

/** OpenAI tool the WhatsApp AI calls once the order details are complete. */
export const PROPOSE_ORDER_TOOL = { type: 'function', function: {
  name: 'propose_order',
  description: 'Call ONLY when the customer clearly wants to order and you know: every item and quantity, pickup or delivery, the customer name, and (for delivery) the full address. The system then sends the customer an exact summary with Confirm/Change buttons. Never claim the order is placed yourself.',
  parameters: { type: 'object', additionalProperties: false, required: ['items', 'order_type', 'customer_name', 'language'], properties: {
    items: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['menu_item_id', 'quantity'], properties: { menu_item_id: { type: 'integer' }, quantity: { type: 'integer', minimum: 1, maximum: 99 } } } },
    order_type: { type: 'string', enum: ['delivery', 'pickup'] },
    customer_name: { type: 'string' },
    delivery_address: { type: 'string' },
    language: { type: 'string', enum: LANGS, description: 'Language the customer writes in: en, roman (Roman Urdu), ur (Urdu script), ar.' },
  } },
} };

/** Validates the AI's proposal against the real menu. Returns { value } or { error } (error is fed back to the AI). */
export function buildDraft(menu, proposal) {
  const p = proposal && typeof proposal === 'object' ? proposal : {};
  if (!['delivery', 'pickup'].includes(p.order_type)) return { error: 'order_type must be delivery or pickup' };
  const name = String(p.customer_name || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!name) return { error: 'Ask the customer for their name first' };
  const address = String(p.delivery_address || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (p.order_type === 'delivery' && address.length < 5) return { error: 'Ask the customer for the full delivery address first' };
  const byId = new Map(menu.map(m => [Number(m.id), m]));
  const qty = new Map();
  for (const item of Array.isArray(p.items) ? p.items.slice(0, 30) : []) {
    const id = Number(item?.menu_item_id), q = Number(item?.quantity);
    if (!byId.has(id)) return { error: 'Unknown menu_item_id ' + id + '; use ids from the menu JSON' };
    if (!Number.isSafeInteger(q) || q < 1 || q > 99) return { error: 'Quantity must be 1-99' };
    qty.set(id, Math.min(99, (qty.get(id) || 0) + q));
  }
  if (!qty.size) return { error: 'No items' };
  let total = 0;
  const items = [...qty].map(([id, q]) => { const m = byId.get(id); total += Number(m.price_minor) * q; return { id, name: String(m.name).slice(0, 180), quantity: q, unit_price_minor: Number(m.price_minor) }; });
  if (!Number.isSafeInteger(total) || total > 1e9) return { error: 'Order total too large' };
  return { value: { items, total_minor: total, order_type: p.order_type, customer_name: name, delivery_address: p.order_type === 'delivery' ? address : null, language: lang(p.language) } };
}

export function summaryText(draft, currency) {
  const t = T[lang(draft.language)];
  const lines = draft.items.map(i => `${i.quantity} × ${i.name} — ${money(i.unit_price_minor * i.quantity, currency)}`);
  return [t.check, '', ...lines, '', `*${t.total}: ${money(draft.total_minor, currency)}*`,
    draft.order_type === 'delivery' ? `${t.delivery}: ${draft.delivery_address}` : t.pickup,
    `${t.name}: ${draft.customer_name}`, draft.order_type === 'delivery' ? t.payCod : t.payPickup, '', t.ask].join('\n').slice(0, 1024);
}
export const buttonsFor = (draftId, language) => {
  const t = T[lang(language)];
  return [{ type: 'reply', reply: { id: 'mk_confirm:' + draftId, title: t.confirm.slice(0, 20) } }, { type: 'reply', reply: { id: 'mk_change:' + draftId, title: t.change.slice(0, 20) } }];
};
export const changeText = language => T[lang(language)].changeAsk;
export const expiredText = language => T[lang(language)].expired;
export const unavailableText = language => T[lang(language)].unavailable;
export function statusText(status, orderId, orderType, language) {
  const fn = T[lang(language)].status[status];
  return fn ? fn(orderId, orderType) : null;
}

/** Recognises a button tap (mk_confirm:12) or a typed "yes" while a summary is waiting. */
export function parseReply(text) {
  const s = String(text || '').trim();
  const button = /^mk_(confirm|change):(\d{1,12})$/.exec(s);
  if (button) return { action: button[1], draftId: Number(button[2]) };
  if (/^(1|yes|yep|ok|okay|confirm|confirmed|han|haan|ha|ji|jee|ji haan|theek hai|thik hai|ہاں|جی|جی ہاں|ٹھیک ہے|نعم|أكد|تأكيد)[.! ]*$/i.test(s)) return { action: 'confirm', typed: true };
  return null;
}

export async function saveDraft(pool, job, draft) {
  await ensureOrderTables(pool);
  await pool.execute("UPDATE whatsapp_order_drafts SET status='changed' WHERE restaurant_id=? AND phone_number_id=? AND customer=? AND status='awaiting'", [job.restaurant_id, job.phone_number_id, job.sender]);
  const [r] = await pool.execute('INSERT INTO whatsapp_order_drafts(restaurant_id,phone_number_id,customer,items,total_minor,order_type,customer_name,delivery_address,language) VALUES (?,?,?,?,?,?,?,?,?)',
    [job.restaurant_id, job.phone_number_id, job.sender, JSON.stringify(draft.items), draft.total_minor, draft.order_type, draft.customer_name, draft.delivery_address, draft.language]);
  return Number(r.insertId);
}

/** The draft a reply refers to: a specific id from a button, or the latest one still awaiting (2 hours). */
export async function findDraft(pool, job, draftId = null) {
  await ensureOrderTables(pool);
  const [rows] = await pool.execute(
    'SELECT id,items,total_minor,order_type,customer_name,delivery_address,language,status,order_id,(created_at>=NOW()-INTERVAL 2 HOUR) AS fresh FROM whatsapp_order_drafts WHERE restaurant_id=? AND phone_number_id=? AND customer=?'
    + (draftId ? ' AND id=?' : " AND status='awaiting'") + ' ORDER BY id DESC LIMIT 1',
    draftId ? [job.restaurant_id, job.phone_number_id, job.sender, draftId] : [job.restaurant_id, job.phone_number_id, job.sender]);
  if (!rows.length) return null;
  const r = rows[0];
  let items = [];
  try { items = JSON.parse(r.items); } catch { items = []; }
  return { id: Number(r.id), items, total_minor: Number(r.total_minor), order_type: r.order_type, customer_name: r.customer_name, delivery_address: r.delivery_address, language: lang(r.language), status: r.status, order_id: r.order_id ? Number(r.order_id) : null, fresh: Number(r.fresh) === 1 };
}

export async function markDraft(pool, draftId, status) {
  await pool.execute("UPDATE whatsapp_order_drafts SET status=? WHERE id=? AND status='awaiting'", [status, draftId]);
}

/**
 * Turns a confirmed draft into a real order (prices re-checked against the menu).
 * Idempotent: a second tap returns the same order. Returns { order_id, total_minor, tracking_token } or { error }.
 */
export async function placeOrder(pool, job, draft) {
  if (draft.status === 'confirmed' && draft.order_id) return { order_id: draft.order_id, total_minor: draft.total_minor, repeat: true };
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [claim] = await connection.execute("UPDATE whatsapp_order_drafts SET status='confirmed' WHERE id=? AND restaurant_id=? AND status='awaiting'", [draft.id, job.restaurant_id]);
    if (!claim.affectedRows) { await connection.rollback(); return { error: 'not_awaiting' }; }
    const ids = draft.items.map(i => Number(i.id));
    const [menu] = await connection.query('SELECT id,name,price_minor FROM menu_items WHERE restaurant_id=? AND active=1 AND id IN (' + ids.map(() => '?').join(',') + ') FOR UPDATE', [job.restaurant_id, ...ids]);
    if (menu.length !== ids.length) { await connection.rollback(); return { error: 'unavailable' }; }
    const qty = new Map(draft.items.map(i => [Number(i.id), Number(i.quantity)]));
    let total = 0;
    for (const m of menu) total += Number(m.price_minor) * qty.get(Number(m.id));
    const [order] = await connection.execute('INSERT INTO orders(restaurant_id,customer_name,total_minor) VALUES (?,?,?)', [job.restaurant_id, draft.customer_name, total]);
    const orderId = Number(order.insertId);
    for (const m of menu) await connection.execute('INSERT INTO order_items(order_id,menu_item_id,name_snapshot,quantity,unit_price_minor) VALUES (?,?,?,?,?)', [orderId, m.id, m.name, qty.get(Number(m.id)), m.price_minor]);
    try {
      await connection.execute('INSERT INTO order_fulfillment (order_id,restaurant_id,order_type,customer_phone,delivery_address,delivery_instructions,payment_method,payment_status) VALUES (?,?,?,?,?,?,?,?)',
        [orderId, job.restaurant_id, draft.order_type, '+' + job.sender, draft.delivery_address, null, draft.order_type === 'delivery' ? 'cod' : 'cash_pickup', 'unpaid']);
    } catch (error) { if (!isMissingFulfillmentSchema(error)) throw error; }
    const token = newTrackingToken();
    await connection.execute('INSERT INTO order_tracking (order_id,token_hash) VALUES (?,?)', [orderId, hashTrackingToken(token)]);
    await connection.execute('INSERT INTO whatsapp_orders(order_id,restaurant_id,phone_number_id,customer,language,order_type) VALUES (?,?,?,?,?,?)', [orderId, job.restaurant_id, job.phone_number_id, job.sender, draft.language, draft.order_type]);
    await connection.execute('UPDATE whatsapp_order_drafts SET order_id=? WHERE id=?', [orderId, draft.id]);
    await connection.commit();
    return { order_id: orderId, total_minor: total, tracking_token: token };
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    throw error;
  } finally { connection?.release?.(); }
}

export function receivedText(result, draft, currency, baseUrl) {
  const t = T[lang(draft.language)];
  const link = result.tracking_token ? '\n' + t.track + ' ' + String(baseUrl || 'https://mar-khoor.com').replace(/\/+$/, '') + '/track.html#id=' + result.order_id + '&t=' + result.tracking_token : '';
  return t.received(result.order_id, money(result.total_minor, currency)) + link;
}

// ---- WhatsApp Cloud API senders ------------------------------------------------------------
const graph = env => 'https://graph.facebook.com/' + (/^v\d{1,2}\.\d{1,2}$/.test(env.WHATSAPP_GRAPH_VERSION || '') ? env.WHATSAPP_GRAPH_VERSION : 'v23.0');
async function postMessage(fetcher, env, token, phoneId, payload) {
  const r = await fetcher(graph(env) + '/' + phoneId + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }), signal: AbortSignal.timeout(15000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Error('WhatsApp send failed (Meta ' + r.status + (data?.error?.message ? ': ' + String(data.error.message).slice(0, 120) : '') + ')');
  const id = data?.messages?.[0]?.id;
  if (typeof id !== 'string' || !id.startsWith('wamid.') || id.length > 255) throw Error('Missing outbound ID');
  return id;
}
export const sendText = (fetcher, env, token, phoneId, to, body) => postMessage(fetcher, env, token, phoneId, { to, type: 'text', text: { body: String(body).slice(0, 4096) } });
export const sendButtons = (fetcher, env, token, phoneId, to, body, buttons) => postMessage(fetcher, env, token, phoneId, { to, type: 'interactive', interactive: { type: 'button', body: { text: String(body).slice(0, 1024) }, action: { buttons } } });

/** Uploads an OGG/Opus voice note and sends it. */
export async function sendVoice(fetcher, env, token, phoneId, to, audio) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'audio/ogg');
  form.append('file', new Blob([audio], { type: 'audio/ogg' }), 'reply.ogg');
  const up = await fetcher(graph(env) + '/' + phoneId + '/media', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form, signal: AbortSignal.timeout(20000) });
  const data = await up.json().catch(() => ({}));
  if (!up.ok || typeof data?.id !== 'string') throw Error('WhatsApp media upload failed (Meta ' + up.status + ')');
  return postMessage(fetcher, env, token, phoneId, { to, type: 'audio', audio: { id: data.id } });
}

// ---- Voice notes -----------------------------------------------------------------------------
export async function saveInboundMedia(pool, messageId, mediaId, mime) {
  await ensureOrderTables(pool);
  await pool.execute('INSERT IGNORE INTO whatsapp_inbound_media(message_id,media_id,mime_type) VALUES (?,?,?)', [messageId, mediaId, mime || null]);
}
const MAX_AUDIO = 8 * 1024 * 1024;
/** Downloads a WhatsApp voice note and transcribes it. Returns text or throws. */
export async function transcribeVoiceNote(pool, job, { fetcher = fetch, env = process.env, metaToken, apiKey = env.OPENAI_API_KEY } = {}) {
  await ensureOrderTables(pool);
  const [rows] = await pool.execute('SELECT media_id,mime_type FROM whatsapp_inbound_media WHERE message_id=? LIMIT 1', [job.inbound_message_id]);
  if (!rows.length) throw Error('Voice note not found');
  const info = await fetcher(graph(env) + '/' + encodeURIComponent(rows[0].media_id), { headers: { Authorization: 'Bearer ' + metaToken }, signal: AbortSignal.timeout(10000) });
  const meta = await info.json().catch(() => ({}));
  if (!info.ok || typeof meta?.url !== 'string' || !/^https:\/\/[a-z0-9.-]+\.(fbsbx|facebook|whatsapp)\.(com|net)\//i.test(meta.url)) throw Error('Voice note unavailable');
  if (Number(meta.file_size) > MAX_AUDIO) throw Error('Voice note too long');
  const file = await fetcher(meta.url, { headers: { Authorization: 'Bearer ' + metaToken }, signal: AbortSignal.timeout(20000) });
  if (!file.ok) throw Error('Voice note download failed');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO) throw Error('Voice note too long');
  const mime = String(meta.mime_type || rows[0].mime_type || 'audio/ogg').split(';')[0];
  const form = new FormData();
  form.append('model', env.WHATSAPP_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');
  form.append('prompt', 'Customer voice note to a restaurant in Pakistan: Urdu, Roman Urdu, Punjabi or English, with dish names and quantities.');
  form.append('file', new Blob([bytes], { type: mime }), 'note.' + (mime.includes('mpeg') ? 'mp3' : mime.includes('mp4') ? 'm4a' : 'ogg'));
  const tr = await fetcher('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }, body: form, signal: AbortSignal.timeout(30000) });
  const out = await tr.json().catch(() => ({}));
  const text = String(out?.text || '').trim().slice(0, 2000);
  if (!tr.ok || !text) throw Error('Could not understand the voice note');
  await pool.execute('UPDATE whatsapp_inbound_messages SET text_body=? WHERE message_id=? AND restaurant_id=? AND text_body IS NULL', [text, job.inbound_message_id, job.restaurant_id]);
  return text;
}

/** Spoken reply (OGG/Opus) in the same female voice as the phone assistant. */
export async function speak(text, { fetcher = fetch, env = process.env, apiKey = env.OPENAI_API_KEY } = {}) {
  const input = String(text || '').replace(/[*_~]/g, '').replace(/https?:\/\/\S+/g, '').trim().slice(0, 1200);
  if (!input) throw Error('Nothing to say');
  const r = await fetcher('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.WHATSAPP_TTS_MODEL || 'gpt-4o-mini-tts', voice: env.WHATSAPP_TTS_VOICE || 'marin', input, response_format: 'opus',
      instructions: 'Warm, polite, professional restaurant staff. Natural pace. ' + URDU_SPEECH_RULES }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Error('Voice reply failed (OpenAI ' + r.status + ')');
  const audio = new Uint8Array(await r.arrayBuffer());
  if (!audio.length) throw Error('Empty voice reply');
  return audio;
}

// ---- Status updates --------------------------------------------------------------------------
/**
 * Sends the new order status to the customer on WhatsApp, for orders placed on WhatsApp.
 * Only inside WhatsApp's 24-hour customer-service window (free-form messages); never throws.
 */
export async function notifyOrderStatus(pool, restaurantId, orderId, status, { fetcher = fetch, env = process.env, tokenFor = null, log = console } = {}) {
  try {
    await ensureOrderTables(pool);
    const [rows] = await pool.execute('SELECT phone_number_id,customer,language,order_type FROM whatsapp_orders WHERE order_id=? AND restaurant_id=? LIMIT 1', [orderId, restaurantId]);
    if (!rows.length) return { sent: false, reason: 'not_whatsapp' };
    const o = rows[0];
    const text = statusText(status, orderId, o.order_type, o.language);
    if (!text) return { sent: false, reason: 'no_message' };
    const [recent] = await pool.execute('SELECT 1 FROM whatsapp_inbound_messages WHERE restaurant_id=? AND phone_number_id=? AND sender=? AND received_at>=NOW()-INTERVAL 23 HOUR LIMIT 1', [restaurantId, o.phone_number_id, o.customer]);
    if (!recent.length) { log.log?.('WhatsApp status not sent (24h window closed) for order #' + orderId); return { sent: false, reason: 'window_closed' }; }
    const token = (tokenFor ? await tokenFor(o.phone_number_id) : null) || env.WHATSAPP_ACCESS_TOKEN;
    if (!token) return { sent: false, reason: 'no_token' };
    const id = await sendText(fetcher, env, token, o.phone_number_id, o.customer, text);
    await pool.execute('INSERT INTO whatsapp_outbound_messages(message_id,restaurant_id,phone_number_id,recipient,text_body) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE message_id=message_id', [id, restaurantId, o.phone_number_id, o.customer, text]);
    return { sent: true, id };
  } catch (error) {
    log.warn?.('WhatsApp status update failed for order #' + orderId + ': ' + String(error.message || error).slice(0, 160));
    return { sent: false, reason: 'error' };
  }
}

