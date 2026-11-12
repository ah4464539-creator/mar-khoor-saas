import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {integrationRouter} from '../src/integrations.js';
test('Vapi stub rejects unauthenticated calls and does not process events',async()=>{
 const previous=process.env.VAPI_WEBHOOK_SECRET;
 process.env.VAPI_WEBHOOK_SECRET='local-test-secret';
 const app=express();app.use('/integrations',integrationRouter());
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/integrations/webhooks/vapi';
 try{
  const denied=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(denied.status,401);
  const allowed=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-markhoor-webhook-secret':'local-test-secret'},body:'{"event":"test"}'});
  assert.equal(allowed.status,202);
  assert.deepEqual(await allowed.json(),{received:true,processed:false});
 }finally{
  await new Promise(r=>server.close(r));
  if(previous===undefined)delete process.env.VAPI_WEBHOOK_SECRET;else process.env.VAPI_WEBHOOK_SECRET=previous;
 }
});
