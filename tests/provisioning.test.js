import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {searchNumbers,orderNumber,getOrderStatus,E164} from '../src/providers/telnyx.js';
import {importTelnyxNumber} from '../src/providers/vapi-numbers.js';
import {listCandidates,purchaseNumber,retryNumber} from '../src/provisioning.js';

const ok=body=>({ok:true,async json(){return body}});
const bad=(status,body)=>({ok:false,status,async json(){return body}});

test('telnyx search builds the documented query and keeps only voice-capable E.164 numbers',async()=>{
 let url,headers;
 const fetcher=async(u,o)=>{url=u;headers=o.headers;return ok({data:[
  {phone_number:'+971400000001',cost_information:{monthly_cost:'4.5',upfront_cost:'1',currency:'USD'},features:[{name:'voice'},{name:'sms'}]},
  {phone_number:'+971400000002',features:[{name:'sms'}]},
  {phone_number:'bad',features:[{name:'voice'}]},
 ]})};
 const result=await searchNumbers({apiKey:'KEY',country:'AE',fetcher});
 const parsed=new URL(url);
 assert.equal(parsed.origin+parsed.pathname,'https://api.telnyx.com/v2/available_phone_numbers');
 assert.equal(parsed.searchParams.get('filter[country_code]'),'AE');
 assert.equal(parsed.searchParams.get('filter[phone_number_type]'),'local');
 assert.equal(headers.Authorization,'Bearer KEY');
 assert.deepEqual(result,[{phone_number:'+971400000001',monthly_cost:'4.5',upfront_cost:'1',currency:'USD'}]);
 await assert.rejects(searchNumbers({apiKey:'k',country:'ae',fetcher}),/Invalid country/);
});

test('telnyx order posts the number, includes a requirement group only when given, and surfaces errors',async()=>{
 const bodies=[];
 const fetcher=async(u,o)=>{bodies.push({u,body:JSON.parse(o.body)});return ok({data:{id:'ord-1',status:'pending'}})};
 assert.deepEqual(await orderNumber({apiKey:'k',phoneNumber:'+971400000001',fetcher}),{orderId:'ord-1',status:'pending'});
 await orderNumber({apiKey:'k',phoneNumber:'+971400000001',requirementGroupId:'rg-9',fetcher});
 assert.equal(bodies[0].u,'https://api.telnyx.com/v2/number_orders');
 assert.deepEqual(bodies[0].body,{phone_numbers:[{phone_number:'+971400000001'}]});
 assert.equal(bodies[1].body.requirement_group_id,'rg-9');
 await assert.rejects(orderNumber({apiKey:'k',phoneNumber:'12345',fetcher}),/Invalid phone/);
 await assert.rejects(orderNumber({apiKey:'k',phoneNumber:'+971400000001',fetcher:async()=>bad(422,{errors:[{detail:'Requirement group required'}]})}),/Requirement group required/);
 await assert.rejects(orderNumber({apiKey:'k',phoneNumber:'+971400000001',fetcher:async()=>ok({data:{}})}),/no order id/);
 assert.equal(await getOrderStatus({apiKey:'k',orderId:'ord-1',fetcher:async()=>ok({data:{status:'success'}})}),'success');
 await assert.rejects(getOrderStatus({apiKey:'k',orderId:'../x',fetcher}),/Invalid order id/);
 assert.ok(E164.test('+923001234567'));
});

test('vapi import sends the documented body',async()=>{
 let sent;
 const result=await importTelnyxNumber({apiKey:'V',credentialId:'cred',number:'+971400000001',assistantId:'asst',name:'x'.repeat(80),fetcher:async(u,o)=>{sent={u,o};return ok({id:'pn-1',status:'active'})}});
 assert.equal(sent.u,'https://api.vapi.ai/phone-number');
 const body=JSON.parse(sent.o.body);
 assert.deepEqual({provider:body.provider,number:body.number,credentialId:body.credentialId,assistantId:body.assistantId},{provider:'telnyx',number:'+971400000001',credentialId:'cred',assistantId:'asst'});
 assert.equal(body.name.length,40);
 assert.deepEqual(result,{id:'pn-1'});
 await assert.rejects(importTelnyxNumber({apiKey:'V',credentialId:'c',number:'+1',assistantId:'a',name:'n',fetcher:async()=>bad(400,{message:'Bad credential'})}),/Bad credential/);
});

