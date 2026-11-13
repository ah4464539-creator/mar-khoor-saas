import test from 'node:test';
import assert from 'node:assert/strict';
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
