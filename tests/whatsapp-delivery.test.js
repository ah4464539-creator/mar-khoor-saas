import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {integrationRouter} from '../src/integrations.js';

test('signed WhatsApp delivery statuses update known outbound records',async()=>{
 const old=process.env.META_APP_SECRET;process.env.META_APP_SECRET='status-test-secret';
 const updates=[];
 const pool={async execute(sql,args){if(sql.startsWith('UPDATE whatsapp_outbound_messages')){updates.push(args);return [{affectedRows:1}]};throw Error('Unexpected SQL')}};
 const app=express();app.use('/integrations',integrationRouter(pool));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/integrations/webhooks/whatsapp';
 const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'12345'},statuses:[{id:'wamid.outbound-1',status:'delivered'}]}}]}]});
 const signature='sha256='+crypto.createHmac('sha256',process.env.META_APP_SECRET).update(body).digest('hex');
 try{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-hub-signature-256':signature},body});
  assert.equal(response.status,202);
  assert.deepEqual(await response.json(),{received:true,processed:0,updated_statuses:1});
  assert.deepEqual(updates,[['delivered','wamid.outbound-1','12345']]);
 }finally{await new Promise(r=>server.close(r));if(old===undefined)delete process.env.META_APP_SECRET;else process.env.META_APP_SECRET=old}
});

test('recent delivery callback asks for a replay only while our send is in flight', async t => {
 const old = process.env.META_APP_SECRET;
 process.env.META_APP_SECRET = 'test-only-secret';
 let exists = false, sending = true;
 let status = 'accepted';
 const pool = { async execute(sql, args) {
  if (sql.startsWith('SELECT 1 FROM whatsapp_numbers')) return [exists ? [] : [{ found: 1 }]];
  if (sql.startsWith('SELECT 1 FROM whatsapp_ai_jobs')) return [sending ? [{ found: 1 }] : []];
  assert.ok(sql.startsWith('UPDATE whatsapp_outbound_messages'));
  if (!exists || status === args[0]) return [{ affectedRows: 0 }];
  status = args[0];
  return [{ affectedRows: 1 }];
 }};
 const app = express();
 app.use('/integrations', integrationRouter(pool));
 const server = app.listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 t.after(async () => {
  await new Promise(resolve => server.close(resolve));
  if (old === undefined) delete process.env.META_APP_SECRET;
  else process.env.META_APP_SECRET = old;
 });
 const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [null, { changes: [
  { field: 'messages', value: { metadata: { phone_number_id: '12345' },
   statuses: [{ id: 'wamid.outbound-early', status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)) }] } },
 ] }] });
 const signature = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(body).digest('hex');
 const post = () => fetch('http://127.0.0.1:' + server.address().port + '/integrations/webhooks/whatsapp', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature }, body,
 });
 assert.equal((await post()).status, 503, 'our AI send is still in flight');
 sending = false;
 assert.equal((await post()).status, 202, 'status for a message we did not send is acknowledged, no endless retries');
 exists = true;
 assert.equal((await post()).status, 202);
 assert.equal(status, 'delivered');
 assert.equal((await post()).status, 202);
});
