import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {voiceToolsRouter} from '../src/voice-tools.js';

test('voice menu requires secret and uses server-side assistant mapping',async()=>{
 const prior=process.env.VAPI_TOOL_SECRET;process.env.VAPI_TOOL_SECRET='test-tool-secret';
 const queries=[];
 const pool={execute:async(sql,args)=>{
  queries.push({sql,args});
  if(sql.includes('FROM voice_assistants'))return [[{id:7,name:'Cafe',currency:'PKR',locale:'ur'}]];
  if(sql.includes('FROM menu_items'))return [[{id:4,name:'Tea',description:'',price_minor:200}]];
  throw Error('Unexpected query');
 }};
 const app=express();app.use('/voice-tools',voiceToolsRouter(pool));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/voice-tools/assistants/assistant-123/menu';
 try{
  assert.equal((await fetch(url)).status,401);
  const response=await fetch(url,{headers:{'x-markhoor-tool-secret':'test-tool-secret'}});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.restaurant.name,'Cafe');assert.equal(data.items[0].price_minor,200);
  assert.deepEqual(queries[0].args,['assistant-123']);
  assert.deepEqual(queries[1].args,[7]);
 }finally{
  await new Promise(r=>server.close(r));
  if(prior===undefined)delete process.env.VAPI_TOOL_SECRET;else process.env.VAPI_TOOL_SECRET=prior;
 }
});
