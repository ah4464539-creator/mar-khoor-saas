import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {operationsRouter} from '../src/operations.js';
import {authRouter,hashPassword} from '../src/auth.js';

test('restaurant analytics enforce membership and scope all queries',async()=>{
 const password='analytics-test-password',hash=await hashPassword(password),queries=[];
 const pool={
  async execute(sql,args){
   queries.push({sql,args});
   if(sql.includes('FROM users WHERE email=?'))return [[{id:3,email:'owner@example.com',password_hash:hash,platform_role:'user'}]];
   if(sql.includes('FROM restaurant_members'))return args[0]===9?[[{role:'admin'}]]:[[]];
   if(sql.includes('AS total_orders'))return [[{total_orders:2,pending_orders:1,completed_orders:1,completed_revenue_minor:1200}]];
   if(sql.includes('GROUP BY DATE(created_at)'))return [[{day:'2026-11-13',orders:2,completed_revenue_minor:1200}]];
   throw Error('Unexpected SQL: '+sql);
  }
 };
 const app=express();app.use(express.json());app.use('/auth',authRouter(pool));app.use('/api',operationsRouter(pool));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.com',password})});
  assert.equal(login.status,200);const {token}=await login.json();
  const headers={Authorization:'Bearer '+token};
  assert.equal((await fetch(base+'/api/restaurants/10/analytics',{headers})).status,403);
  const allowed=await fetch(base+'/api/restaurants/9/analytics',{headers});assert.equal(allowed.status,200);
  const data=await allowed.json();assert.equal(data.summary.completed_revenue_minor,1200);
  assert.deepEqual(queries.filter(q=>q.sql.includes('FROM orders')).map(q=>q.args),[[9],[9]]);
 }finally{await new Promise(r=>server.close(r))}
});
