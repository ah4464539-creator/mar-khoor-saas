import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('server mounts all route modules',()=>{const server=read('src/server.js');for(const name of ['authRouter','apiRouter','operationsRouter','checkoutRouter','integrationRouter'])assert.ok(server.includes(name));});
test('tenant access checks membership',()=>assert.match(read('src/operations.js'),/restaurant_members WHERE restaurant_id/));
test('checkout uses database transaction',()=>{const src=read('src/checkout.js');assert.match(src,/beginTransaction/);assert.match(src,/commit\(/);assert.match(src,/rollback\(/)});
test('schema has required core tables',()=>{const sql=read('db/schema.sql');for(const name of ['users','restaurants','restaurant_members','menu_items','orders','order_items'])assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS '+name));});
test('public menu uses safe text rendering',()=>assert.match(read('public/menu.js'),/textContent/));
