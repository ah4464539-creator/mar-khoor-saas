import 'dotenv/config';
import crypto from 'node:crypto';
import {promisify} from 'node:util';
import mysql from 'mysql2/promise';
const scrypt=promisify(crypto.scrypt);
const [,,email,password]=process.argv;
if(!email||!password||password.length<12)throw Error('Usage: npm run create-super-admin -- <email> <password-12+-chars>');
if(!process.env.DB_USER||!process.env.DB_NAME)throw Error('DB_USER and DB_NAME required');
const salt=crypto.randomBytes(16),hash=await scrypt(password,salt,64);
const conn=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
try{
 await conn.execute("INSERT INTO users(email,password_hash,platform_role) VALUES (?,?,'super_admin')",[email.trim().toLowerCase(),'scrypt:'+salt.toString('hex')+':'+hash.toString('hex')]);
 console.log('Super admin created');
}finally{await conn.end()}
