import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const enabled=process.env.DB_INTEGRATION_TEST==='1';
test('MariaDB schema, foreign keys, and order transaction', {skip:!enabled},async()=>{
 const pool=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:2});
 const conn=await pool.getConnection();
 try{
  await conn.beginTransaction();
  const tag='ci-'+process.pid+'-'+Date.now();
  const [r]=await conn.execute('INSERT INTO restaurants(name,slug,country_code,currency,locale) VALUES (?,?,?,?,?)',['CI Test',tag,'PK','PKR','en']);
  const [m]=await conn.execute('INSERT INTO menu_items(restaurant_id,name,price_minor) VALUES (?,?,?)',[r.insertId,'Test meal',450]);
  const [o]=await conn.execute('INSERT INTO orders(restaurant_id,customer_name,total_minor) VALUES (?,?,?)',[r.insertId,'Test customer',900]);
  await conn.execute('INSERT INTO order_items(order_id,menu_item_id,name_snapshot,quantity,unit_price_minor) VALUES (?,?,?,?,?)',[o.insertId,m.insertId,'Test meal',2,450]);
  const [[result]]=await conn.execute('SELECT o.total_minor,COUNT(oi.id) AS line_count FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.id=? GROUP BY o.id',[o.insertId]);
  assert.equal(Number(result.total_minor),900);
  assert.equal(Number(result.line_count),1);
  await conn.rollback();
  const [[after]]=await conn.execute('SELECT COUNT(*) AS count FROM orders WHERE id=?',[o.insertId]);
  assert.equal(Number(after.count),0);
 }finally{try{await conn.rollback()}catch{}conn.release();await pool.end()}
});
