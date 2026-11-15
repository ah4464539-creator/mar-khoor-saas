import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import mysql from 'mysql2/promise';
import { hashPassword } from '../src/auth.js';

const email = process.argv[2]?.trim().toLowerCase();
if (process.argv.length !== 3 || !email) throw Error('Usage: node scripts/reset-super-admin-password.js <owner-email>');
if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Run this command in an interactive terminal.');
if (!process.env.DB_USER || !process.env.DB_NAME) throw Error('DB_USER and DB_NAME required');

const terminal = createInterface({ input: process.stdin, terminal: false });
const stty = (...args) => execFileSync('stty', args, { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
const originalMode = stty('-g').trim();
const restoreTerminal = () => stty(originalMode);
const cancel = () => process.exit(130);
process.once('exit', restoreTerminal);
process.once('SIGINT', cancel);

let password;
try {
  stty('-echo');
  process.stdout.write('New password (12+ characters): ');
  password = await terminal.question('');
  process.stdout.write('\nConfirm new password: ');
  const confirmation = await terminal.question('');
  if (password.length < 12 || password.length > 1024) throw Error('Password must contain 12 to 1024 characters.');
  if (password !== confirmation) throw Error('Passwords do not match.');
} finally {
  terminal.close();
  restoreTerminal();
  process.removeListener('exit', restoreTerminal);
  process.removeListener('SIGINT', cancel);
  process.stdout.write('\n');
}

const passwordHash = await hashPassword(password);
password = undefined;

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
try {
  await connection.beginTransaction();
  const [owners] = await connection.execute(
    "SELECT id FROM users WHERE email = ? AND platform_role = 'super_admin' LIMIT 1 FOR UPDATE",
    [email],
  );
  if (!owners.length) throw Error('No existing Super Admin account matches that email.');
  const [{ id }] = owners;
  await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  await connection.execute('DELETE FROM sessions WHERE user_id = ?', [id]);
  await connection.commit();
  console.log('Super Admin password reset. Existing sessions were revoked.');
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
