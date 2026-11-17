import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {operationsRouter} from '../src/operations.js';
import {authRouter,hashPassword} from '../src/auth.js';

async function serve(pool,run) {
 const app=express();app.use(express.json());
 app.use('/auth',authRouter(pool));app.use('/api',operationsRouter(pool));
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 try {await run('http://127.0.0.1:'+server.address().port);}
 finally {await new Promise(resolve=>server.close(resolve));}
}
test('only the restaurant admin can set/clear ETA and estimated minutes are never inferred',async()=>{
 const password='eta-test-only-pass';
 const hash=await hashPassword(password);
 const writes=[];
 const pool={async execute(sql,args){
  if(sql.includes('FROM users WHERE email=?'))return [[{
   id:8,email:'owner@example.com',password_hash:hash,platform_role:'user'
  }]];
  if(sql.includes('FROM restaurant_members'))return [args[0]===11? [{role:'admin'}]:[]];
  if(sql.startsWith('UPDATE orders SET estimated_ready_epoch=')){
   writes.push({sql,args});
   return [{affectedRows:args[2]===21&&args[3]===11?1:0}];
  }
  throw Error('Unexpected SQL: '+sql);
 }};
 await serve(pool,async base=>{
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({email:'owner@example.com',password})});
  assert.equal(login.status,200);
  const {token}=await login.json();
  const patch=(restaurantId,minutes,orderId=21)=>fetch(base+'/api/restaurants/'+restaurantId+
    '/orders/'+orderId+'/estimate',{method:'PATCH',headers:{
      Authorization:'Bearer '+token,'Content-Type':'application/json'
    },body:JSON.stringify({minutes})});
  assert.equal((await patch(12,15)).status,403);
  assert.equal((await patch(11,0)).status,400);
  assert.equal((await patch(11,241)).status,400);
  assert.equal((await patch(11,'20')).status,400);
  const set=await patch(11,25);
  assert.equal(set.status,200);
  const payload=await set.json();
  assert.equal(payload.updated,true);
  assert.ok(payload.estimated_ready_epoch>Math.floor(Date.now()/1000));
  const clear=await patch(11,null);
  assert.equal(clear.status,200);
  assert.equal((await clear.json()).estimated_ready_epoch,null);
  assert.equal((await patch(11,15,99)).status,409);
 });
 assert.deepEqual(writes.map(x=>x.args),[[25,25,21,11],[null,null,21,11],[15,15,99,11]]);
 assert.ok(writes.every(x=>x.sql.includes("status IN ('pending','accepted','preparing')")));
});
