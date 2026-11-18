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
function fakePool({available=true,restaurant=true,fulfillmentError=null}={}){
 const state={begun:0,commits:0,rollbacks:0,orders:[],lines:[],fulfillment:[],released:0,requestIds:new Set()};
 const connection={
  async beginTransaction(){state.begun++},
  async commit(){state.commits++},
  async rollback(){state.rollbacks++},
  release(){state.released++},
  async execute(sql,args){
   if(sql.startsWith('SELECT id FROM restaurants'))return [restaurant?[{id:9}]:[]];
   if(sql.startsWith('INSERT INTO order_fulfillment')){if(fulfillmentError)throw fulfillmentError;state.fulfillment.push(args);return [{affectedRows:1}]}
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

const post=(base,body,slug='test-cafe')=>fetch(base+'/api/public/restaurants/'+slug+'/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const cod={customer_name:'Ali',items:[{menu_item_id:5,quantity:2}],customer_phone:'03001234567',order_type:'delivery',delivery_address:'House 5, Street 2, Lahore',delivery_instructions:'Gate 2',payment_method:'cod'};

test('COD delivery order stores fulfilment as unpaid in the same transaction',async()=>{
 const pool=fakePool();
 await serve(pool,async base=>{
  const response=await post(base,cod);
  assert.equal(response.status,201);
  const body=await response.json();
  assert.equal(body.payment_method,'cod');assert.equal(body.payment_status,'unpaid');assert.equal(body.order_type,'delivery');
  assert.equal(body.total_minor,2598);
 });
 assert.deepEqual(pool.state.fulfillment[0],[77,9,'delivery','03001234567','House 5, Street 2, Lahore','Gate 2','cod','unpaid']);
 assert.equal(pool.state.commits,1);
});

test('cash pickup order stores no address and is unpaid',async()=>{
 const pool=fakePool();
 await serve(pool,async base=>{
  const response=await post(base,{customer_name:'Sara',items:[{menu_item_id:5,quantity:1}],customer_phone:'+923001234567',order_type:'pickup',payment_method:'cash_pickup',delivery_address:'x'});
  assert.equal(response.status,201);
  assert.equal((await response.json()).payment_method,'cash_pickup');
 });
 assert.deepEqual(pool.state.fulfillment[0],[77,9,'pickup','+923001234567',null,null,'cash_pickup','unpaid']);
});

test('legacy website checkout response and storage are unchanged',async()=>{
 const pool=fakePool();
 await serve(pool,async base=>{
  const body=await (await post(base,{customer_name:'A',items:[{menu_item_id:5,quantity:1}]})).json();
  assert.equal(body.payment_status,undefined);
 });
 assert.equal(pool.state.fulfillment.length,0);
});

test('missing phone, invalid phone, missing address and Stripe are rejected before any transaction',async()=>{
 const pool=fakePool();
 await serve(pool,async base=>{
  for(const body of [{...cod,customer_phone:undefined,order_type:'delivery'},{...cod,customer_phone:'12ab'},{...cod,delivery_address:''},{...cod,payment_method:'stripe'}]){
   const response=await post(base,body);
   assert.equal(response.status,400);
  }
 });
 assert.equal(pool.state.begun,0);assert.equal(pool.state.orders.length,0);
});

test('client-side modified prices are ignored; totals come from the database menu',async()=>{
 const pool=fakePool();
 await serve(pool,async base=>{
  const body=await (await post(base,{...cod,items:[{menu_item_id:5,quantity:2,unit_price_minor:1}],total_minor:2})).json();
  assert.equal(body.total_minor,2598);
 });
 assert.deepEqual(pool.state.lines[0],[77,5,'Pizza',2,1299]);
});

test('unknown restaurant returns 404 and invalid menu item returns 409 with no order',async()=>{
 for(const [options,status] of [[{restaurant:false},404],[{available:false},409]]){
  const pool=fakePool(options);
  await serve(pool,async base=>assert.equal((await post(base,cod)).status,status));
  assert.equal(pool.state.orders.length,0);assert.equal(pool.state.commits,0);
 }
});

test('if the fulfilment table is missing the whole order rolls back',async()=>{
 const pool=fakePool({fulfillmentError:Object.assign(new Error('no table'),{code:'ER_NO_SUCH_TABLE'})});
 await serve(pool,async base=>assert.equal((await post(base,cod)).status,503));
 assert.equal(pool.state.commits,0);assert.equal(pool.state.rollbacks,1);
});

test('duplicate COD submission with the same request ID creates only one order',async()=>{
 const pool=fakePool();
 const id='123e4567-e89b-42d3-a456-426614174000';
 await serve(pool,async base=>{
  assert.equal((await post(base,{...cod,client_request_id:id})).status,201);
  assert.equal((await post(base,{...cod,client_request_id:id})).status,409);
 });
 assert.equal(pool.state.commits,1);
});
