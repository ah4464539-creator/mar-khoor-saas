import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {integrationRouter} from '../src/integrations.js';

test('Vapi webhook authenticates, stores lifecycle events and ignores the rest',async()=>{
 const previous=process.env.VAPI_WEBHOOK_SECRET;
 process.env.VAPI_WEBHOOK_SECRET='webhook-test-secret';
 const queries=[];
 const pool={async execute(sql,args){
  queries.push({sql,args});
  if(sql.includes('FROM voice_assistants'))return [[{restaurant_id:7}]];
  return [{affectedRows:1}];
 }};
 const app=express();app.use('/integrations',integrationRouter(pool));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/integrations/webhooks/vapi';
 const send=(headers,body)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const ended={message:{type:'end-of-call-report',endedReason:'hangup',call:{id:'call-9',assistantId:'asst-9'},artifact:{transcript:'hi'}}};
 try{
  assert.equal((await send({},ended)).status,401);
  assert.equal((await send({Authorization:'Bearer wrong'},ended)).status,401);
  assert.equal(queries.length,0);
  for(const headers of [{Authorization:'Bearer webhook-test-secret'},{'x-vapi-secret':'webhook-test-secret'},{'x-markhoor-webhook-secret':'webhook-test-secret'}]){
   const response=await send(headers,ended);
   assert.equal(response.status,202);
   assert.deepEqual(await response.json(),{received:true,processed:true});
  }
  const before=queries.length;
  const ignored=await send({Authorization:'Bearer webhook-test-secret'},{message:{type:'transcript',call:{id:'c',assistantId:'a'}}});
  assert.equal(ignored.status,202);
  assert.deepEqual(await ignored.json(),{received:true,processed:false});
  assert.equal(queries.length,before);
 }finally{
  await new Promise(r=>server.close(r));
  if(previous===undefined)delete process.env.VAPI_WEBHOOK_SECRET;else process.env.VAPI_WEBHOOK_SECRET=previous;
 }
});

test('Vapi webhook accepts a valid HMAC credential and rejects bad or stale ones',async()=>{
 const prev={s:process.env.VAPI_WEBHOOK_SECRET,h:process.env.VAPI_WEBHOOK_HMAC_SECRET};
 delete process.env.VAPI_WEBHOOK_SECRET;
 process.env.VAPI_WEBHOOK_HMAC_SECRET='hmac-test-secret';
 const pool={async execute(sql){return sql.includes('FROM voice_assistants')?[[{restaurant_id:7}]]:[{affectedRows:1}]}};
 const app=express();app.use('/integrations',integrationRouter(pool));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/integrations/webhooks/vapi';
 const body=JSON.stringify({message:{type:'status-update',status:'ringing',call:{id:'call-h',assistantId:'asst-h'}}});
 const send=(timestamp,signature)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-timestamp':timestamp,'x-signature':signature},body});
 const sign=timestamp=>crypto.createHmac('sha256','hmac-test-secret').update(timestamp+'.'+body).digest('hex');
 try{
  const now=String(Math.floor(Date.now()/1000));
  const good=await send(now,sign(now));
  assert.equal(good.status,202);
  assert.deepEqual(await good.json(),{received:true,processed:true});
  assert.equal((await send(now,'0'.repeat(64))).status,401);
  const old=String(Math.floor(Date.now()/1000)-3600);
  assert.equal((await send(old,sign(old))).status,401);
 }finally{
  await new Promise(r=>server.close(r));
  if(prev.s===undefined)delete process.env.VAPI_WEBHOOK_SECRET;else process.env.VAPI_WEBHOOK_SECRET=prev.s;
  if(prev.h===undefined)delete process.env.VAPI_WEBHOOK_HMAC_SECRET;else process.env.VAPI_WEBHOOK_HMAC_SECRET=prev.h;
 }
});
