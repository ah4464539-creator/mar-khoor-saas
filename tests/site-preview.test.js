import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { authRouter, hashPassword } from '../src/auth.js';
import { sitesRouter } from '../src/sites.js';

test('site preview is read-only, scoped to the authorized restaurant and never publishes',async()=>{
 const hash=await hashPassword('site-preview-test-password'),queries=[];
 const pool={
  async execute(sql,args=[]){
   queries.push({sql,args});
   if(sql.includes('FROM users WHERE email=?'))return [[{id:5,email:'owner@example.com',password_hash:hash,platform_role:'user'}]];
   if(sql.includes('FROM restaurant_members'))return Number(args[0])===9 ? [[{role:'admin'}]] : [[]];
   if(sql.includes('FROM restaurants WHERE id=?'))return [[{id:9,name:'Test Bistro',slug:'test-bistro',country_code:'PK',currency:'PKR',locale:'en'}]];
   if(sql.includes('FROM menu_items WHERE restaurant_id=?'))return [[{id:2,name:'Coffee',price_minor:35000,image_url:null,category:'Drinks',description:''}]];
   throw Error('Unexpected SQL: '+sql);
  },
 };
 const app=express();app.use(express.json());app.use('/auth',authRouter(pool));app.use(sitesRouter(pool));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try {
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.com',password:'site-preview-test-password'})});
  assert.equal(login.status,200);
  const {token}=await login.json();
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const payload={config:{template:'bistro',headline:'<script>alert(1)</script>',sections:['menu']}};
  assert.equal((await fetch(base+'/api/restaurants/10/site/preview',{method:'POST',headers,body:JSON.stringify(payload)})).status,403);
  assert.equal((await fetch(base+'/api/restaurants/9/site/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).status,401);
  assert.equal((await fetch(base+'/api/restaurants/9/site/preview',{method:'POST',headers,body:JSON.stringify({config:'invalid'})})).status,400);
  const preview=await fetch(base+'/api/restaurants/9/site/preview',{method:'POST',headers,body:JSON.stringify(payload)});
  assert.equal(preview.status,200);
  assert.match(preview.headers.get('cache-control'),/no-store/);
  assert.match(preview.headers.get('content-security-policy'),/default-src 'none'/);
  const html=await preview.text();
  assert.match(html,/<body class="site-template-bistro">/);
  assert.match(html,/Coffee/);
  assert.ok(!html.includes('<script'));
  assert.match(html,/&lt;script&gt;/);
  const templates=await fetch(base+'/api/restaurants/9/site/templates',{headers:{Authorization:'Bearer '+token}});
  assert.equal(templates.status,200);
  assert.deepEqual((await templates.json()).templates.map(x=>x.id),['classic','bistro','minimal','midnight']);
  assert.ok(queries.every(q=>!/INSERT|UPDATE|DELETE/i.test(q.sql)),'preview must never mutate database');
  assert.ok(queries.filter(q=>/FROM menu_items/.test(q.sql)).every(q=>Number(q.args[0])===9),'only current tenant menu can be read');
 } finally {await new Promise(resolve=>server.close(resolve))}
});
