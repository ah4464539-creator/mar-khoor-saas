import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemorySessionStore,createDbSessionStore,hashToken} from '../src/sessions.js';

test('hashToken is a stable sha256 hex digest',()=>{
 assert.match(hashToken('abc'),/^[a-f0-9]{64}$/);
 assert.equal(hashToken('abc'),hashToken('abc'));
 assert.notEqual(hashToken('abc'),hashToken('abd'));
});

test('memory store creates, reads, expires and deletes sessions',async()=>{
 const store=createMemorySessionStore();
 await store.create('h1',{id:1,email:'a@b.c',platformRole:'user'},60);
 assert.deepEqual(await store.get('h1'),{id:1,email:'a@b.c',platformRole:'user'});
 assert.equal(await store.get('missing'),null);
 await store.create('h2',{id:2,email:'x@y.z',platformRole:'user'},-1);
 assert.equal(await store.get('h2'),null);
 await store.delete('h1');
 assert.equal(await store.get('h1'),null);
});

test('database store keeps only the token hash and reads role from users',async()=>{
 const queries=[];
 const pool={async execute(sql,args){
  queries.push({sql,args});
  if(sql.startsWith('SELECT'))return [[{id:5,email:'o@x.y',platformRole:'super_admin'}]];
  return [{affectedRows:1}];
 }};
 const store=createDbSessionStore(pool);
 await store.create('hash-1',{id:5,email:'o@x.y',platformRole:'super_admin'},86400);
 assert.match(queries[0].sql,/INSERT INTO sessions/);
 assert.deepEqual(queries[0].args,['hash-1',5,86400]);
 assert.ok(!JSON.stringify(queries).includes('o@x.y'));
 assert.deepEqual(await store.get('hash-1'),{id:5,email:'o@x.y',platformRole:'super_admin'});
 const read=queries.find(q=>q.sql.startsWith('SELECT'));
 assert.match(read.sql,/expires_at > NOW\(\)/);
 assert.match(read.sql,/JOIN users/);
 await store.delete('hash-1');
 assert.match(queries.at(-1).sql,/DELETE FROM sessions WHERE token_hash/);
});

test('database store returns null for unknown or expired sessions and survives cleanup failure',async()=>{
 const empty=createDbSessionStore({async execute(sql){return sql.startsWith('SELECT')?[[]]:[{}]}});
 assert.equal(await empty.get('nope'),null);
 let calls=0;
 const flaky=createDbSessionStore({async execute(sql){calls++;if(sql.startsWith('DELETE FROM sessions WHERE expires_at'))throw Error('cleanup failed');return [{}]}});
 await flaky.create('h',{id:1},60);
 assert.equal(calls,2);
});

test('restaurant sessions slide forward while used; super admin sessions do not',async()=>{
 const {requireAuth,useSessionStore,SESSION_SECONDS}=await import('../src/auth.js');
 assert.equal(SESSION_SECONDS,90*86400);
 const touched=[];
 const sessions={u:{id:1,email:'owner@cafe.pk',platformRole:'user'},s:{id:2,email:'boss@x.y',platformRole:'super_admin'}};
 useSessionStore({async get(hash){return hash===hashToken('a'.repeat(64))?sessions.u:hash===hashToken('b'.repeat(64))?sessions.s:null},async touch(hash,ttl,min){touched.push({hash,ttl,min})}});
 const run=token=>new Promise(resolve=>{const req={get:()=> 'Bearer '+token};const res={status(){return this},json(body){resolve(body)}};requireAuth(req,res,()=>resolve('next'))});
 assert.equal(await run('a'.repeat(64)),'next');
 assert.equal(touched.length,1);
 assert.equal(touched[0].ttl,90*86400);
 assert.ok(touched[0].min<touched[0].ttl);
 await run('b'.repeat(64));
 assert.equal(touched.length,1,'super admin session is not extended');
 useSessionStore(createMemorySessionStore());
});

test('memory and database stores extend only sessions that are close to expiring',async()=>{
 const memory=createMemorySessionStore();
 await memory.create('h',{id:1,email:'a@b.c',platformRole:'user'},10);
 await memory.touch('h',1000,100);
 assert.ok(await memory.get('h'));
 const queries=[];
 const db=createDbSessionStore({async execute(sql,args){queries.push({sql,args});return [{}]}});
 await db.touch('hash',7776000,7689600);
 assert.match(queries[0].sql,/UPDATE sessions SET expires_at=DATE_ADD\(NOW\(\), INTERVAL \? SECOND\) WHERE token_hash=\? AND expires_at < DATE_ADD/);
 assert.deepEqual(queries[0].args,[7776000,'hash',7689600]);
});
