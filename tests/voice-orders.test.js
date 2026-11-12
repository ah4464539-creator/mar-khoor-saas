import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {voiceToolsRouter} from '../src/voice-tools.js';

test('confirmed voice order is saved once and duplicate call returns same order',async()=>{
 const old=process.env.VAPI_TOOL_SECRET;process.env.VAPI_TOOL_SECRET='voice-test-secret';
 let claimed=false,orderId=null,commits=0;
 const conn={
  async beginTransaction(){},async commit(){commits++},async rollback(){},release(){},
  async execute(sql,args){
   if(sql.includes('FROM voice_assistants'))return [[{restaurant_id:11}]];
   if(sql.startsWith('INSERT INTO voice_order_requests')){if(claimed)return [{affectedRows:2}];claimed=true;return [{affectedRows:1}]}
   if(sql.startsWith('SELECT order_id FROM voice_order_requests'))return [[{order_id:orderId}]];
   if(sql.startsWith('INSERT INTO orders'))return [{insertId:55}];
   if(sql.startsWith('INSERT INTO order_items'))return [{insertId:70}];
   if(sql.startsWith('UPDATE voice_order_requests')){orderId=args[0];return [{affectedRows:1}]}
   throw Error('Unexpected SQL: '+sql);
  },
  async query(sql){if(sql.includes('FROM menu_items'))return [[{id:3,name:'Tea',price_minor:250}]];throw Error('Unexpected query')}
 };
 const app=express();app.use(express.json());app.use('/voice-tools',voiceToolsRouter({getConnection:async()=>conn}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/voice-tools/assistants/assistant-1/orders';
 const send=(confirmed=true)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-markhoor-tool-secret':'voice-test-secret'},body:JSON.stringify({call_id:'call-123',customer_name:'Customer',confirmed,items:[{menu_item_id:3,quantity:2}]})});
 try{
  const invalid=await send(false);assert.equal(invalid.status,400);
  const first=await send();assert.equal(first.status,201);assert.deepEqual(await first.json(),{order_id:55,status:'pending',total_minor:500});
  const duplicate=await send();assert.equal(duplicate.status,200);assert.deepEqual(await duplicate.json(),{order_id:55,status:'already_received'});
  assert.equal(commits,1);
 }finally{await new Promise(r=>server.close(r));if(old===undefined)delete process.env.VAPI_TOOL_SECRET;else process.env.VAPI_TOOL_SECRET=old}
});
