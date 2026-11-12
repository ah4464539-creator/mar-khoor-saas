import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {operationsRouter} from '../src/operations.js';
import {authRouter,hashPassword} from '../src/auth.js';

test('WhatsApp replies reject other tenants and send only to eligible sender',async()=>{
 const oldToken=process.env.WHATSAPP_ACCESS_TOKEN,oldFetch=globalThis.fetch;
 process.env.WHATSAPP_ACCESS_TOKEN='test-token';
 const hash=await hashPassword('reply-test-password'),queries=[],outbound=[];
 const pool={async execute(sql,args){
  queries.push({sql,args});
  if(sql.includes('FROM users WHERE email=?'))return [[{id:3,email:'owner@example.com',password_hash:hash,platform_role:'user'}]];
  if(sql.includes('FROM restaurant_members'))return args[0]===9?[[{role:'admin'}]]:[[]];
  if(sql.includes('FROM whatsapp_inbound_messages'))return args[1]===9&&args[0]==='wamid.test'?[[{phone_number_id:'12345',sender:'306900000000'}]]:[[]];
  throw Error('Unexpected SQL: '+sql);
 }};
 const app=express();app.use(express.json());app.use('/auth',authRouter(pool));app.use('/api',operationsRouter(pool));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const login=await oldFetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.com',password:'reply-test-password'})});
  const {token}=await login.json();assert.equal(login.status,200);
  globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://graph.facebook.com/')){outbound.push({url,options});return {ok:true,json:async()=>({messages:[{id:'wamid.outbound'}]})}}return oldFetch(url,options)};
  const send=(restaurantId,messageId)=>oldFetch(base+'/api/restaurants/'+restaurantId+'/whatsapp/replies',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({message_id:messageId,text:'Hello!'})});
  assert.equal((await send(10,'wamid.test')).status,403);
  assert.equal((await send(9,'wamid.other')).status,409);
  const accepted=await send(9,'wamid.test');assert.equal(accepted.status,200);
  assert.equal((await accepted.json()).message_id,'wamid.outbound');
  assert.equal(outbound.length,1);
  assert.equal(outbound[0].url,'https://graph.facebook.com/v23.0/12345/messages');
  assert.equal(JSON.parse(outbound[0].options.body).to,'306900000000');
  assert.deepEqual(queries.filter(q=>q.sql.includes('FROM whatsapp_inbound_messages')).map(q=>q.args),[['wamid.other',9],['wamid.test',9]]);
 }finally{
  globalThis.fetch=oldFetch;await new Promise(r=>server.close(r));
  if(oldToken===undefined)delete process.env.WHATSAPP_ACCESS_TOKEN;else process.env.WHATSAPP_ACCESS_TOKEN=oldToken;
 }
});
