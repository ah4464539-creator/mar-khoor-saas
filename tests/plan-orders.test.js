import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanOrder,changeOrderStatus,loadCatalog,listPlanOrders} from '../src/plan-orders.js';

const CATALOG=JSON.stringify({services:{voice:4900,website:1900},numbers:{}});
function withCatalog(fn){return async()=>{const prev=process.env.PLAN_CATALOG_JSON;process.env.PLAN_CATALOG_JSON=CATALOG;try{await fn()}finally{if(prev===undefined)delete process.env.PLAN_CATALOG_JSON;else process.env.PLAN_CATALOG_JSON=prev}}}
function makePool({country='AE',routes=[],open=[],orderStatus='pending_payment',affected=1,failRoutes=false}={}){
 const calls=[];
 return {calls,
  async query(sql){calls.push({sql});if(sql.includes('number_routes')){if(failRoutes)throw Error('db');return [routes]}return [[]]},
  async execute(sql,args){calls.push({sql,args});
   if(sql.includes('FROM restaurants'))return [country?[{country_code:country}]:[]];
   if(sql.includes("FROM plan_orders WHERE restaurant_id=? AND status IN"))return [open];
   if(sql.startsWith('INSERT INTO plan_orders'))return [{insertId:77}];
   if(sql.startsWith('SELECT status FROM plan_orders'))return [orderStatus?[{status:orderStatus}]:[]];
   if(sql.startsWith('UPDATE plan_orders'))return [{affectedRows:affected}];
   return [[]];}};
}

test('createPlanOrder takes the country from the restaurant and snapshots a server-side quote',withCatalog(async()=>{
 const pool=makePool({routes:[{country_code:'AE',mode:'manual',monthly_minor:2500,setup_minor:500}]});
 const result=await createPlanOrder(pool,5,{features:['voice','website','voice'],numberMode:'new',country:'PK',monthly_minor:1});
 assert.equal(result.status,201);
 assert.equal(result.body.monthly_minor,4900+1900+2500);
 assert.equal(result.body.first_payment_minor,4900+1900+2500+500);
 const insert=pool.calls.find(c=>c.sql.startsWith('INSERT INTO plan_orders'));
 assert.deepEqual(insert.args.slice(0,4),[5,'AE','voice,website','new']);
 assert.equal(insert.args[5],9300);
}));

test('createPlanOrder drops numberMode=new when voice is not selected',withCatalog(async()=>{
 const pool=makePool();
 const result=await createPlanOrder(pool,5,{features:['website'],numberMode:'new'});
 assert.equal(result.status,201);
 assert.equal(pool.calls.find(c=>c.sql.startsWith('INSERT')).args[3],'existing');
}));

test('createPlanOrder refuses unavailable countries, unpriced services and duplicate open orders',withCatalog(async()=>{
 const unavailable=await createPlanOrder(makePool({country:'PK',routes:[{country_code:'PK',mode:'unavailable'}]}),5,{features:['voice'],numberMode:'new'});
 assert.equal(unavailable.status,409);
 const unpriced=await createPlanOrder(makePool(),5,{features:['whatsapp']});
 assert.equal(unpriced.status,409);
 const duplicate=await createPlanOrder(makePool({open:[{id:3}]}),5,{features:['website']});
 assert.deepEqual([duplicate.status,duplicate.body.order_id],[409,3]);
}));

test('createPlanOrder validates input and missing restaurants',withCatalog(async()=>{
 assert.equal((await createPlanOrder(makePool(),5,{features:'voice'})).status,400);
 assert.equal((await createPlanOrder(makePool(),5,{features:[1]})).status,400);
 assert.equal((await createPlanOrder(makePool(),5,{features:['bogus']})).status,400);
 assert.equal((await createPlanOrder(makePool({country:null}),5,{features:['website']})).status,404);
}));

test('createPlanOrder fails closed when routes cannot be read, but public quotes fall back',withCatalog(async()=>{
 assert.equal((await createPlanOrder(makePool({failRoutes:true}),5,{features:['website']})).status,503);
 const fallback=await loadCatalog(makePool({failRoutes:true}));
 assert.equal(fallback.services.website,1900);
}));

test('changeOrderStatus follows the allowed transitions and guards against races',async()=>{
 assert.equal((await changeOrderStatus(makePool(),1,'paid')).status,200);
 assert.equal((await changeOrderStatus(makePool(),1,'active')).status,409);
 assert.equal((await changeOrderStatus(makePool({orderStatus:'cancelled'}),1,'paid')).status,409);
 assert.equal((await changeOrderStatus(makePool({orderStatus:null}),1,'paid')).status,404);
 assert.equal((await changeOrderStatus(makePool({affected:0}),1,'paid')).status,409);
 assert.equal((await changeOrderStatus(makePool(),0,'paid')).status,400);
 assert.equal((await changeOrderStatus(makePool(),1,undefined)).status,400);
});

test('a restaurant can cancel only an unpaid order of its own',async()=>{
 const pool=makePool();
 assert.equal((await changeOrderStatus(pool,1,'cancelled',{restaurantId:5,onlyFrom:'pending_payment'})).status,200);
 assert.ok(pool.calls.some(c=>c.sql.includes('AND restaurant_id=?')&&c.args.includes(5)));
 assert.equal((await changeOrderStatus(makePool({orderStatus:'paid'}),1,'cancelled',{restaurantId:5,onlyFrom:'pending_payment'})).status,409);
});

test('listPlanOrders parses stored quotes and splits features',async()=>{
 const pool={async execute(){return [[{id:1,features:'voice,website',quote:'{"items":[]}'}]]},async query(){return [[{id:2,features:'website',quote:'not json'}]]}};
 assert.deepEqual((await listPlanOrders(pool,{restaurantId:1}))[0].features,['voice','website']);
 assert.deepEqual((await listPlanOrders(pool,{restaurantId:1}))[0].quote,{items:[]});
 assert.equal((await listPlanOrders(pool))[0].quote,null);
});
