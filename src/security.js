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
  res.set('X-Permitted-Cross-Domain-Policies', 'none');
  res.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  // Safe for every page (including the older ones with inline scripts): no plugins, no <base> hijack.
  // Routes with their own stricter CSP (generated restaurant sites) replace this header.
  res.set('Content-Security-Policy', "object-src 'none'; base-uri 'self'");
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
}

// Rejects JSON bodies that are suspiciously deep or wide, or that use prototype keys
// (__proto__, constructor, prototype), before any route sees them.
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function inspectJson(value, { maxDepth = 20, maxKeys = 5000 } = {}) {
  let keys = 0;
  const walk = (node, depth) => {
    if (depth > maxDepth) return 'too deep';
    if (Array.isArray(node)) { for (const item of node) { const bad = walk(item, depth + 1); if (bad) return bad; } return null; }
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        if (PROTO_KEYS.has(key)) return 'forbidden key';
        if (++keys > maxKeys) return 'too many fields';
        const bad = walk(node[key], depth + 1);
        if (bad) return bad;
      }
    }
    return null;
  };
  return walk(value, 0);
}
export function jsonGuard(req, res, next) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    const problem = inspectJson(req.body);
    if (problem) { console.warn(JSON.stringify({ event: 'json_rejected', reason: problem, path: req.path })); return res.status(400).json({ error: 'Invalid request body' }); }
  }
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