// Mock database for the orchestration tests.
function db({order={id:5,restaurant_id:3,country_code:'AE',number_mode:'new',status:'paid'},route={provider:'telnyx',mode:'manual'},assistants=[{assistant_id:'asst-1'}],dup=false,numberRow}={}){
 const log=[];
 return {log,async execute(sql,args){
  log.push({sql,args});
  if(sql.includes('FROM plan_orders'))return [order?[order]:[]];
  if(sql.includes('FROM number_routes'))return [route?[route]:[]];
  if(sql.includes('FROM voice_assistants'))return [assistants];
  if(sql.startsWith('INSERT INTO restaurant_numbers')){if(dup)throw Object.assign(Error('dup'),{code:'ER_DUP_ENTRY'});return [{insertId:11}]}
  if(sql.includes('FROM restaurant_numbers'))return [numberRow?[numberRow]:[]];
  return [{affectedRows:1}];
 }};
}
const keys={telnyxKey:'T',vapiKey:'V',credentialId:'cred'};
const statuses=pool=>pool.log.filter(q=>q.sql.startsWith('UPDATE restaurant_numbers')).map(q=>q.sql);

test('candidates are listed only for paid new-number orders routed to Telnyx',async()=>{
 const fetcher=async()=>ok({data:[{phone_number:'+971400000001',features:[{name:'voice'}]}]});
 const good=await listCandidates(db(),5,{...keys,fetcher});
 assert.equal(good.status,200);assert.equal(good.body.country,'AE');assert.equal(good.body.candidates.length,1);
 assert.equal((await listCandidates(db({order:{id:5,restaurant_id:3,country_code:'AE',number_mode:'new',status:'pending_payment'}}),5,{...keys,fetcher})).status,409);
 assert.equal((await listCandidates(db({order:{id:5,restaurant_id:3,country_code:'AE',number_mode:'existing',status:'paid'}}),5,{...keys,fetcher})).status,409);
 assert.equal((await listCandidates(db({route:{provider:'twilio',mode:'manual'}}),5,{...keys,fetcher})).status,409);
 assert.equal((await listCandidates(db({route:null}),5,{...keys,fetcher})).status,409);
 assert.equal((await listCandidates(db({order:null}),5,{...keys,fetcher})).status,404);
 assert.equal((await listCandidates(db(),5,{...keys,telnyxKey:'',fetcher})).status,503);
});

test('purchase orders on Telnyx, imports into Vapi with the single assistant and moves the order to provisioning',async()=>{
 const calls=[];
 const fetcher=async(u,o)=>{calls.push({u,body:JSON.parse(o.body)});return u.includes('telnyx')?ok({data:{id:'ord-7',status:'success'}}):ok({id:'pn-9'})};
 const pool=db();
 const result=await purchaseNumber(pool,5,'+971400000001',{...keys,fetcher});
 assert.equal(result.status,200);assert.equal(result.body.status,'active');
 assert.equal(calls[0].u,'https://api.telnyx.com/v2/number_orders');
 assert.equal(calls[1].u,'https://api.vapi.ai/phone-number');
 assert.equal(calls[1].body.assistantId,'asst-1');
 const claim=pool.log.findIndex(q=>q.sql.startsWith('INSERT INTO restaurant_numbers'));
 assert.ok(claim>=0);
 assert.ok(pool.log.some(q=>q.sql.includes("status='provisioning' WHERE id=? AND status='paid'")));
 assert.ok(statuses(pool).some(s=>s.includes("status='active'")));
});

test('purchase refuses bad input, missing keys, wrong assistant count and duplicates before spending money',async()=>{
 const spend=async()=>{throw Error('must not call provider')};
 assert.equal((await purchaseNumber(db(),5,'not-a-number',{...keys,fetcher:spend})).status,400);
 assert.equal((await purchaseNumber(db(),5,'+971400000001',{...keys,vapiKey:'',fetcher:spend})).status,503);
 assert.equal((await purchaseNumber(db({assistants:[]}),5,'+971400000001',{...keys,fetcher:spend})).status,409);
 assert.equal((await purchaseNumber(db({assistants:[{assistant_id:'a'},{assistant_id:'b'}]}),5,'+971400000001',{...keys,fetcher:spend})).status,409);
 assert.equal((await purchaseNumber(db({dup:true}),5,'+971400000001',{...keys,fetcher:spend})).status,409);
});

test('a failed Telnyx order is recorded as failed and not imported',async()=>{
 const pool=db();let vapiCalled=false;
 const result=await purchaseNumber(pool,5,'+971400000001',{...keys,fetcher:async u=>{if(u.includes('vapi')){vapiCalled=true}return bad(422,{errors:[{detail:'Requirement group required'}]})}});
 assert.equal(result.status,502);
 assert.match(result.body.error,/Requirement group required/);
 assert.ok(statuses(pool).some(s=>s.includes("status='failed'")));
 assert.equal(vapiCalled,false);
});

