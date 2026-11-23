import express from 'express';
import { requireAuth } from './auth.js';

// Deliberately read-only. No tenant mutation, phone forwarding, order creation,
// recording, or provider calls are permitted by this test-lab API.
const TYPES = Object.freeze(['restaurant', 'clinic', 'hotel', 'salon']);
const CHECKS = Object.freeze({
  restaurant: ['menu isolation', 'confirmed order authorization', 'COD workflow'],
  clinic: ['doctor availability', 'appointment consent', 'patient privacy'],
  hotel: ['room availability', 'guest/date validation', 'booking confirmation'],
  salon: ['service catalog', 'staff availability', 'slot booking']
});
export function aiTestLabRouter() {
  const router = express.Router();
  router.use(requireAuth);
  router.use((req, res, next) => {
    if (req.user?.platformRole !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/status', (_req, res) => res.json({
    mode: 'preview', liveRoutingEnabled: false, recordingEnabled: false,
    phoneNumberConfigured: false, providerVerified: false, stagingIsolationVerified: false,
    businessTypes: TYPES, requiresStagingVerification: true
  }));
  router.get('/businesses/:type/checklist', (req, res) => {
    const type = String(req.params.type).toLowerCase();
    if (!TYPES.includes(type)) return res.status(404).json({ error: 'Unknown business type' });
    res.json({ type, checks: CHECKS[type], verified: false, mode: 'preview' });
  });
  return router;
}
