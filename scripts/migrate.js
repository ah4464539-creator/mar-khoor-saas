import 'dotenv/config';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
const required=['DB_USER','DB_NAME'];
for(const key of required)if(!process.env[key])throw Error('Missing '+key);
const conn=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,multipleStatements:true});
try{await conn.query(await fs.readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));console.log('MariaDB schema applied successfully');}finally{await conn.end()}
