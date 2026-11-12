import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {authRouter,hashPassword} from '../src/auth.js';
import {operationsRouter} from '../src/operations.js';

async function withServer(app,fn){
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 try{return await fn('http://127.0.0.1:'+server.address().port)}
 finally{await new Promise(resolve=>server.close(resolve))}
}
test('login rejects invalid credentials and protects restaurant APIs',async()=>{
 const app=express();app.use(express.json());
 const pool={execute:async()=>[[]]};
 app.use('/auth',authRouter(pool));app.use('/api',operationsRouter(pool));
 await withServer(app,async base=>{
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'nobody@example.com',password:'wrong'})});
  assert.equal(login.status,401);
  const protectedResponse=await fetch(base+'/api/restaurants/1/menu');
  assert.equal(protectedResponse.status,401);
 });
});
test('valid login issues token and restaurant isolation denies unassigned tenant',async()=>{
 const password='very-long-password';
 const hash=await hashPassword(password);
 const pool={execute:async(sql)=>{
  if(sql.includes('FROM users'))return [[{id:42,email:'staff@example.com',password_hash:hash,platform_role:'user'}]];
  if(sql.includes('FROM restaurant_members'))return [[]];
  return [[]];
 }};
 const app=express();app.use(express.json());app.use('/auth',authRouter(pool));app.use('/api',operationsRouter(pool));
 await withServer(app,async base=>{
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'staff@example.com',password})});
  assert.equal(login.status,200);
  const {token}=await login.json();assert.match(token,/^[a-f0-9]{64}$/);
  const denied=await fetch(base+'/api/restaurants/999/menu',{headers:{Authorization:'Bearer '+token}});
  assert.equal(denied.status,403);
  const logout=await fetch(base+'/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token}});
  assert.equal(logout.status,200);
  const after=await fetch(base+'/api/restaurants/999/menu',{headers:{Authorization:'Bearer '+token}});
  assert.equal(after.status,401);
 });
});
