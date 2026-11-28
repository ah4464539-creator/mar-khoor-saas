// HTTP routes for customer accounts (see customer-accounts.js). The session travels in the
// X-Customer-Session header (kept in the app's storage), never in a cookie, so it cannot be used
// by other sites and never reaches the business dashboard.
import express from 'express';
import { rateLimit } from './security.js';
import { mailerFromEnv } from './mailer.js';
import { requestLogin, completeLogin, customerFromSession, logout, syncOrders, listBookings } from './customer-accounts.js';

export function customerAccountRouter(pool, { sendMail = mailerFromEnv(), origin = String(process.env.PUBLIC_BASE_URL || 'https://mar-khoor.com').replace(/\/+$/, '') } = {}) {
  const router = express.Router();
  const base = '/api/public/customer';
  const signedIn = async (req, res, next) => {
    const account = await customerFromSession(pool, req.get('x-customer-session'));
    if (!account) return res.status(401).json({ error: 'Please sign in again' });
    req.customer = account;
    next();
  };
  const send = (res, result) => res.set('Cache-Control', 'no-store').status(result.status).json(result.body);
  const safe = handler => async (req, res, next) => { try { await handler(req, res, next); } catch { res.status(503).json({ error: 'Accounts are unavailable right now' }); } };

  router.post(base + '/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 5, methods: ['POST'], name: 'customer-login' }), safe(async (req, res) => send(res, await requestLogin(pool, req.body, { sendMail, origin }))));
  router.post(base + '/session', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, methods: ['POST'], name: 'customer-session' }), safe(async (req, res) => send(res, await completeLogin(pool, req.body))));
  router.get(base + '/me', safe(signedIn), (req, res) => send(res, { status: 200, body: { email: req.customer.email } }));
  router.post(base + '/orders/sync', safe(signedIn), safe(async (req, res) => send(res, await syncOrders(pool, req.customer, req.body))));
  router.get(base + '/bookings', safe(signedIn), safe(async (req, res) => send(res, await listBookings(pool, req.customer))));
  router.post(base + '/logout', safe(async (req, res) => send(res, await logout(pool, req.get('x-customer-session')))));
  return router;
}
