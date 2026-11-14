import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRegistration,registerRestaurant,slugify,defaultCurrency} from '../src/registration-core.js';

const good={email:' Owner@Example.com ',password:'a-very-long-password',restaurant_name:"Cheema's Café",country:'ae'};
const fakeHash=async p=>'hashed:'+p.length;

function makePool({dupAt=null,failAt=null}={}){
 const log=[];
 const connection={
  async beginTransaction(){log.push('begin')},async commit(){log.push('commit')},async rollback(){log.push('rollback')},release(){log.push('release')},
  async execute(sql,args){
   const table=/INTO (\w+)/.exec(sql)[1];log.push({table,args});
   if(dupAt===table)throw Object.assign(Error('dup'),{code:'ER_DUP_ENTRY'});
   if(failAt===table)throw Error('boom');
   return [{insertId:table==='users'?11:22}];}};
 return {log,async getConnection(){return connection}};
}

test('slugify and default currencies',()=>{
 assert.equal(slugify("Cheema's Café"),'cheema-s-cafe');
 assert.equal(slugify('  ---  '),'');
 assert.equal(defaultCurrency('DE'),'EUR');assert.equal(defaultCurrency('AE'),'AED');assert.equal(defaultCurrency('ZZ'),'USD');
});

test('validateRegistration normalises a valid request',()=>{
 const {value}=validateRegistration(good);
 assert.deepEqual({email:value.email,slug:value.slug,country:value.country,currency:value.currency,locale:value.locale},
  {email:'owner@example.com',slug:'cheema-s-cafe',country:'AE',currency:'AED',locale:'en'});
});

test('validateRegistration rejects bad input',()=>{
 for(const patch of [{email:'nope'},{email:'a'.repeat(250)+'@x.io'},{password:'short'},{password:'x'.repeat(2000)},{restaurant_name:'  '},{restaurant_name:'x'.repeat(161)},
  {country:'UAE'},{country:undefined},{slug:'Bad Slug'},{slug:'a'},{slug:'admin'},{slug:'x--y'},{restaurant_name:'!!!'},{currency:'usd'}])
  assert.ok(validateRegistration({...good,...patch}).error,JSON.stringify(patch));
 for(const body of [null,[],'x',undefined])assert.ok(validateRegistration(body).error);
});

test('registerRestaurant creates user, restaurant and admin membership in one transaction',async()=>{
 const pool=makePool();
 const result=await registerRestaurant(pool,good,fakeHash);
 assert.deepEqual(result,{status:201,body:{restaurant_id:22,slug:'cheema-s-cafe',country:'AE',currency:'AED'}});
 assert.deepEqual(pool.log.filter(x=>typeof x==='string'),['begin','commit','release']);
 const member=pool.log.find(x=>x.table==='restaurant_members');
 assert.deepEqual(member.args,[22,11]);
 assert.equal(pool.log.find(x=>x.table==='users').args[1],'hashed:20');
});

test('registerRestaurant reports duplicate email and slug distinctly and rolls back',async()=>{
 const email=makePool({dupAt:'users'});
 assert.equal((await registerRestaurant(email,good,fakeHash)).status,409);
 assert.match((await registerRestaurant(makePool({dupAt:'users'}),good,fakeHash)).body.error,/email/);
 assert.ok(email.log.includes('rollback'));
 const slug=makePool({dupAt:'restaurants'});
 const result=await registerRestaurant(slug,good,fakeHash);
 assert.equal(result.status,409);assert.match(result.body.error,/web address/);
 assert.ok(slug.log.includes('rollback')&&!slug.log.includes('commit'));
});

test('registerRestaurant hides database failures and never inserts invalid requests',async()=>{
 const pool=makePool({failAt:'restaurant_members'});
 const result=await registerRestaurant(pool,good,fakeHash);
 assert.deepEqual(result,{status:503,body:{error:'Registration unavailable'}});
 assert.ok(pool.log.includes('rollback')&&pool.log.includes('release'));
 const untouched=makePool();
 assert.equal((await registerRestaurant(untouched,{...good,password:'short'},fakeHash)).status,400);
 assert.equal(untouched.log.length,0);
});
