// Production readiness of each channel for the platform owner: which settings exist (names only,
// never values) and whether real traffic has been seen recently. "configured" still needs a live test.
import { checkIntegrationReadiness } from '../scripts/check-integrations.js';
import { stripeReady } from './stripe-checkout.js';

export const present = (env, name) => Boolean(env[name]) && !/^(replace_|your_|changeme)/i.test(env[name]);

export function configStatus(env = process.env) {
  const readiness = checkIntegrationReadiness(env);
  const need = names => names.filter(name => !present(env, name));
  return {
    whatsapp: { missing: [...readiness.groups.meta_webhook.missing, ...readiness.groups.meta_sending.missing] },
    ai: { missing: readiness.groups.ai.missing },
    voice: { missing: [...need(['VAPI_API_KEY', 'VAPI_TOOL_SECRET']), ...(present(env, 'VAPI_WEBHOOK_SECRET') || present(env, 'VAPI_WEBHOOK_HMAC_SECRET') ? [] : ['VAPI_WEBHOOK_SECRET or VAPI_WEBHOOK_HMAC_SECRET'])] },
    numbers: { missing: need(['TELNYX_API_KEY']) },
    domains: { missing: need(['HOSTINGER_API_TOKEN', 'HOSTINGER_USERNAME']) },
    email: { missing: present(env, 'MAIL_FROM') && (present(env, 'RESEND_API_KEY') || (present(env, 'SMTP_HOST') && present(env, 'SMTP_USER') && present(env, 'SMTP_PASSWORD'))) ? [] : ['MAIL_FROM with RESEND_API_KEY or SMTP_*'] },
    payments: { missing: stripeReady(env) ? [] : ['STRIPE_CHECKOUT_ENABLED=1, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET'], deferred: !stripeReady(env) },
  };
}

async function one(pool, sql) {
  try { const [rows] = await pool.execute(sql); return rows[0] ?? {}; } catch { return null; }
}

export async function activity(pool) {
  const [inbound, outbound, jobs, calls, orders, cash] = await Promise.all([
    one(pool, 'SELECT MAX(received_at) AS last_at, COUNT(CASE WHEN received_at>=NOW()-INTERVAL 7 DAY THEN 1 END) AS week FROM whatsapp_inbound_messages'),
    one(pool, "SELECT MAX(status_at) AS last_at, COUNT(CASE WHEN status IN ('delivered','read') AND status_at>=NOW()-INTERVAL 7 DAY THEN 1 END) AS delivered_week, COUNT(CASE WHEN status='failed' AND status_at>=NOW()-INTERVAL 7 DAY THEN 1 END) AS failed_week FROM whatsapp_outbound_messages"),
    one(pool, "SELECT MAX(created_at) AS last_at, COUNT(CASE WHEN status='pending' THEN 1 END) AS pending, COUNT(CASE WHEN status='failed' AND created_at>=NOW()-INTERVAL 7 DAY THEN 1 END) AS failed_week FROM whatsapp_ai_jobs"),
    one(pool, 'SELECT MAX(started_at) AS last_at, COUNT(CASE WHEN started_at>=NOW()-INTERVAL 7 DAY THEN 1 END) AS week FROM voice_calls'),
    one(pool, 'SELECT MAX(created_at) AS last_at, COUNT(CASE WHEN created_at>=CURRENT_DATE THEN 1 END) AS today FROM orders'),
    one(pool, "SELECT COUNT(*) AS week FROM order_fulfillment f JOIN orders o ON o.id=f.order_id WHERE f.payment_method IN ('cod','cash_pickup') AND o.created_at>=NOW()-INTERVAL 7 DAY"),
  ]);
  return { inbound, outbound, jobs, calls, orders, cash };
}

const recent = (value, days = 7) => value && Date.now() - new Date(value).getTime() < days * 86400000;

export function summarize(config, act) {
  const channel = (missing, live, note) => ({ status: missing.length ? 'missing' : live ? 'live' : 'configured', missing, note });
  return {
    whatsapp: channel(config.whatsapp.missing, recent(act.inbound?.last_at) && Number(act.outbound?.delivered_week) > 0,
      act.inbound ? `Inbound last 7 days: ${Number(act.inbound.week) || 0}. Delivered replies: ${Number(act.outbound?.delivered_week) || 0}. Failed: ${Number(act.outbound?.failed_week) || 0}. AI jobs pending: ${Number(act.jobs?.pending) || 0}.` : 'WhatsApp tables not available.'),
    ai: channel(config.ai.missing, false, 'Use “Test OpenAI” to confirm the key works.'),
    voice: channel(config.voice.missing, recent(act.calls?.last_at), act.calls ? `Calls in last 7 days: ${Number(act.calls.week) || 0}.` : 'Call table not available.'),
    numbers: channel(config.numbers.missing, false, 'Needed to buy dedicated AI numbers automatically.'),
    domains: channel(config.domains.missing, false, 'Connects restaurant domains automatically (hosting, DNS, SSL) and lets you buy domains for restaurants.'),
    email: channel(config.email.missing, false, 'Needed for password-reset emails.'),
    payments: config.payments.deferred
      ? { status: 'deferred', missing: config.payments.missing, note: `Online card payments are intentionally off. Cash on delivery/pickup is live (${Number(act.cash?.week) || 0} cash orders in 7 days).` }
      : channel([], false, 'Stripe is enabled; place one small live test payment.'),
    orders: { status: recent(act.orders?.last_at, 2) ? 'live' : 'configured', missing: [], note: `Orders today: ${Number(act.orders?.today) || 0}.` },
  };
}

