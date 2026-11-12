import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {vapiToolAdapterRouter} from '../src/vapi-adapter.js';

test('Vapi tool adapter rejects unauthorized calls and returns mapped menu',async()=>{
 const old=process.env.VAPI_TOOL_SECRET;
 process.env.VAPI_TOOL_SECRET='adapter-test-secret';
 const queries=[];
 const pool={async execute(sql,args){
  queries.push({sql,args});
  if(sql.includes('FROM voice_assistants'))return [[{id:17,name:'Test Cafe',currency:'PKR',locale:'ur'}]];
  if(sql.includes('FROM menu_items'))return [[{id:4,name:'Tea',description:'',price_minor:250}]];
  throw Error('Unexpected SQL');
 }};
 const app=express();app.use('/integrations/vapi',vapiToolAdapterRouter(pool));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/integrations/vapi/tools';
 const payload={message:{assistant:{id:'assistant-123'},toolCallList:[{id:'tool-1',function:{name:'get_menu',arguments:{}}}]}};
 const send=headers=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});
 try{
  assert.equal((await send({})).status,401);
  const response=await send({'x-markhoor-tool-secret':'adapter-test-secret'});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.results[0].toolCallId,'tool-1');
  assert.equal(result.results[0].result.items[0].price_minor,250);
  assert.deepEqual(queries[0].args,['assistant-123']);
  assert.deepEqual(queries[1].args,[17]);
 }finally{
  await new Promise(r=>server.close(r));
  if(old===undefined)delete process.env.VAPI_TOOL_SECRET;else process.env.VAPI_TOOL_SECRET=old;
 }
});
