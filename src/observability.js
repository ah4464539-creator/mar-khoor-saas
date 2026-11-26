// Structured logging, request ids, error tracking and worker health. No dependencies.
//
// Logs: one JSON line per event ({"level","event","time",...}) on stdout/stderr, which Hostinger keeps
// in the Node.js runtime logs. Secrets are redacted by key name and long digit runs (phone numbers,
// card numbers) are masked, so a log line never carries credentials or customer numbers.
//
// Error tracking: set ERROR_TRACKING_WEBHOOK_URL to any HTTPS endpoint that accepts JSON (a Slack or
// Discord incoming webhook, an uptime/alerting tool, or your own collector). Unhandled errors, 5xx
// responses and worker failures are posted there, throttled. A Sentry SDK can replace reportError later.
import crypto from 'node:crypto';

const SECRET_KEY = /pass(word)?|secret|token|authori[sz]ation|api[_-]?key|cookie|signature|card|cvc|iban/i;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function maskText(value) {
  return String(value ?? '').replace(/\+?\d[\d\s-]{6,}\d/g, '[number]').replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]').slice(0, 500);
}

export function redact(value, depth = 0) {
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(item, depth + 1);
    return out;
  }
  if (typeof value === 'string') return maskText(value);
  return value;
}

export function createLogger({ base = {}, sink = console, level = process.env.LOG_LEVEL || 'info', now = () => new Date() } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, event, fields = {}) => {
    if (LEVELS[lvl] < min) return null;
    const line = JSON.stringify({ level: lvl, event: String(event).slice(0, 80), time: now().toISOString(), ...redact(base), ...redact(fields) });
    (lvl === 'error' ? sink.error : lvl === 'warn' ? sink.warn : sink.log).call(sink, line);
    return line;
  };
  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    child: fields => createLogger({ base: { ...base, ...fields }, sink, level, now }),
  };
}
export const log = createLogger();

// ---- Request id + request log ----
const INCOMING_ID = /^[A-Za-z0-9._-]{8,64}$/;
/** Gives every request an id (kept from X-Request-Id when it looks safe) and echoes it back. */
export function requestId(req, res, next) {
  const incoming = req.get?.('x-request-id');
  req.id = INCOMING_ID.test(incoming || '') ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}

/** Logs server errors and slow requests (never bodies, headers or query strings) and reports 5xx. */
export function requestLog({ logger = log, slowMs = Number(process.env.SLOW_REQUEST_MS) || 3000, report = reportError } = {}) {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const fields = { method: req.method, path: req.path, status: res.statusCode, duration_ms: Math.round(ms), request_id: req.id };
      if (res.statusCode >= 500) { logger.error('http_5xx', fields); report(null, { event: 'http_5xx', ...fields }); }
      else if (ms >= slowMs) logger.warn('http_slow', fields);
    });
    next();
  };
}

// ---- Error tracking hook ----
const recent = new Map();
let windowStart = 0, sentInWindow = 0;
export function errorTrackingUrl(env = process.env) {
  try { const u = new URL(String(env.ERROR_TRACKING_WEBHOOK_URL || '')); return u.protocol === 'https:' ? u.href : null; } catch { return null; }
}
/**
 * Sends one error report to ERROR_TRACKING_WEBHOOK_URL. Throttled (same error once a minute, at most
 * 20 reports a minute) and never throws. Returns true when a report was sent.
 */
export async function reportError(error, context = {}, { env = process.env, fetcher = fetch, now = Date.now() } = {}) {
  const url = errorTrackingUrl(env);
  if (!url) return false;
  const name = error?.name || context.event || 'error';
  const message = maskText(error?.message || context.message || '');
  const signature = name + '|' + message.slice(0, 80) + '|' + (context.path || '');
  if (now - windowStart > 60000) { windowStart = now; sentInWindow = 0; }
  const last = recent.get(signature);
  if ((last !== undefined && last > now - 60000) || sentInWindow >= 20) return false;
  recent.set(signature, now); sentInWindow++;
  if (recent.size > 500) recent.clear();
  const frames = String(error?.stack || '').split('\n').slice(1, 6).map(line => line.trim().replace(/\(?\/[^)]*\/(src|scripts)\//, '($1/')).join(' | ');
  const payload = { service: 'mar-khoor-api', release: env.APP_RELEASE || null, environment: env.NODE_ENV || 'production', time: new Date(now).toISOString(), name, message, stack: frames || null, ...redact(context) };
  payload.text = '[mar-khoor] ' + name + (message ? ': ' + message : '') + (context.path ? ' (' + context.method + ' ' + context.path + ')' : '');
  try {
    await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000), redirect: 'error' });
    return true;
  } catch { return false; }
}
export function resetErrorThrottle() { recent.clear(); windowStart = 0; sentInWindow = 0; }

/** Logs and reports process-level failures. An uncaught exception still ends the process (Hostinger restarts it). */
export function installProcessHandlers({ logger = log, exit = code => process.exit(code) } = {}) {
  process.on('unhandledRejection', reason => {
    logger.error('unhandled_rejection', { name: reason?.name, message: reason?.message });
    reportError(reason instanceof Error ? reason : new Error(String(reason)), { event: 'unhandled_rejection' });
  });
  process.on('uncaughtException', error => {
    logger.error('uncaught_exception', { name: error?.name, message: error?.message });
    Promise.race([reportError(error, { event: 'uncaught_exception' }), new Promise(r => setTimeout(r, 2000))]).finally(() => exit(1));
  });
}

// ---- Worker health ----
const workers = new Map();
/** Registers a background worker and the longest normal gap between two runs. */
export function registerWorker(name, { intervalMs }) {
  workers.set(name, { name, intervalMs, lastRunAt: null, lastOkAt: null, lastError: null, disabled: null, startedAt: Date.now() });
}
export function workerDisabled(name, reason) {
  const w = workers.get(name) || { name, intervalMs: 0, startedAt: Date.now() };
  workers.set(name, { ...w, disabled: String(reason).slice(0, 120) });
}
/** Call after every run. ok=false records the (masked) error and reports it. */
export function heartbeat(name, { ok = true, error = null, now = Date.now() } = {}) {
  const w = workers.get(name);
  if (!w) return;
  w.lastRunAt = now;
  if (ok) { w.lastOkAt = now; w.lastError = null; }
  else { w.lastError = maskText(error?.code || error?.message || error || 'failed').slice(0, 120); reportError(error instanceof Error ? error : new Error(w.lastError), { event: 'worker_failed', worker: name }); }
}
/**
 * Status of every worker: ok, failing (last run failed), stale (missed 3 runs), starting or disabled.
 * The overall status is 'degraded' when any enabled worker is failing or stale.
 */
export function workerHealth(now = Date.now()) {
  const list = [...workers.values()].map(w => {
    const age = w.lastRunAt ? Math.round((now - w.lastRunAt) / 1000) : null;
    const status = w.disabled ? 'disabled'
      : !w.lastRunAt ? (now - w.startedAt > 3 * w.intervalMs + 120000 ? 'stale' : 'starting')
      : w.lastError ? 'failing'
      : now - w.lastRunAt > 3 * w.intervalMs ? 'stale' : 'ok';
    return { name: w.name, status, last_run_seconds_ago: age, ...(w.disabled ? { reason: w.disabled } : {}), ...(w.lastError ? { last_error: w.lastError } : {}) };
  });
  return { status: list.some(w => w.status === 'failing' || w.status === 'stale') ? 'degraded' : 'ok', workers: list };
}
export function resetWorkers() { workers.clear(); }
