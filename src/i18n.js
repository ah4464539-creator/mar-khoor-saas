// Routes for interface translation. See i18n-core.js for the safety model.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rateLimit } from './security.js';
import { LANGUAGES, LANGUAGE_CODES, I18N_SQL, buildAllowlist, translateStrings, pickLanguage } from './i18n-core.js';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

export function i18nRouter(pool, { allowlist = buildAllowlist(publicDir), translator } = {}) {
  const router = express.Router();
  let ready = null;
  const ensure = () => (ready ??= pool.query(I18N_SQL).catch(error => { ready = null; throw error; }));

  router.get('/api/i18n/languages', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ languages: LANGUAGES, suggested: pickLanguage(req.get('accept-language')) });
  });

  router.post('/api/i18n/translate', rateLimit({ windowMs: 60000, max: 60, name: 'i18n' }), express.json({ limit: '128kb' }), async (req, res) => {
    const lang = String(req.body?.lang || '');
    const strings = Array.isArray(req.body?.strings) ? req.body.strings : [];
    if (!LANGUAGE_CODES.has(lang)) return res.status(400).json({ error: 'Unknown language' });
    if (lang === 'en' || !strings.length) return res.json({ lang, translations: {} });
    try {
      await ensure();
      res.set('Cache-Control', 'no-store');
      res.json({ lang, translations: await translateStrings(pool, allowlist, lang, strings, translator ? { translator } : {}) });
    } catch {
      res.status(503).json({ error: 'Translation unavailable', lang, translations: {} });
    }
  });
  return router;
}
