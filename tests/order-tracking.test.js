import test from 'node:test';
import assert from 'node:assert/strict';
import {newTrackingToken,hashTrackingToken,getOrderTracking,STATUS_LABELS} from '../src/order-tracking.js';
import {readFileSync} from 'node:fs';

test('tracking tokens are random 48-hex strings and only hashes are compared',()=>{
 const a=newTrackingToken(),b=newTrackingToken();
 assert.match(a,/^[a-f0-9]{48}$/);
 assert.notEqual(a,b);
 assert.match(hashTrackingToken(a),/^[a-f0-9]{64}$/);
 assert.notEqual(hashTrackingToken(a),a);
});

function pool(order){
 const queries=[];
 return {queries,async execute(sql,args){
  queries.push({sql,args});
  if(sql.includes('FROM orders o JOIN order_tracking'))return [order&&args[1]===hashTrackingToken(order.token)?[order.row]:[]];
  if(sql.includes('FROM order_items'))return [[{name:'Zinger Burger',quantity:2}]];
  throw Error('unexpected '+sql);
 }};
}

test('valid token returns status without personal data',async()=>{
 const token=newTrackingToken();
 const p=pool({token,row:{id:7,status:'preparing',total_minor:'1180',created_at:'2026-11-14T10:00:00Z',restaurant_name:'Cheema Cafe',currency:'PKR',customer_name:'Ali'}});
 const result=await getOrderTracking(p,7,token);
 assert.equal(result.status,200);
 assert.equal(result.body.status_label,'Being prepared');
 assert.equal(result.body.total_minor,1180);
 assert.deepEqual(result.body.items,[{name:'Zinger Burger',quantity:2}]);
 assert.ok(!JSON.stringify(result.body).includes('Ali'));
 assert.deepEqual(p.queries[0].args,[7,hashTrackingToken(token)]);
});

test('wrong token, bad input and unknown orders are all the same 404 and never touch items',async()=>{
 const token=newTrackingToken();
 const p=pool({token,row:{id:7,status:'pending',total_minor:1,created_at:'x',restaurant_name:'R',currency:'USD'}});
 for(const [id,t] of [[7,newTrackingToken()],[8,'x'],[0,token],[7,undefined],[1.5,token],[7,token.toUpperCase()]]){
  const result=await getOrderTracking(p,id,t);
  assert.equal(result.status,404);
  assert.deepEqual(result.body,{error:'Order not found'});
 }
 assert.ok(!p.queries.some(q=>q.sql.includes('order_items')));
});

test('database failure returns 503',async()=>{
 const result=await getOrderTracking({async execute(){throw Error('down')}},7,newTrackingToken());
 assert.equal(result.status,503);
});

test('every order status has a customer label',()=>{
 for(const status of ['pending','accepted','preparing','ready','completed','cancelled'])assert.ok(STATUS_LABELS[status]);
});

test('tracking page uses the fragment, a header token and safe rendering',()=>{
 const js=readFileSync(new URL('../public/track.js',import.meta.url),'utf8');
 assert.match(js,/location\.hash/);
 assert.match(js,/X-Tracking-Token/);
 assert.ok(!js.includes('innerHTML'));
 assert.match(readFileSync(new URL('../src/checkout.js',import.meta.url),'utf8'),/x-tracking-token/);
 assert.match(readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8'),/CREATE TABLE IF NOT EXISTS order_tracking/);
});
