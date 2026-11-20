// Website widget: lets an owner run Mar-Khoor tools (AI Assistant chat, WhatsApp button,
// AI Caller button) on a website they already have, with one <script> line.
// Pure helpers only (no express) so they are testable without the web server.

export const WIDGET_SQL = `CREATE TABLE IF NOT EXISTS restaurant_widget (
 restaurant_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 config TEXT NOT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

const ensured = new WeakMap();
export function ensureWidgetTable(pool) {
  if (!ensured.has(pool)) ensured.set(pool, pool.query(WIDGET_SQL).catch(error => { ensured.delete(pool); throw error; }));
  return ensured.get(pool);
}

export const DEFAULT_WIDGET = Object.freeze({
  enabled: false, assistant: true, whatsapp: true, call: true,
  whatsapp_number: '', call_number: '', color: '#ff952f', position: 'right',
  label: 'Order with AI', greeting: '', origins: [],
});

const phone = value => {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/[\s()-]/g, '').replace(/^00/, '+');
  // A leading 0 is a local number without country code: WhatsApp links need the country code.
  return /^\+?[1-9][0-9]{6,14}$/.test(digits) ? (digits.startsWith('+') ? digits : '+' + digits) : '';
};
const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '';

/** Accepts "https://mysite.com/page", "mysite.com" or "*.mysite.com"; returns a CSP source or null. */
export function normalizeOrigin(value) {
  if (typeof value !== 'string') return null;
  let input = value.trim().toLowerCase();
  if (!input) return null;
  if (!/^https?:\/\//.test(input)) input = 'https://' + input;
  const wildcard = input.includes('://*.');
  try {
    const url = new URL(input.replace('://*.', '://wildcard.'));
    const host = url.hostname.replace(/^wildcard\./, '');
    if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) && host !== 'localhost') return null;
    return url.protocol + '//' + (wildcard ? '*.' : '') + host + (url.port ? ':' + url.port : '');
  } catch { return null; }
}

export function sanitizeWidgetConfig(source = {}) {
  const s = source && typeof source === 'object' ? source : {};
  const origins = (Array.isArray(s.origins) ? s.origins : typeof s.origins === 'string' ? s.origins.split(/[\s,]+/) : [])
    .map(normalizeOrigin).filter(Boolean);
  return {
    enabled: s.enabled === true,
    assistant: s.assistant !== false,
    whatsapp: s.whatsapp !== false,
    call: s.call !== false,
    whatsapp_number: phone(s.whatsapp_number),
    call_number: phone(s.call_number),
    color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : DEFAULT_WIDGET.color,
    position: s.position === 'left' ? 'left' : 'right',
    label: text(s.label, 40) || DEFAULT_WIDGET.label,
    greeting: text(s.greeting, 200),
    origins: [...new Set(origins)].slice(0, 10),
  };
}

export function parseWidgetConfig(textValue) {
  try { return sanitizeWidgetConfig(JSON.parse(textValue)); } catch { return sanitizeWidgetConfig(DEFAULT_WIDGET); }
}

/** CSP frame-ancestors for the chat iframe: only the owner's sites, or any https site if none listed. */
export function frameAncestors(config) {
  return config.origins.length ? config.origins.join(' ') : 'https:';
}

export function embedSnippet(baseUrl, slug) {
  return '<script src="' + baseUrl + '/embed.js" data-restaurant="' + slug + '" async></script>';
}

/** Numbers already connected in Mar-Khoor, used when the owner leaves the widget numbers empty. */
export async function connectedNumbers(pool, restaurantId) {
  const out = { whatsapp: '', call: '' };
  try {
    const [integrations] = await pool.execute("SELECT kind,value FROM restaurant_integrations WHERE restaurant_id=? AND kind IN ('whatsapp','ai_caller') AND status<>'skipped'", [restaurantId]);
    for (const row of integrations) {
      if (row.kind === 'whatsapp') out.whatsapp = phone(row.value || '');
      if (row.kind === 'ai_caller') out.call = phone(row.value || '');
    }
  } catch { /* table may not exist on very old installs */ }
  try {
    const [numbers] = await pool.execute("SELECT phone_number FROM restaurant_numbers WHERE restaurant_id=? AND status='active' ORDER BY id DESC LIMIT 1", [restaurantId]);
    if (numbers.length) out.call = phone(numbers[0].phone_number) || out.call;
  } catch { /* ignore */ }
  return out;
}

/** What the public embed script needs. Never includes anything private. */
export function publicWidget(config, numbers, { assistantAvailable }) {
  const whatsapp = config.whatsapp ? (config.whatsapp_number || numbers.whatsapp) : '';
  const call = config.call ? (config.call_number || numbers.call) : '';
  return {
    enabled: config.enabled,
    color: config.color, position: config.position, label: config.label,
    tools: {
      assistant: Boolean(config.enabled && config.assistant && assistantAvailable),
      whatsapp: config.enabled && whatsapp ? whatsapp.replace(/^\+/, '') : '',
      call: config.enabled && call ? call : '',
    },
  };
}

/** Same rule the restaurant website uses to show its AI Assistant (plan provisioning and switches). */
export function assistantAllowed(restaurant, env = process.env) {
  return env.RESTAURANT_WEBSITE_ASSISTANT_ENABLED === 'true' ||
    (env.REGISTRATION_WEBSITE_ASSISTANT_ENABLED !== 'false' && restaurant.websiteAssistantProvisioned === true) ||
    (restaurant.slug === 'urban-cafe' && env.URBAN_CAFE_DEMO_ASSISTANT_ENABLED === 'true');
}

/** Readable text colour on the owner's chosen accent colour. */
export function inkOn(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#190d05' : '#ffffff';
}
