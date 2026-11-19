// Self-service password reset for restaurant accounts.
// POST /auth/password/forgot {email}          -> always the same reply, emails a one-time link if the account exists
// POST /auth/password/reset  {token,password} -> sets the new password, burns the link, signs out every session
// Platform super admins are excluded on purpose; they reset with scripts/create-super-admin.js on the server.
import crypto from 'node:crypto';
import express from 'express';
import { hashPassword } from './auth.js';
import { mailerFromEnv } from './mailer.js';

export const RESET_MINUTES = 30;
const GENERIC = 'If an account exists for this email, a password reset link has been sent. Please check your inbox and spam folder.';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

export function resetBaseUrl(value) {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    return url.origin;
  } catch { return null; }
}

export function resetEmail(link) {
  const subject = 'Reset your Mar-Khoor password';
  const text = `We received a request to reset the password for your Mar-Khoor restaurant account.\n\n`
    + `Open this link to choose a new password (valid for ${RESET_MINUTES} minutes, one use only):\n${link}\n\n`
    + `If you did not request this, you can ignore this email; your password will not change.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#211a17">`
    + `<h2 style="color:#c8601d">Reset your Mar-Khoor password</h2>`
    + `<p>We received a request to reset the password for your Mar-Khoor restaurant account.</p>`
    + `<p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#ff8b3b;color:#211207;font-weight:bold;text-decoration:none">Choose a new password</a></p>`
    + `<p style="font-size:13px;color:#6b5a50">This link is valid for ${RESET_MINUTES} minutes and works once. If you did not request this, ignore this email; your password will not change.</p>`
    + `</div>`;
  return { subject, text, html };
}

export function passwordResetRouter(pool, {
  sendMail = mailerFromEnv(),
  baseUrl = process.env.PUBLIC_BASE_URL,
  log = entry => console.log(JSON.stringify(entry)),
  now = Date.now,
} = {}) {
  const router = express.Router();
  const origin = resetBaseUrl(baseUrl);
  const perEmail = new Map(); // email -> {count, until}; max 3 links per hour per address

  function allowEmail(email) {
    const time = now();
    if (perEmail.size > 10000) for (const [key, entry] of perEmail) if (entry.until <= time) perEmail.delete(key);
    const entry = perEmail.get(email);
    if (!entry || entry.until <= time) { perEmail.set(email, { count: 1, until: time + 3600000 }); return true; }
    entry.count++;
    return entry.count <= 3;
  }

  router.post('/password/forgot', async (req, res) => {
    const raw = req.body?.email;
    if (typeof raw !== 'string' || raw.length > 254 || !EMAIL.test(raw.trim()))
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (!sendMail || !origin) {
      log({ event: 'password_reset_unavailable', reason: !sendMail ? 'mail_not_configured' : 'public_base_url_missing' });
      return res.status(503).json({ error: 'Password reset by email is not available right now. Please contact Mar-Khoor support.' });
    }
    const email = raw.trim().toLowerCase();
    if (!allowEmail(email)) return res.json({ ok: true, message: GENERIC });
    try {
      const [rows] = await pool.execute('SELECT id,email,platform_role FROM users WHERE email=? LIMIT 1', [email]);
      const user = rows[0];
      if (!user || user.platform_role === 'super_admin') return res.json({ ok: true, message: GENERIC });
      const token = crypto.randomBytes(32).toString('hex');
      await pool.execute('DELETE FROM password_resets WHERE user_id=? AND used_at IS NULL', [user.id]);
      await pool.execute('INSERT INTO password_resets (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL ? MINUTE))', [sha256(token), user.id, RESET_MINUTES]);
      // Token travels in the URL fragment, so it never reaches server logs or Referer headers.
      const link = `${origin}/restaurant.html#reset-token=${token}`;
      try {
        await sendMail({ to: user.email, ...resetEmail(link) });
        log({ event: 'password_reset_sent' });
      } catch (error) {
        log({ event: 'password_reset_mail_failed', name: error?.name });
        await pool.execute('DELETE FROM password_resets WHERE token_hash=?', [sha256(token)]).catch(() => {});
      }
      res.json({ ok: true, message: GENERIC });
    } catch {
      res.status(503).json({ error: 'Password reset is temporarily unavailable. Please try again shortly.' });
    }
  });

  router.post('/password/reset', async (req, res) => {
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
    if (typeof password !== 'string' || password.length < 12 || password.length > 1024)
      return res.status(400).json({ error: 'Password must be at least 12 characters.' });
    let connection;
    try {
      const passwordHash = await hashPassword(password);
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        'SELECT r.user_id, u.platform_role FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.used_at IS NULL AND r.expires_at > NOW() LIMIT 1 FOR UPDATE',
        [sha256(token)]);
      if (!rows.length || rows[0].platform_role === 'super_admin') {
        await connection.rollback();
        return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
      }
      const userId = rows[0].user_id;
      await connection.execute('UPDATE users SET password_hash=? WHERE id=?', [passwordHash, userId]);
      await connection.execute('UPDATE password_resets SET used_at=NOW() WHERE user_id=? AND used_at IS NULL', [userId]);
      await connection.execute('DELETE FROM sessions WHERE user_id=?', [userId]);
      await connection.commit();
      log({ event: 'password_reset_completed' });
      res.json({ ok: true });
    } catch {
      if (connection) await connection.rollback().catch(() => {});
      res.status(503).json({ error: 'Password reset is temporarily unavailable. Please try again shortly.' });
    } finally {
      connection?.release?.();
    }
  });

  return router;
}
