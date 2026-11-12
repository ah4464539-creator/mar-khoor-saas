import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {apiRouter} from '../src/api.js';
import {authRouter,hashPassword} from '../src/auth.js';

test('only super admin can manage assistant mapping',async()=>{
 const password='strong-test-password';
 const hash=await hashPassword(password);
 const queries=[];
 const pool={
  async execute(sql,args){
   queries.push({sql,args});
   if(sql.includes('FROM users WHERE email='))return [[{id:3,email:'admin@example.com',password_hash:hash,platform_role:'user'}]];
   if(sql.includes('SELECT id FROM restaurants'))return [[{id:9}]];
   if(sql.includes('INSERT INTO voice_assistants'))return [{affectedRows:1}];
   return [[]];
  },
  async query(){return [[]]}
 };
 const app=express();app.use(express.json());app.use('/auth',authRouter(pool));app.use('/api',apiRouter(pool));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password})});
  assert.equal(login.status,200);
  const {token}=await login.json();
  const denied=await fetch(base+'/api/platform/voice-assistants/test-assistant',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({restaurant_id:9,active:true})});
  assert.equal(denied.status,403);
  assert.equal(queries.filter(q=>q.sql.includes('INSERT INTO voice_assistants')).length,0);
 }finally{await new Promise(r=>server.close(r))}
});
