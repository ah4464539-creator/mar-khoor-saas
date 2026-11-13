import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {vapiToolAdapterRouter} from '../src/vapi-adapter.js';

test('only authenticated inbound calls on the mapped restaurant line get a transfer destination', async t => {
 const originalSecret=process.env.VAPI_TOOL_SECRET;
 process.env.VAPI_TOOL_SECRET='test-transfer-secret';
 let lookups=0;
 const pool={async execute(sql,params){
  lookups++;
  assert.match(sql,/assistant\.active=1/);
  assert.match(sql,/line\.phone=route\.ai_phone/);
  assert.match(sql,/NOT EXISTS/);
  return [params.join(':')==='assistant-a:line-a'?[{staff_phone:'+302101234567'}]:[]];
 }};
 const app=express();
 app.use(vapiToolAdapterRouter(pool));
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  if(originalSecret===undefined)delete process.env.VAPI_TOOL_SECRET;
  else process.env.VAPI_TOOL_SECRET=originalSecret;
 });
 const call={type:'inboundPhoneCall',assistantId:'assistant-a',phoneNumberId:'line-a'};
 const send=(overrides={},secret='test-transfer-secret')=>fetch('http://127.0.0.1:'+server.address().port+'/transfer',{
  method:'POST',
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},
  body:JSON.stringify({message:{type:'transfer-destination-request',call:{...call,...overrides},destination:{number:'+12025550123'}}})
 });
 assert.equal((await send({},'invalid')).status,401);
 assert.equal((await send({type:'webCall'})).status,400);
 assert.equal(lookups,0);
 assert.deepEqual(await (await send()).json(),{destination:{type:'number',number:'+302101234567'}});
 assert.match((await (await send({phoneNumberId:'line-b'})).json()).error,/unavailable/);
});
