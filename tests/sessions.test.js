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
