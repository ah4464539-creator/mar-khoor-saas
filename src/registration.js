import express from 'express';
import { hashPassword } from './auth.js';
import { registerRestaurant } from './registration-core.js';
import { assignRegistrationNumber } from './registration-voice.js';
import { isBusinessType, saveProfile } from './bookings.js';

const WINDOW_MS = 60 * 60 * 1000, MAX_PER_WINDOW = 5;
const attempts = new Map(); // per IP; in-memory like login throttling. Add proxy-level limits in production.

function limited(ip) {
 const now = Date.now();
 if (attempts.size > 10000) for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
 const entry = attempts.get(ip);
 if (!entry || entry.until <= now) { attempts.set(ip, { count: 1, until: now + WINDOW_MS }); return false; }
 entry.count++;
 return entry.count > MAX_PER_WINDOW;
}

export function registrationRouter(pool) {
 const router = express.Router();
 router.post('/register', async (req, res) => {
  if (limited(req.ip || 'unknown')) return res.status(429).json({ error: 'Too many registrations; try again later' });
  const result = await registerRestaurant(pool, req.body, hashPassword);
  if (result.status === 201) {
   const category = isBusinessType(req.body?.business_type) ? req.body.business_type : 'restaurant';
   result.body.category = category;
   await saveProfile(pool, result.body.restaurant_id, { category }).catch(error => console.warn('business profile skipped:', error?.code || error?.message));
   result.body.voice = process.env.REGISTRATION_VOICE_POOL_ENABLED === '1'
    ? await assignRegistrationNumber(pool, result.body.restaurant_id, result.body.country)
    : { status: 'pending' };
  }
  res.status(result.status).json(result.body);
 });
 return router;
}
