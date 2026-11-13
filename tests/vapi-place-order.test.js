import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {vapiToolAdapterRouter} from '../src/vapi-adapter.js';

test('Vapi place_order writes once and retries return same order',async()=>{
 const old=process.env.VAPI_TOOL_SECRET;process.env.VAPI_TOOL_SECRET='adapter-order-secret';
 let claimed=false,orderId=null,commits=0;
 const connection={
  async beginTransaction(){},async rollback(){},async commit(){commits++},release(){},
  async execute(sql,args){
   if(sql.includes('FROM voice_assistants'))return [[{restaurant_id:12}]];
   if(sql.startsWith('INSERT INTO voice_order_requests')){if(claimed)return [{affectedRows:2}];claimed=true;return [{affectedRows:1}]}
   if(sql.startsWith('SELECT order_id FROM voice_order_requests'))return [[{order_id:orderId}]];
   if(sql.startsWith('INSERT INTO orders'))return [{insertId:88}];
   if(sql.startsWith('INSERT INTO order_items'))return [{affectedRows:1}];
   if(sql.startsWith('UPDATE voice_order_requests')){orderId=args[0];return [{affectedRows:1}]}
   throw Error('Unexpected SQL: '+sql);
  },
  async query(sql){if(sql.includes('FROM menu_items'))return [[{id:5,name:'Meal',price_minor:500}]];throw Error('Unexpected query')}
 };
 const app=express();app.use('/integrations/vapi',vapiToolAdapterRouter({getConnection:async()=>connection}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/integrations/vapi/tools';
 const payload={message:{assistant:{id:'assistant-1'},call:{id:'call-88'},toolCallList:[{id:'tool-1',function:{name:'place_order',arguments:{customer_name:'Customer',confirmed:true,items:[{menu_item_id:5,quantity:2}]}}}]}};
 const send=()=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-markhoor-tool-secret':'adapter-order-secret'},body:JSON.stringify(payload)});
 try{
  const first=await send();assert.equal(first.status,200);assert.deepEqual(JSON.parse((await first.json()).results[0].result),{order_id:88,status:'pending',total_minor:1000});
  const second=await send();assert.equal(second.status,200);assert.deepEqual(JSON.parse((await second.json()).results[0].result),{order_id:88,status:'already_received'});
  assert.equal(commits,1);
  payload.message.toolCallList[0].function.arguments.confirmed=false;
  const rejected=await send();assert.equal(rejected.status,200);
  assert.equal((await rejected.json()).results[0].error,'Invalid confirmed order');
  assert.equal(commits,1);
  payload.message.toolCallList[0].function.arguments={customer_name:'Customer',confirmed:true,items:[{menu_item_id:5,quantity:2}],restaurant_id:999,call_id:'forged-call'};
  const replay=await send();assert.equal(replay.status,200);
  assert.equal(JSON.parse((await replay.json()).results[0].result).status,'already_received');
  assert.equal(commits,1);
 }finally{await new Promise(r=>server.close(r));if(old===undefined)delete process.env.VAPI_TOOL_SECRET;else process.env.VAPI_TOOL_SECRET=old}
});
