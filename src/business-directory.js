// Public business directory for the customer app and website (/app, /businesses): every business
// with a published Mar-Khoor website, grouped by category, so customers can find and contact it.
// Only data already public on the business's own website is returned (name, web address, category,
// tagline, logo, and the phone / WhatsApp / address the business shows on its website).
// No express import in the core: testable with mock pools.
import express from 'express';
import { sanitizeSiteConfig } from './site-builder.js';
import { isBusinessType } from './bookings.js';
import { assistantAllowed } from './widget-core.js';

const MAX = 200;

/** Search text: letters, digits and spaces only, at most 60 characters. */
export function cleanQuery(value) {
  return String(value ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} &'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** "+92 300 1234567" -> "+923001234567", or null when it is not a usable number. */
export function phoneDigits(value) {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (raw.startsWith('+') || raw.startsWith('00') ? '+' : '') + digits.replace(/^00/, '');
}

/** wa.me needs the full international number: digits only, or null for a local number. */
export function waNumber(value) {
  const n = phoneDigits(value);
  return n && n.startsWith('+') ? n.slice(1) : null;
}

const aiChat = (row, env) => assistantAllowed({ slug: row.slug, websiteAssistantProvisioned: Number(row.website_assistant_provisioned) === 1 }, env);

export async function listBusinesses(pool, { q = '', category = '', country = '' } = {}, env = process.env) {
  const query = cleanQuery(q);
  const cat = isBusinessType(category) ? category : '';
  const cc = /^[A-Z]{2}$/.test(String(country)) ? String(country) : '';
  // Conditions are added in JS, never as a bound value compared with a quoted literal (MariaDB collation errors on production).
  const where = ['s.published=1'];
  const params = [];
  if (query) { where.push('r.name LIKE ?'); params.push('%' + query.replace(/[%_]/g, '') + '%'); }
  if (cc) { where.push('r.country_code=?'); params.push(cc); }
  if (cat === 'restaurant') where.push("(p.category IS NULL OR p.category='restaurant')");
  else if (cat) { where.push('p.category=?'); params.push(cat); }
  let rows;
  try {
    [rows] = await pool.execute(
      'SELECT r.id,r.name,r.slug,r.country_code,r.website_assistant_provisioned,s.config,p.category FROM restaurants r JOIN restaurant_sites s ON s.restaurant_id=r.id '
      + 'LEFT JOIN business_profiles p ON p.restaurant_id=r.id WHERE ' + where.join(' AND ') + ' ORDER BY r.name LIMIT ' + MAX, params);
  } catch (error) {
    // business_profiles may not exist on a fresh database: list everything as restaurants.
    if (error?.code !== 'ER_NO_SUCH_TABLE' || cat) throw error;
    [rows] = await pool.execute('SELECT r.id,r.name,r.slug,r.country_code,r.website_assistant_provisioned,s.config,NULL AS category FROM restaurants r JOIN restaurant_sites s ON s.restaurant_id=r.id WHERE '
      + where.join(' AND ') + ' ORDER BY r.name LIMIT ' + MAX, params);
  }
  return rows.filter(row => /^[a-z0-9-]{1,160}$/.test(row.slug)).map(row => {
    let config = {};
    try { config = sanitizeSiteConfig(JSON.parse(row.config || '{}'), row); } catch { config = {}; }
    return {
      name: String(row.name).slice(0, 160), slug: row.slug, url: '/r/' + row.slug,
      category: isBusinessType(row.category) ? row.category : 'restaurant',
      country: row.country_code || null, tagline: config.tagline || '', logo: config.logo || null,
      phone: phoneDigits(config.phone), whatsapp: waNumber(config.whatsapp),
      address: config.address || '',
      // The business page's AI assistant: chat, and live voice when voice is switched on.
      ai_chat: aiChat(row, env), ai_voice: aiChat(row, env) && env.RESTAURANT_WEBSITE_VOICE_ENABLED === 'true',
    };
  });
}

export function businessDirectoryRouter(pool) {
  const router = express.Router();
  router.get('/api/public/businesses', async (req, res) => {
    try {
      const businesses = await listBusinesses(pool, { q: req.query.q, category: req.query.category, country: String(req.query.country || '').toUpperCase() });
      res.set('Cache-Control', 'public, max-age=60').json({ businesses });
    } catch { res.status(503).json({ error: 'Directory unavailable' }); }
  });
  return router;
}
