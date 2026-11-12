import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {operationsRouter} from '../src/operations.js';
import {authRouter,hashPassword} from '../src/auth.js';

test('WhatsApp inbox requires restaurant admin membership and scopes messages',async()=>{
 const password='inbox-test-password',hash=await hashPassword(password),queries=[];
 const pool={async execute(sql,args){
  queries.push({sql,args});
  if(sql.includes('FROM users WHERE email=?'))return [[{id:3,email:'inbox@example.com',password_hash:hash,platform_role:'user'}]];
  if(sql.includes('FROM restaurant_members'))return args[0]===9?[[{role:'admin'}]]:[[]];
  if(sql.includes('FROM whatsapp_inbound_messages'))return [[{id:11,sender:'306900000000',text_body:'Hi',message_type:'text'}]];
  throw Error('Unexpected SQL: '+sql);
 }};
 const app=express();app.use(express.json());app.use('/auth',authRouter(pool));app.use('/api',operationsRouter(pool));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'inbox@example.com',password})});
  assert.equal(login.status,200);const {token}=await login.json(),headers={Authorization:'Bearer '+token};
  assert.equal((await fetch(base+'/api/restaurants/10/whatsapp/messages',{headers})).status,403);
  assert.equal((await fetch(base+'/api/restaurants/9/whatsapp/messages?before=bad',{headers})).status,400);
  const response=await fetch(base+'/api/restaurants/9/whatsapp/messages?before=12',{headers});
  assert.equal(response.status,200);assert.equal((await response.json()).messages[0].text_body,'Hi');
  assert.deepEqual(queries.filter(q=>q.sql.includes('FROM whatsapp_inbound_messages')).map(q=>q.args),[[9,12]]);
 }finally{await new Promise(r=>server.close(r))}
});
