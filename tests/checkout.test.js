import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {checkoutRouter} from '../src/checkout.js';

async function serve(pool,fn){
 const app=express();app.use(express.json());app.use('/api',checkoutRouter(pool));
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 try{await fn('http://127.0.0.1:'+server.address().port)}
 finally{await new Promise(resolve=>server.close(resolve))}
}
function fakePool({available=true}={}){
 const state={begun:0,commits:0,rollbacks:0,orders:[],lines:[],released:0,requestIds:new Set()};
 const connection={
  async beginTransaction(){state.begun++},
  async commit(){state.commits++},
  async rollback(){state.rollbacks++},
  release(){state.released++},
  async execute(sql,args){
   if(sql.startsWith('SELECT id FROM restaurants'))return [[{id:9}]];
   if(sql.startsWith('INSERT INTO orders')){
    const key=args[3];
    if(key && state.requestIds.has(key)) { const err=new Error('duplicate');err.code='ER_DUP_ENTRY';throw err; }
    if(key) state.requestIds.add(key);
    state.orders.push(args);return [{insertId:77}]
   }
   if(sql.startsWith('INSERT INTO order_items')){state.lines.push(args);return [{insertId:88}]}
   if(sql.startsWith('INSERT INTO order_tracking')){state.tracking=args;return [{affectedRows:1}]}
   throw Error('Unexpected SQL '+sql);
  },
  async query(sql,args){
   if(sql.includes('FROM menu_items'))return [available?[{id:5,name:'Pizza',price_minor:1299}]:[]];
   throw Error('Unexpected SQL '+sql);
  }
 };
 return {state,async getConnection(){return connection}};
}
test('checkout commits database-priced order atomically',async()=>{
 const pool=fakePool();
 await serve(pool,async base=>{
  const response=await fetch(base+'/api/public/restaurants/test-cafe/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_name:'Customer',items:[{menu_item_id:5,quantity:2}]})});
  assert.equal(response.status,201);
  const body=await response.json();
  assert.equal(body.order_id,77);assert.equal(body.status,'pending');assert.equal(body.total_minor,2598);
  assert.match(body.tracking_token,/^[a-f0-9]{48}$/);
  assert.equal(pool.state.tracking[0],77);assert.notEqual(pool.state.tracking[1],body.tracking_token);assert.match(pool.state.tracking[1],/^[a-f0-9]{64}$/);
 });
 assert.equal(pool.state.commits,1);assert.equal(pool.state.rollbacks,0);
 assert.deepEqual(pool.state.orders[0],[9,'Customer',2598,null]);
 assert.deepEqual(pool.state.lines[0],[77,5,'Pizza',2,1299]);
 assert.equal(pool.state.released,1);
});
test('checkout rolls back if item is not on active menu',async()=>{
 const pool=fakePool({available:false});
 await serve(pool,async base=>{
  const response=await fetch(base+'/api/public/restaurants/test-cafe/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_name:'Customer',items:[{menu_item_id:5,quantity:1}]})});
  assert.equal(response.status,409);
 });
 assert.equal(pool.state.commits,0);assert.equal(pool.state.rollbacks,1);assert.equal(pool.state.orders.length,0);
});
test('checkout rejects invalid quantities before opening a transaction',async()=>{
 const pool=fakePool();
 await serve(pool,async base=>{
  const response=await fetch(base+'/api/public/restaurants/test-cafe/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_name:'Customer',items:[{menu_item_id:5,quantity:0}]})});
  assert.equal(response.status,400);
 });
 assert.equal(pool.state.begun,0);
});

test('voice web checkout request ID is idempotent and never creates a second order',async()=>{
 const pool=fakePool();
 const payload={customer_name:'A customer',items:[{menu_item_id:5,quantity:1}],
   client_request_id:'f46ed7c9-a917-471c-bac4-72e6d333ba16'};
 await serve(pool,async base=>{
  const endpoint=base+'/api/public/restaurants/test-cafe/orders';
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)};
  const first=await fetch(endpoint,options);
  assert.equal(first.status,201);
  assert.match((await first.json()).tracking_token,/^[a-f0-9]{48}$/);
  const second=await fetch(endpoint,options);
  assert.equal(second.status,409);
  const error=await second.json();
  assert.match(error.error,/already attempted/i);
 });
 assert.equal(pool.state.orders.length,1);
 assert.equal(pool.state.commits,1);
 assert.equal(pool.state.rollbacks,1);
});
test('voice web checkout rejects malformed idempotency keys before transaction',async()=>{
 const pool=fakePool();
 await serve(pool,async base=>{
  const response=await fetch(base+'/api/public/restaurants/test-cafe/orders',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({customer_name:'A',items:[{menu_item_id:5,quantity:1}],client_request_id:'bad'})
  });
  assert.equal(response.status,400);
 });
 assert.equal(pool.state.begun,0);
});
