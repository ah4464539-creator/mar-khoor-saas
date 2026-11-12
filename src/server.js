import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';
import { authRouter } from './auth.js';
import { apiRouter } from './api.js';
import { operationsRouter } from './operations.js';
import { checkoutRouter } from './checkout.js';
import { integrationRouter } from './integrations.js';
import { voiceToolsRouter } from './voice-tools.js';
import { vapiToolAdapterRouter } from './vapi-adapter.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
app.disable('x-powered-by');
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});
app.use('/integrations', integrationRouter(pool));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')));
app.use('/auth', authRouter(pool));
app.use('/api', apiRouter(pool));
app.use('/api', operationsRouter(pool));
app.use('/api', checkoutRouter(pool));
app.use('/voice-tools', voiceToolsRouter(pool));
app.use('/integrations/vapi', vapiToolAdapterRouter(pool));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'mar-khoor-api' }));
app.get('/health/database', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch { res.status(503).json({ status: 'unavailable', database: 'disconnected' }); }
});
const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`Mar-Khoor API listening on ${port}`));
