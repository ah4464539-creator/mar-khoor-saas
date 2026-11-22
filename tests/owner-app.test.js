import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { encryptPayload, vapidHeader, validSubscription, pushToRestaurant, saveSubscription } from '../src/web-push.js';
import { siteManifest, renderSitePage, SITE_CSP } from '../src/site-builder.js';

const browser = () => { const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16); return { ua, auth, sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } }; };
function decrypt(body, ua, auth) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ua.computeSecret(asPub), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const d = crypto.createDecipheriv('aes-128-gcm', Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)));
  d.setAuthTag(ct.subarray(-16));
  const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  assert.equal(plain.at(-1), 2); return plain.subarray(0, -1).toString();
}

test('push payload is encrypted so only the browser can read it (RFC 8291)', () => {
  const { ua, auth, sub } = browser();
  const body = encryptPayload('{"title":"New order #5"}', { p256dh: sub.keys.p256dh, auth: sub.keys.auth });
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(decrypt(body, ua, auth), '{"title":"New order #5"}');
});

test('VAPID header is a valid ES256 JWT for the push service origin', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const keys = { publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url'), privateKey: privateKey.export({ format: 'jwk' }).d };
  const header = vapidHeader('https://web.push.apple.com/abc', keys);
  const [h, p, s] = header.match(/t=([^,]+)/)[1].split('.');
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'https://web.push.apple.com');
  assert.ok(crypto.verify('sha256', Buffer.from(h + '.' + p), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.match(header, new RegExp('k=' + keys.publicKey + '$'));
});

test('only real push services are accepted', () => {
  const { sub } = browser();
  assert.ok(validSubscription(sub));
  for (const endpoint of ['https://evil.example/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://user@fcm.googleapis.com/x']) assert.equal(validSubscription({ ...sub, endpoint }), null, endpoint);
  assert.equal(validSubscription({ ...sub, keys: { p256dh: 'abc', auth: sub.keys.auth } }), null);
});

function pushPool(subs) {
  const settings = new Map(), deleted = [];
  return { deleted, async query(sql, p = []) {
    if (sql.startsWith("SELECT setting_value FROM app_settings WHERE setting_key='web_push_vapid'")) return [settings.has('v') ? [{ setting_value: settings.get('v') }] : []];
    if (sql.startsWith("INSERT INTO app_settings (setting_key,setting_value) VALUES ('web_push_vapid'")) { if (!settings.has('v')) settings.set('v', p[0]); return [{}]; }
    return [[]];
  }, async execute(sql, p = []) {
    if (sql.startsWith('SELECT id,endpoint,p256dh,auth')) return [subs];
    if (sql.startsWith('DELETE FROM push_subscriptions WHERE id=?')) { deleted.push(p[0]); return [{}]; }
    if (sql.startsWith('SELECT COUNT(*)')) return [[{ n: subs.length }]];
    return [{}];
  } };
}

test('push goes to every device; dead ones are removed; payload decrypts', async () => {
  const a = browser(), b = browser();
  const subs = [{ id: 1, endpoint: a.sub.endpoint, p256dh: a.sub.keys.p256dh, auth: a.sub.keys.auth }, { id: 2, endpoint: 'https://web.push.apple.com/dead', p256dh: b.sub.keys.p256dh, auth: b.sub.keys.auth }];
  const pool = pushPool(subs), seen = [];
  const fetcher = async (url, init) => { seen.push({ url, init }); return { ok: !url.includes('dead'), status: url.includes('dead') ? 410 : 201 }; };
  const result = await pushToRestaurant(pool, 4, { title: '🛎️ New order #9', body: 'PKR 1,800 · WhatsApp' }, { fetcher, env: { DATA_ENCRYPTION_KEY: 'k' }, log: { warn() {} } });
  assert.equal(result.sent, 1);
  assert.deepEqual(pool.deleted, [2]);
  const fcm = seen.find(s => s.url.includes('fcm'));
  assert.equal(fcm.init.headers['Content-Encoding'], 'aes128gcm');
  assert.match(fcm.init.headers.Authorization, /^vapid t=.+, k=.+/);
  assert.equal(JSON.parse(decrypt(fcm.init.body, a.ua, a.auth)).title, '🛎️ New order #9');
});

test('subscription save validates input', async () => {
  assert.equal((await saveSubscription(pushPool([]), 4, 1, { endpoint: 'https://evil.example/x', keys: {} })).status, 400);
  const { sub } = browser();
  assert.deepEqual((await saveSubscription(pushPool([{}]), 4, 1, sub)).body, { subscribed: true, devices: 1 });
});

test('customer website: own manifest and home-screen tags; CSP allows only its manifest', () => {
  const restaurant = { id: 4, name: 'Urban Cafe', slug: 'urban-cafe', currency: 'PKR', locale: 'en' };
  const m = siteManifest(restaurant, { template: 'desi' });
  assert.deepEqual([m.start_url, m.scope, m.display, m.theme_color], ['/r/urban-cafe', '/r/urban-cafe', 'standalone', '#3a0d12']);
  const html = renderSitePage({ restaurant, config: {}, items: [] });
  assert.match(html, /<link rel="manifest" href="\/r\/urban-cafe\/manifest\.webmanifest">/);
  assert.match(html, /apple-touch-icon/);
  assert.match(SITE_CSP, /manifest-src 'self'/);
  assert.ok(!SITE_CSP.includes('script-src'));
});

test('owner app: manifest, service worker, alerts card and hooks on every order path', () => {
  const manifest = JSON.parse(readFileSync('public/owner.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
  const sw = readFileSync('public/sw.js', 'utf8');
  assert.match(sw, /showNotification/);
  assert.match(sw, /notificationclick/);
  const html = readFileSync('public/restaurant.html', 'utf8');
  for (const id of ['app-alerts', 'app-install', 'app-alerts-on', 'new-order-banner']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /rel="manifest" href="\/owner\.webmanifest"/);
  for (const f of ['src/checkout.js', 'src/voice-tools.js', 'src/whatsapp-ai-worker.js']) assert.match(readFileSync(f, 'utf8'), /notifyNewOrder\(pool/, f);
});

import { shouldAlertWhatsApp, notifyActivity, notifyWhatsAppMessage } from '../src/web-push.js';

test('WhatsApp alerts: one per customer per 10 minutes; button taps never ring', async () => {
  const t = 1e12;
  assert.equal(shouldAlertWhatsApp(4, '923001', t), true);
  assert.equal(shouldAlertWhatsApp(4, '923001', t + 60000), false);
  assert.equal(shouldAlertWhatsApp(4, '923002', t + 60000), true);
  assert.equal(shouldAlertWhatsApp(4, '923001', t + 11 * 60000), true);
  assert.deepEqual(await notifyWhatsAppMessage({}, { restaurantId: 4, sender: '9', type: 'interactive', text: 'mk_confirm:1' }), { sent: 0 });
});

test('activity alerts respect the restaurant switches', async () => {
  const pool = { async query() { return [[]]; }, async execute(sql) { if (sql.startsWith('SELECT whatsapp,calls,payments')) return [[{ whatsapp: 0, calls: 1, payments: 1 }]]; if (sql.startsWith('SELECT id,endpoint')) return [[]]; return [{}]; } };
  assert.equal((await notifyActivity(pool, 4, 'whatsapp', { title: 'x' })).reason, 'off');
  assert.equal((await notifyActivity(pool, 4, 'calls', { title: 'x' })).sent, 0, 'on, but no devices');
  assert.equal((await notifyActivity(pool, 4, 'nonsense', { title: 'x' })).sent, 0);
});

test('alerts are wired to WhatsApp messages, AI calls and payment references; saved login survives network errors', () => {
  assert.match(readFileSync('src/integrations.js', 'utf8'), /notifyWhatsAppMessage\(pool/);
  assert.match(readFileSync('src/vapi-events.js', 'utf8'), /notifyCallEnded\(pool/);
  assert.match(readFileSync('src/checkout.js', 'utf8'), /notifyPaymentReference\(pool/);
  assert.match(readFileSync('src/operations.js', 'utf8'), /push\/preferences/);
  const js = readFileSync('public/restaurant.js', 'utf8');
  assert.match(js, /error\.status === 401 \|\| error\.status === 403/);
  assert.match(readFileSync('public/restaurant.html', 'utf8'), /data-alert-kind="whatsapp"/);
});
