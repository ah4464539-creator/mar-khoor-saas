import 'dotenv/config';
import { quotePlan } from './plan-quote.js';
import express from 'express';
import mysql from 'mysql2/promise';
import { authRouter, useSessionStore } from './auth.js';
import { createDbSessionStore } from './sessions.js';
import { apiRouter } from './api.js';
import { operationsRouter } from './operations.js';
import { checkoutRouter } from './checkout.js';
import { integrationRouter } from './integrations.js';
import { registrationRouter } from './registration.js';
import { plansRouter } from './plans.js';
import { sitesRouter } from './sites.js';
import { numbersRouter } from './numbers.js';
import { loadCatalog } from './plan-orders.js';
import { voiceToolsRouter } from './voice-tools.js';
import { vapiToolAdapterRouter } from './vapi-adapter.js';
import { parseTrustProxy, securityHeaders, rateLimit, accessLog, jsonErrorHandler } from './security.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
app.use(securityHeaders);
app.use(accessLog);
process.on('unhandledRejection', reason => console.error(JSON.stringify({ event: 'unhandled_rejection', name: reason?.name })));
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});
useSessionStore(createDbSessionStore(pool));
app.use('/integrations', integrationRouter(pool));
app.use(['/auth/login', '/auth/platform-login'], rateLimit({ windowMs: 15 * 60 * 1000, max: 30, methods: ['POST'], name: 'login' }));
app.use('/api/public', rateLimit({ windowMs: 60 * 1000, max: 120, name: 'public' }));
app.use('/api/public/restaurants/:slug/orders', rateLimit({ windowMs: 10 * 60 * 1000, max: 20, methods: ['POST'], name: 'orders' }));
app.use('/api/restaurants/:restaurantId/site/generate', rateLimit({ windowMs: 60 * 60 * 1000, max: 10, methods: ['POST'], name: 'site-generate' }));
app.use('/api', rateLimit({ windowMs: 10 * 60 * 1000, max: 1500, name: 'api' }));
app.use(express.json({ limit: '1mb' }));
const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
app.get('/super-admin', (_req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.resolve(publicDirectory, '../src/views/super-admin.html'), { cacheControl: false });
});
app.use(express.static(publicDirectory));
app.post('/api/public/plan-quote', async (req, res) => {
  try {
    res.json(quotePlan(req.body, await loadCatalog(pool)));
  } catch (error) {
    if (error instanceof TypeError) return res.status(400).json({ error: error.message });
    res.status(503).json({ error: 'Quote unavailable' });
  }
});
app.use('/auth', authRouter(pool));
app.use('/auth', registrationRouter(pool));
app.use('/api', apiRouter(pool));
app.use('/api', operationsRouter(pool));
app.use('/api', checkoutRouter(pool));
app.use('/api', plansRouter(pool));
app.use('/api', numbersRouter(pool));
app.use(sitesRouter(pool));
app.use('/voice-tools', voiceToolsRouter(pool));
app.use('/integrations/vapi', vapiToolAdapterRouter(pool));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'mar-khoor-api' }));
app.get('/health/database', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch (error) {
    const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code ?? '') ? error.code : 'UNKNOWN';
    console.warn('MariaDB health check failed:', code);
    res.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }
});
app.use(jsonErrorHandler);
const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`Mar-Khoor API listening on ${port}`));
