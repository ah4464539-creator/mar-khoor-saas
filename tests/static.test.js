import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('server mounts all route modules',()=>{const server=read('src/server.js');for(const name of ['authRouter','apiRouter','operationsRouter','checkoutRouter','integrationRouter'])assert.ok(server.includes(name));});
test('tenant access checks membership',()=>assert.match(read('src/operations.js'),/restaurant_members WHERE restaurant_id/));
test('checkout uses database transaction',()=>{const src=read('src/checkout.js');assert.match(src,/beginTransaction/);assert.match(src,/commit\(/);assert.match(src,/rollback\(/)});
test('schema has required core tables',()=>{const sql=read('db/schema.sql');for(const name of ['users','restaurants','restaurant_members','menu_items','orders','order_items'])assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS '+name));});
test('public menu uses safe text rendering',()=>assert.match(read('public/menu.js'),/textContent/));
test('server mounts registration, plan orders and database-backed quotes',()=>{const server=read('src/server.js');for(const name of ['registrationRouter','plansRouter','loadCatalog'])assert.ok(server.includes(name));});
test('schema has number routing and plan order tables',()=>{const sql=read('db/schema.sql');for(const name of ['number_routes','plan_orders'])assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS '+name));});
test('plan order and number routes are limited to the right roles',()=>{const src=read('src/plans.js');assert.match(src,/superOnly/);assert.match(src,/role='admin'/);assert.match(src,/onlyFrom: 'pending_payment'/)});
test('homepage has a clear registration button and the new panels render text safely',()=>{
 const home=read('public/index.html');
 assert.match(home,/class="button" href="\/register\.html">Register your restaurant/);
 assert.match(home,/class="nav-cta" href="\/register\.html"/);
 for(const file of ['public/register.js','public/restaurant.js','public/platform.js'])assert.ok(!/innerHTML/.test(read(file)),file+' must not use innerHTML');
 assert.match(read('public/restaurant.html'),/id="plan-form"/);
 assert.match(read('public/super-admin.html'),/id="route-form"/);
});
test('register page has every field the script reads',()=>{const html=read('public/register.html'),js=read('public/register.js');for(const id of ['register','restaurant-name','country','email','password','status','done'])assert.ok(html.includes('id="'+id+'"'),id);for(const id of ['#register','#restaurant-name','#country','#email','#password'])assert.ok(js.includes(id),id)});
test('server uses database-backed sessions and schema has the sessions table',()=>{
 assert.match(read('src/server.js'),/useSessionStore\(createDbSessionStore\(pool\)\)/);
 assert.match(read('db/schema.sql'),/CREATE TABLE IF NOT EXISTS sessions/);
 assert.ok(!/new Map\(\)\s*;?\s*\/\/ Development only/.test(read('src/auth.js')));
});
test('server enables proxy trust, security headers, rate limits and a JSON error handler',()=>{
 const server=read('src/server.js');
 for(const text of ['parseTrustProxy','securityHeaders','rateLimit(','jsonErrorHandler',"'/api/public/restaurants/:slug/orders'"])assert.ok(server.includes(text),text);
 assert.ok(server.indexOf('jsonErrorHandler);')>server.indexOf("app.use('/api', plansRouter"));
 assert.ok(read('src/plans.js').includes("audit(pool"));
});
