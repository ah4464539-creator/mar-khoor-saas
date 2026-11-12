import 'dotenv/config';
import crypto from 'node:crypto';
import {promisify} from 'node:util';
import mysql from 'mysql2/promise';
const scrypt=promisify(crypto.scrypt);
const [,,email,password,name,slug,country='PK',currency='PKR',locale='en']=process.argv;
if(!email||!password||!name||!slug||password.length<12||!/^[a-z0-9-]{2,160}$/.test(slug)||!/^[A-Z]{2}$/.test(country)||!/^[A-Z]{3}$/.test(currency))throw Error('Usage: npm run onboard -- <email> <password>=12+chars <restaurant name> <slug> [country=PK] [currency=PKR] [locale=en]');
if(!process.env.DB_USER||!process.env.DB_NAME)throw Error('DB_USER and DB_NAME required');
const conn=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
try{
 await conn.beginTransaction();
 const salt=crypto.randomBytes(16),hash=await scrypt(password,salt,64);
 const [u]=await conn.execute('INSERT INTO users(email,password_hash) VALUES (?,?)',[email.trim().toLowerCase(),'scrypt:'+salt.toString('hex')+':'+hash.toString('hex')]);
 const [r]=await conn.execute('INSERT INTO restaurants(name,slug,country_code,currency,locale) VALUES (?,?,?,?,?)',[name,slug,country,currency,locale]);
 await conn.execute("INSERT INTO restaurant_members(restaurant_id,user_id,role) VALUES (?,?,'admin')",[r.insertId,u.insertId]);
 await conn.commit();console.log('Created restaurant '+slug+' with admin user ID '+u.insertId);
}catch(err){await conn.rollback();throw err}finally{await conn.end()}
