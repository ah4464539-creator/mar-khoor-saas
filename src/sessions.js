// Login session storage. The server uses the database store; tests and local
// tools use the in-memory store. Only a SHA-256 hash of the token is stored.
import crypto from 'node:crypto';

export const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

export function createMemorySessionStore() {
  const map = new Map();
  return {
    async create(tokenHash, user, ttlSeconds) {
      map.set(tokenHash, { id: user.id, email: user.email, platformRole: user.platformRole, expires: Date.now() + ttlSeconds * 1000 });
    },
    async get(tokenHash) {
      const session = map.get(tokenHash);
      if (!session || session.expires < Date.now()) { map.delete(tokenHash); return null; }
      return { id: session.id, email: session.email, platformRole: session.platformRole };
    },
    async delete(tokenHash) { map.delete(tokenHash); },
  };
}

// Role and email are read from the users table on every request, so a changed
// role or deleted user takes effect immediately.
export function createDbSessionStore(pool) {
  return {
    async create(tokenHash, user, ttlSeconds) {
      await pool.execute('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL ? SECOND))', [tokenHash, user.id, ttlSeconds]);
      // Best-effort cleanup of expired rows; never fails a login.
      await pool.execute('DELETE FROM sessions WHERE expires_at < NOW() LIMIT 200').catch(() => {});
    },
    async get(tokenHash) {
      const [rows] = await pool.execute(
        'SELECT s.user_id AS id, u.email AS email, u.platform_role AS platformRole FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > NOW() LIMIT 1',
        [tokenHash]
      );
      return rows.length ? { id: rows[0].id, email: rows[0].email, platformRole: rows[0].platformRole } : null;
    },
    async delete(tokenHash) { await pool.execute('DELETE FROM sessions WHERE token_hash=?', [tokenHash]); },
  };
}
