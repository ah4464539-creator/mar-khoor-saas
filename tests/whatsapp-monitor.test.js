import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {apiRouter} from '../src/api.js';
import {authRouter,hashPassword} from '../src/auth.js';

test('WhatsApp monitoring is restricted to super admin and aggregates job health',async(t)=>{
 const previousOwner = process.env.SUPER_ADMIN_OWNER_EMAIL;
 process.env.SUPER_ADMIN_OWNER_EMAIL = 'owner@example.com';
 t.after(() => {
  if (previousOwner === undefined) delete process.env.SUPER_ADMIN_OWNER_EMAIL;
  else process.env.SUPER_ADMIN_OWNER_EMAIL = previousOwner;
 });
 const password='monitor-test-password',hash=await hashPassword(password);
 const pool={async execute(sql,args=[]){
  if(sql.includes('FROM users WHERE email=?'))return [[{id:5,email:'owner@example.com',password_hash:hash,platform_role:'super_admin'}]];
  if(sql.includes('FROM whatsapp_ai_jobs GROUP BY status'))return [[{status:'pending',count:3},{status:'failed',count:1}]];
  if(sql.includes("status='processing'"))return [[{count:2}]];
  if(sql.includes("status='pending'"))return [[{count:1}]];
  if(sql.includes('FROM whatsapp_outbound_messages'))return [[{status:'delivered',count:4}]];
  throw Error('Unexpected SQL: '+sql);
 }};
 const app=express();app.use(express.json());app.use('/auth',authRouter(pool));app.use('/api',apiRouter(pool));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(base+'/api/platform/whatsapp-ai/monitor')).status,401);
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.com',password})});
  assert.equal(login.status,200);
  const {token}=await login.json();
  const response=await fetch(base+'/api/platform/whatsapp-ai/monitor',{headers:{Authorization:'Bearer '+token}});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{jobs:[{status:'pending',count:3},{status:'failed',count:1}],stale_processing:2,delayed_pending:1,outbound_last_24h:[{status:'delivered',count:4}]});
 }finally{await new Promise(r=>server.close(r))}
});
