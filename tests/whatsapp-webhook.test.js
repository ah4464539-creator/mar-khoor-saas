import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {integrationRouter} from '../src/integrations.js';

test('WhatsApp webhook verification and signed event intake',async()=>{
 const prevToken=process.env.WHATSAPP_VERIFY_TOKEN,prevSecret=process.env.META_APP_SECRET;
 process.env.WHATSAPP_VERIFY_TOKEN='verify-test-token';process.env.META_APP_SECRET='test-meta-app-secret';
 const app=express();app.use('/integrations',integrationRouter());
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/integrations/webhooks/whatsapp';
 try{
  const verify=await fetch(url+'?hub.mode=subscribe&hub.verify_token=verify-test-token&hub.challenge=12345');
  assert.equal(verify.status,200);assert.equal(await verify.text(),'12345');
  assert.equal((await fetch(url+'?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345')).status,403);
  const body=JSON.stringify({object:'whatsapp_business_account',entry:[]});
  const post=signature=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-hub-signature-256':signature},body});
  assert.equal((await post('sha256='+'0'.repeat(64))).status,401);
  const signature='sha256='+crypto.createHmac('sha256','test-meta-app-secret').update(body).digest('hex');
  const accepted=await post(signature);assert.equal(accepted.status,202);
  assert.deepEqual(await accepted.json(),{received:true,processed:false});
 }finally{
  await new Promise(r=>server.close(r));
  if(prevToken===undefined)delete process.env.WHATSAPP_VERIFY_TOKEN;else process.env.WHATSAPP_VERIFY_TOKEN=prevToken;
  if(prevSecret===undefined)delete process.env.META_APP_SECRET;else process.env.META_APP_SECRET=prevSecret;
 }
});
