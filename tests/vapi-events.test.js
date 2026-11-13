import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVapiEvent,processVapiEvent} from '../src/vapi-events.js';

const call={id:'call-1',assistantId:'asst-1'};

test('parseVapiEvent accepts status updates and end-of-call reports',()=>{
 assert.deepEqual(parseVapiEvent({message:{type:'status-update',status:'in-progress',call}}),
  {kind:'status-update',assistantId:'asst-1',callId:'call-1',status:'in-progress'});
 const report=parseVapiEvent({message:{type:'end-of-call-report',endedReason:'hangup',call,artifact:{transcript:'AI: hi'}}});
 assert.equal(report.kind,'end-of-call-report');
 assert.equal(report.status,'ended');
 assert.equal(report.endedReason,'hangup');
 assert.equal(report.transcript,'AI: hi');
});

test('parseVapiEvent ignores unsupported or malformed events',()=>{
 for(const payload of [null,{},{event:'test'},{message:[]},
  {message:{type:'transcript',call}},
  {message:{type:'status-update',status:'bogus',call}},
  {message:{type:'status-update',status:'ended',call:{id:'bad id!',assistantId:'asst-1'}}},
  {message:{type:'status-update',status:'ended',call:{id:'call-1'}}},
  {message:{type:'status-update',status:'ended',call:{id:'call-1',assistantId:'x'.repeat(200)}}}])
  assert.equal(parseVapiEvent(payload).kind,'ignored');
});

test('parseVapiEvent caps transcript and reason sizes',()=>{
 const report=parseVapiEvent({message:{type:'end-of-call-report',endedReason:'r'.repeat(500),call,artifact:{transcript:'t'.repeat(200000)}}});
 assert.equal(report.endedReason.length,128);
 assert.equal(report.transcript.length,100000);
});

function mockPool(mapped){
 const queries=[];
 return {queries,async execute(sql,args){
  queries.push({sql,args});
  if(sql.includes('FROM voice_assistants'))return [mapped?[{restaurant_id:42}]:[]];
  return [{affectedRows:1}];
 }};
}

test('processVapiEvent resolves the restaurant from the assistant mapping, not the payload',async()=>{
 const pool=mockPool(true);
 const result=await processVapiEvent(pool,{message:{type:'status-update',status:'ringing',restaurant_id:999,call:{...call,restaurant_id:999}}});
 assert.deepEqual(result,{processed:true});
 assert.deepEqual(pool.queries[0].args,['asst-1']);
 assert.match(pool.queries[1].sql,/INSERT INTO voice_calls/);
 assert.deepEqual(pool.queries[1].args,['asst-1','call-1',42,'ringing','ringing']);
 assert.ok(!pool.queries.some(q=>q.args.includes(999)));
});

test('processVapiEvent never moves an ended call back to an earlier status',async()=>{
 const pool=mockPool(true);
 await processVapiEvent(pool,{message:{type:'status-update',status:'in-progress',call}});
 assert.match(pool.queries[1].sql,/status=IF\(status='ended',status,VALUES\(status\)\)/);
});

test('processVapiEvent stores end-of-call data against the mapped restaurant',async()=>{
 const pool=mockPool(true);
 const result=await processVapiEvent(pool,{message:{type:'end-of-call-report',endedReason:'hangup',call,artifact:{transcript:'hello'}}});
 assert.deepEqual(result,{processed:true});
 assert.deepEqual(pool.queries[1].args,['asst-1','call-1',42,'hangup','hello']);
});

test('processVapiEvent ignores unmapped assistants without writing',async()=>{
 const pool=mockPool(false);
 const result=await processVapiEvent(pool,{message:{type:'status-update',status:'ended',call}});
 assert.deepEqual(result,{processed:false,reason:'assistant_not_mapped'});
 assert.equal(pool.queries.length,1);
});
