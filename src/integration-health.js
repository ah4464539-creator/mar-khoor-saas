import express from 'express';
import { requireAuth } from './auth.js';
import { rateLimit } from './security.js';
import { configStatus, activity, summarize, present } from './integration-health-core.js';

export function integrationHealthRouter(pool, { fetcher = fetch, env = process.env } = {}) {
  const router = express.Router();
  const superOnly = (req, res, next) => req.user.platformRole === 'super_admin' ? next() : res.status(403).json({ error: 'Forbidden' });
  router.get('/api/platform/integrations/health', requireAuth, superOnly, async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json({ checked_at: new Date().toISOString(), channels: summarize(configStatus(env), await activity(pool)) }); }
    catch { res.status(503).json({ error: 'Health check unavailable' }); }
  });
  router.post('/api/platform/integrations/test-openai', rateLimit({ windowMs: 10 * 60 * 1000, max: 5, name: 'test-openai' }), requireAuth, superOnly, async (_req, res) => {
    if (!present(env, 'OPENAI_API_KEY')) return res.json({ ok: false, message: 'OPENAI_API_KEY is not set on the server.' });
    try {
      const response = await fetcher('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY }, signal: AbortSignal.timeout(10000) });
      const message = response.ok ? 'OpenAI accepted the key.' : response.status === 401 ? 'OpenAI rejected the key (401).' : response.status === 429 ? 'Key works but quota or rate limit is reached (429).' : 'OpenAI answered ' + response.status + '.';
      res.json({ ok: response.ok, message });
    } catch { res.json({ ok: false, message: 'Could not reach OpenAI from the server.' }); }
  });
  return router;
}
