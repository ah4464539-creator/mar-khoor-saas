// Shared security and monitoring helpers: headers, rate limiting, error handling, audit log.

// Hostinger sits behind a reverse proxy, so req.ip is only the visitor's address when proxy trust is on.
// TRUST_PROXY: number of proxy hops (default 1), or "false" to disable.
export function parseTrustProxy(value) {
  if (value === undefined || value === '') return 1;
  if (/^(false|0)$/i.test(value)) return false;
  const hops = Number(value);
  return Number.isInteger(hops) && hops > 0 && hops <= 5 ? hops : 1;
}

export function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'DENY');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
}

// Fixed-window limiter, in memory (one Node process). Keyed by client IP.
export function rateLimit({ windowMs, max, methods, now = Date.now, name = 'default' }) {
  const hits = new Map();
  return function limiter(req, res, next) {
    if (methods && !methods.includes(req.method)) return next();
    const time = now();
    if (hits.size > 20000) for (const [key, entry] of hits) if (entry.until <= time) hits.delete(key);
    const key = req.ip || 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.until <= time) { entry = { count: 0, until: time + windowMs }; hits.set(key, entry); }
    entry.count++;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.until - time) / 1000))));
      console.warn(JSON.stringify({ event: 'rate_limited', limiter: name }));
      return res.status(429).json({ error: 'Too many requests; try again later' });
    }
    next();
  };
}

// Logs only server errors and throttling, never request bodies or headers.
export function accessLog(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode >= 500) console.error(JSON.stringify({ event: 'http_5xx', method: req.method, path: req.path, status: res.statusCode }));
  });
  next();
}

// JSON error responses with no stack traces.
export function jsonErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  console.error(JSON.stringify({ event: 'unhandled_error', method: req.method, path: req.path, name: err?.name }));
  res.status(500).json({ error: 'Internal error' });
}

// Best-effort audit trail; an audit failure never fails the action itself.
export async function audit(pool, { actorUserId = null, restaurantId = null, action }) {
  try {
    await pool.execute('INSERT INTO audit_logs(actor_user_id,restaurant_id,action) VALUES (?,?,?)', [actorUserId, restaurantId, String(action).slice(0, 120)]);
  } catch {
    console.warn(JSON.stringify({ event: 'audit_failed' }));
  }
}
