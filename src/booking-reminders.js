// WhatsApp reminders the day before a booking (runs inside the Node service every 10 minutes).
// Meta allows free text only within 24 hours of the customer's last message; outside that window a
// pre-approved template is required (WHATSAPP_REMINDER_TEMPLATE, language WHATSAPP_REMINDER_LANG,
// body parameters: 1 = customer name, 2 = business name, 3 = date and time). Without a template those
// reminders are skipped and logged, never faked. Additive table only.
import { ensureBookingTables, getProfile, localNow } from './bookings.js';
import { ensureBookingChatTables } from './booking-assistant.js';
import { sendText, lang } from './whatsapp-orders.js';
import { tokenForNumber } from './whatsapp-signup-core.js';
import { isOptedOut } from './whatsapp-reliability.js';

export const REMINDER_SQL = `CREATE TABLE IF NOT EXISTS booking_reminders (
 booking_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 restaurant_id BIGINT UNSIGNED NOT NULL,
 channel VARCHAR(20) NOT NULL,
 status VARCHAR(20) NOT NULL,
 detail VARCHAR(200) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_booking_reminders (restaurant_id),
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

const TEXT = {
  en: (n, when, biz) => 'Reminder: your booking #' + n + ' at ' + biz + ' is on ' + when + '. Reply here if you need to change it.',
  roman: (n, when, biz) => 'Yaad dihani: ' + biz + ' mein aap ki booking #' + n + ' ' + when + ' ko hai. Tabdeeli ke liye yahan reply karein.',
  ur: (n, when, biz) => 'یاد دہانی: ' + biz + ' میں آپ کی بکنگ #' + n + ' ' + when + ' کو ہے۔ تبدیلی کے لیے یہاں جواب دیں۔',
  ar: (n, when, biz) => 'تذكير: حجزك #' + n + ' في ' + biz + ' بتاريخ ' + when + '. رد هنا إذا أردت التغيير.',
};

/** Is this booking due a reminder now? start between 2 and 26 hours ahead (local wall clock). */
export function dueForReminder(startAt, nowLocal) {
  const toMs = v => Date.parse(String(v).slice(0, 16).replace(' ', 'T') + ':00Z');
  const diffH = (toMs(startAt) - toMs(nowLocal)) / 3600000;
  return diffH >= 2 && diffH <= 26;
}

async function sendTemplate(fetcher, env, token, phoneId, to, params) {
  const version = env.WHATSAPP_GRAPH_VERSION || 'v23.0';
  const res = await fetcher('https://graph.facebook.com/' + version + '/' + phoneId + '/messages', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: env.WHATSAPP_REMINDER_TEMPLATE, language: { code: env.WHATSAPP_REMINDER_LANG || 'en' }, components: [{ type: 'body', parameters: params.map(text => ({ type: 'text', text: String(text).slice(0, 200) })) }] } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Error('Meta ' + res.status + ' ' + String(data?.error?.message || '').slice(0, 80));
  return data?.messages?.[0]?.id || '';
}

export async function sendDueReminders(pool, { fetcher = fetch, env = process.env, log = console } = {}) {
  await ensureBookingTables(pool); await ensureBookingChatTables(pool); await pool.query(REMINDER_SQL);
  const [rows] = await pool.execute("SELECT b.id,b.restaurant_id,b.customer_name,b.customer_phone,b.start_at,r.name biz, w.phone_number_id wa_phone, w.customer wa_customer, w.language FROM bookings b JOIN restaurants r ON r.id=b.restaurant_id LEFT JOIN whatsapp_bookings w ON w.booking_id=b.id LEFT JOIN booking_reminders m ON m.booking_id=b.id WHERE m.booking_id IS NULL AND b.status IN ('pending','confirmed') AND b.start_at BETWEEN NOW() - INTERVAL 1 DAY AND NOW() + INTERVAL 2 DAY ORDER BY b.start_at LIMIT 200");
  let sent = 0, skipped = 0;
  const profiles = new Map();
  for (const b of rows) {
    const rid = Number(b.restaurant_id);
    if (!profiles.has(rid)) profiles.set(rid, await getProfile(pool, rid).catch(() => null));
    const profile = profiles.get(rid);
    if (!profile || !dueForReminder(b.start_at instanceof Date ? b.start_at.toISOString().replace('T', ' ') : b.start_at, localNow(profile.timezone))) continue;
    const when = String(b.start_at instanceof Date ? b.start_at.toISOString().replace('T', ' ') : b.start_at).slice(0, 16);
    const record = (channel, status, detail) => pool.execute('INSERT IGNORE INTO booking_reminders(booking_id,restaurant_id,channel,status,detail) VALUES (?,?,?,?,?)', [b.id, rid, channel, status, detail ? String(detail).slice(0, 200) : null]);
    try {
      // The business's own WhatsApp number (or the one this customer wrote to).
      let phoneId = b.wa_phone, to = b.wa_customer || String(b.customer_phone).replace(/\D/g, '');
      if (!phoneId) { const [[n]] = await pool.execute('SELECT phone_number_id FROM whatsapp_numbers WHERE restaurant_id=? AND active=1 LIMIT 1', [rid]); phoneId = n?.phone_number_id; }
      if (!phoneId) { await record('none', 'skipped', 'no WhatsApp number'); skipped++; continue; }
      if (typeof pool.query === 'function' && await isOptedOut(pool, rid, to)) { await record('none', 'skipped', 'customer opted out (STOP)'); skipped++; continue; }
      const token = (await tokenForNumber(pool, phoneId).catch(() => null)) || env.WHATSAPP_ACCESS_TOKEN;
      if (!token) { await record('none', 'skipped', 'no token'); skipped++; continue; }
      const [recent] = await pool.execute('SELECT 1 FROM whatsapp_inbound_messages WHERE restaurant_id=? AND phone_number_id=? AND sender=? AND received_at>=NOW()-INTERVAL 23 HOUR LIMIT 1', [rid, phoneId, to]);
      if (recent.length) {
        const body = (TEXT[lang(b.language)] || TEXT.en)(b.id, when, b.biz);
        const id = await sendText(fetcher, env, token, phoneId, to, body);
        await pool.execute('INSERT INTO whatsapp_outbound_messages(message_id,restaurant_id,phone_number_id,recipient,text_body) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE message_id=message_id', [id, rid, phoneId, to, body]);
        await record('whatsapp', 'sent'); sent++;
      } else if (env.WHATSAPP_REMINDER_TEMPLATE) {
        await sendTemplate(fetcher, env, token, phoneId, to, [b.customer_name, b.biz, when]);
        await record('template', 'sent'); sent++;
      } else { await record('none', 'skipped', 'no approved template (24h window closed)'); skipped++; }
    } catch (error) { await record('whatsapp', 'failed', error.message).catch(() => {}); log.warn?.('Booking reminder #' + b.id + ' failed: ' + String(error.message).slice(0, 120)); }
  }
  if (sent || skipped) log.log?.('Booking reminders: ' + sent + ' sent, ' + skipped + ' skipped');
  return { sent, skipped };
}

export function startReminderWorker(pool) {
  const run = () => sendDueReminders(pool).catch(error => console.warn('Booking reminders failed:', String(error?.code || error?.message).slice(0, 80)));
  setTimeout(run, 60000).unref();
  setInterval(run, 10 * 60 * 1000).unref();
}