test('a pending Telnyx order stays pending_provider and is not imported yet',async()=>{
 const pool=db();let vapiCalled=false;
 const result=await purchaseNumber(pool,5,'+971400000001',{...keys,fetcher:async u=>{if(u.includes('vapi'))vapiCalled=true;return ok({data:{id:'ord-8',status:'pending'}})}});
 assert.equal(result.status,202);assert.equal(result.body.status,'pending_provider');
 assert.equal(vapiCalled,false);
});

test('a Vapi import failure leaves the number ordered and marked import_failed',async()=>{
 const pool=db();
 const result=await purchaseNumber(pool,5,'+971400000001',{...keys,fetcher:async u=>u.includes('telnyx')?ok({data:{id:'o',status:'success'}}):bad(400,{message:'Bad credential'})});
 assert.equal(result.status,502);assert.match(result.body.error,/Retry import/);
 assert.ok(statuses(pool).some(s=>s.includes("status='import_failed'")));
});

test('retry finishes the import only when Telnyx reports success',async()=>{
 const row={id:11,restaurant_id:3,plan_order_id:5,phone_number:'+971400000001',provider_order_id:'ord-8',status:'pending_provider'};
 const still=await retryNumber(db({numberRow:row}),11,{...keys,fetcher:async()=>ok({data:{status:'pending'}})});
 assert.equal(still.status,202);
 const done=await retryNumber(db({numberRow:row}),11,{...keys,fetcher:async u=>u.includes('telnyx')?ok({data:{status:'success'}}):ok({id:'pn-2'})});
 assert.equal(done.status,200);assert.equal(done.body.status,'active');
 const failed=db({numberRow:row});
 assert.equal((await retryNumber(failed,11,{...keys,fetcher:async()=>ok({data:{status:'failure'}})})).status,409);
 assert.ok(statuses(failed).some(s=>s.includes("status='failed'")));
 assert.equal((await retryNumber(db({numberRow:{...row,status:'active'}}),11,{...keys,fetcher:async()=>ok({})})).status,409);
 assert.equal((await retryNumber(db(),99,{...keys,fetcher:async()=>ok({})})).status,404);
});

test('number routes are super-admin only, mounted, and the table exists',()=>{
 const src=readFileSync(new URL('../src/numbers.js',import.meta.url),'utf8');
 assert.equal((src.match(/requireAuth, superOnly/g)||[]).length,4);
 assert.match(src,/role='admin'/);
 assert.ok(readFileSync(new URL('../src/server.js',import.meta.url),'utf8').includes('numbersRouter(pool)'));
 assert.match(readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8'),/CREATE TABLE IF NOT EXISTS restaurant_numbers/);
});

test('order sends a customer reference, and the search excludes best-effort numbers',async()=>{
 let body,url;
 await orderNumber({apiKey:'k',phoneNumber:'+971400000001',customerReference:'mar-khoor-5-x',fetcher:async(u,o)=>{body=JSON.parse(o.body);return ok({data:{id:'o1',status:'pending'}})}});
 assert.equal(body.customer_reference,'mar-khoor-5-x');
 const found=await searchNumbers({apiKey:'k',country:'AE',fetcher:async u=>{url=new URL(u);return ok({data:[{phone_number:'+971400000001',best_effort:true},{phone_number:'+971400000002',best_effort:false}]})}});
 assert.equal(url.searchParams.get('filter[best_effort]'),'false');
 assert.deepEqual(found.map(n=>n.phone_number),['+971400000002']);
});

test('purchase sends a reference; a provider error is a clean failure but a timeout is an unknown outcome kept claimed',async()=>{
 let sentBody;
 const okPool=db();
 await purchaseNumber(okPool,5,'+971400000001',{...keys,fetcher:async(u,o)=>u.includes('telnyx')?(sentBody=JSON.parse(o.body),ok({data:{id:'o',status:'pending'}})):ok({id:'x'})});
 assert.match(sentBody.customer_reference,/^mar-khoor-5-[0-9a-f-]{36}$/);
 const timeoutPool=db();
 const result=await purchaseNumber(timeoutPool,5,'+971400000001',{...keys,fetcher:async()=>{throw Error('The operation timed out')}});
 assert.equal(result.status,502);
 assert.match(result.body.error,/outcome is unknown/);
 assert.match(result.body.customer_reference,/^mar-khoor-5-/);
 assert.ok(!statuses(timeoutPool).some(s=>s.includes("status='failed'")));
 assert.ok(timeoutPool.log.some(q=>q.sql.includes('SET last_error=?')&&String(q.args[0]).includes('Check Telnyx')));
});

test('buying requires an explicit confirm_purchase flag from the admin screen',()=>{
 assert.match(readFileSync(new URL('../src/numbers.js',import.meta.url),'utf8'),/confirm_purchase !== true/);
 assert.match(readFileSync(new URL('../public/platform.js',import.meta.url),'utf8'),/confirm_purchase: true/);
});
