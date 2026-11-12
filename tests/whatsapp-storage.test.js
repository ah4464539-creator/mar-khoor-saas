import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {integrationRouter} from '../src/integrations.js';

test('signed WhatsApp text is tenant-routed and replay safe',async()=>{
 const old=process.env.META_APP_SECRET;process.env.META_APP_SECRET='whatsapp-storage-test';
 const inserted=new Set(),queries=[];
 const pool={async execute(sql,args){
  queries.push({sql,args});
  if(sql.includes('FROM whatsapp_numbers'))return args[0]==='12345'?[[{restaurant_id:7}]]:[[]];
  if(sql.startsWith('INSERT INTO whatsapp_ai_jobs'))return [{affectedRows:0}];
  if(sql.startsWith('INSERT IGNORE')){const id=args[0];if(inserted.has(id))return [{affectedRows:0}];inserted.add(id);return [{affectedRows:1}]}
  throw Error('Unexpected SQL');
 }};
 const app=express();app.use('/integrations',integrationRouter(pool));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/integrations/webhooks/whatsapp';
 const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'12345'},messages:[{id:'wamid.test-1',from:'306900000000',type:'text',text:{body:'Hello'}}]}}]}]});
 const signature='sha256='+crypto.createHmac('sha256',process.env.META_APP_SECRET).update(body).digest('hex');
 const send=()=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-hub-signature-256':signature},body});
 try{
  const first=await send();assert.equal(first.status,202);assert.equal((await first.json()).processed,1);
  const second=await send();assert.equal(second.status,202);assert.equal((await second.json()).processed,0);
  assert.deepEqual(queries.filter(q=>q.sql.startsWith('INSERT IGNORE')).map(q=>q.args),[
   ['wamid.test-1',7,'12345','306900000000','text','Hello'],
   ['wamid.test-1',7,'12345','306900000000','text','Hello']
  ]);
 }finally{await new Promise(r=>server.close(r));if(old===undefined)delete process.env.META_APP_SECRET;else process.env.META_APP_SECRET=old}
});
