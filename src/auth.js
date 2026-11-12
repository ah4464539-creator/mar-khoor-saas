import crypto from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
const scrypt = promisify(crypto.scrypt);
const router = express.Router();
const sessions = new Map(); // Development only: restart invalidates sessions; replace with durable store before production.
const hex = b => b.toString('hex');
export async function hashPassword(password) {
 const salt = crypto.randomBytes(16);
 const hash = await scrypt(password, salt, 64);
 return `scrypt:${hex(salt)}:${hex(hash)}`;
}
async function checkPassword(password, stored) {
 const [algorithm, salt, expected] = String(stored).split(':');
 if (algorithm !== 'scrypt' || !salt || !expected || !/^[a-f0-9]{128}$/.test(expected)) return false;
 const actual = await scrypt(password, Buffer.from(salt,'hex'), 64);
 return crypto.timingSafeEqual(actual, Buffer.from(expected,'hex'));
}
export function authRouter(pool) {
 router.post('/login', async (req,res) => {
  const {email,password} = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 1024)
   return res.status(400).json({error:'Invalid credentials'});
  try {
   const [rows] = await pool.execute('SELECT id,email,password_hash,platform_role FROM users WHERE email=? LIMIT 1',[email.trim().toLowerCase()]);
   if (!rows.length || !(await checkPassword(password,rows[0].password_hash))) return res.status(401).json({error:'Invalid credentials'});
   const token = crypto.randomBytes(32).toString('hex');
   sessions.set(crypto.createHash('sha256').update(token).digest('hex'), {id:rows[0].id,email:rows[0].email,platformRole:rows[0].platform_role,expires:Date.now()+86400000});
   res.json({token,expiresIn:86400});
  } catch {res.status(503).json({error:'Authentication unavailable'});}
 });
 router.get('/me', async (req,res) => {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get('authorization') || '');
  const session = match && sessions.get(crypto.createHash('sha256').update(match[1]).digest('hex'));
  if (!session || session.expires < Date.now()) return res.status(401).json({error:'Unauthorized'});
  try {
   const [rows] = await pool.execute('SELECT restaurant_id,role FROM restaurant_members WHERE user_id=?',[session.id]);
   res.json({user:{id:session.id,email:session.email,platformRole:session.platformRole},memberships:rows});
  } catch {res.status(503).json({error:'Database unavailable'});}
 });
 return router;
}
