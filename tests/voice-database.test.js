import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

test('MariaDB voice assistant isolation and duplicate call constraint',{skip:process.env.DB_INTEGRATION_TEST!=='1'},async()=>{
 const pool=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 const conn=await pool.getConnection();
 try{
  await conn.beginTransaction();
  const tag='voice-ci-'+process.pid+'-'+Date.now();
  const [r]=await conn.execute('INSERT INTO restaurants(name,slug,country_code,currency,locale) VALUES (?,?,?,?,?)',['Voice Test',tag,'PK','PKR','ur']);
  await conn.execute('INSERT INTO voice_assistants(assistant_id,restaurant_id) VALUES (?,?)',[tag,r.insertId]);
  const [mapped]=await conn.execute('SELECT restaurant_id FROM voice_assistants WHERE assistant_id=?',[tag]);
  assert.equal(Number(mapped[0].restaurant_id),Number(r.insertId));
  await conn.execute('INSERT INTO voice_order_requests(assistant_id,call_id,restaurant_id) VALUES (?,?,?)',[tag,'call-1',r.insertId]);
  await assert.rejects(()=>conn.execute('INSERT INTO voice_order_requests(assistant_id,call_id,restaurant_id) VALUES (?,?,?)',[tag,'call-1',r.insertId]),e=>e.code==='ER_DUP_ENTRY');
  const [other]=await conn.execute('SELECT COUNT(*) AS count FROM voice_order_requests WHERE assistant_id=? AND call_id=?',[tag,'call-1']);
  assert.equal(Number(other[0].count),1);
  await conn.rollback();
  const [after]=await conn.execute('SELECT COUNT(*) AS count FROM voice_assistants WHERE assistant_id=?',[tag]);
  assert.equal(Number(after[0].count),0);
 }finally{await conn.rollback().catch(()=>{});conn.release();await pool.end()}
});
