import test from 'node:test';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {processWhatsAppAIJobs} from '../src/whatsapp-ai-worker.js';

test('AI worker replies using mapped restaurant menu and stores outbound history',async()=>{
 const oldAI=process.env.OPENAI_API_KEY,oldMeta=process.env.WHATSAPP_ACCESS_TOKEN;
 process.env.OPENAI_API_KEY='test-ai-key';process.env.WHATSAPP_ACCESS_TOKEN='test-meta-token';
 const queries=[],requests=[];
 const job={inbound_message_id:'wamid.in-1',restaurant_id:7,phone_number_id:'12345',sender:'306900000000',text_body:'What is on the menu?',name:'Test Cafe',locale:'en',currency:'EUR'};
 const pool={async execute(sql,args=[]){
  queries.push({sql,args});
  if(sql.startsWith('SELECT j.inbound_message_id'))return [[job]];
  if(sql.startsWith('UPDATE whatsapp_ai_jobs j JOIN'))return [{affectedRows:1}];
  if(sql.startsWith('SELECT name,description'))return [[{name:'Soup',description:'Vegetable',price_minor:450}]];
  if(sql.startsWith('SELECT s.enabled FROM whatsapp_ai_settings'))return [[{enabled:1}]];
  if(sql.startsWith('INSERT INTO whatsapp_outbound_messages'))return [{affectedRows:1}];
  if(sql.startsWith("UPDATE whatsapp_ai_jobs SET status='sent'"))return [{affectedRows:1}];
  throw Error('Unexpected SQL: '+sql);
 }};
 const fetcher=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});if(url.includes('api.openai.com'))return {ok:true,json:async()=>({choices:[{message:{content:'Soup costs 4.50 EUR.'}}]})};return {ok:true,json:async()=>({messages:[{id:'wamid.out-1'}]})}};
 try{
  const result=await processWhatsAppAIJobs(pool,{fetcher});
  assert.deepEqual(result,{claimed:1,sent:1,failed:0});
  assert.equal(requests.length,2);
  assert.match(requests[0].body.messages[0].content,/Test Cafe/);
  assert.match(requests[0].body.messages[0].content,/Soup/);
  assert.equal(requests[1].body.to,'306900000000');
  assert.equal(queries.find(q=>q.sql.startsWith('INSERT INTO whatsapp_outbound_messages')).args[1],7);
 }finally{
  if(oldAI===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldAI;
  if(oldMeta===undefined)delete process.env.WHATSAPP_ACCESS_TOKEN;else process.env.WHATSAPP_ACCESS_TOKEN=oldMeta;
 }
});

test('AI worker refuses to send after restaurant disables auto-reply',async()=>{
 const oldAI=process.env.OPENAI_API_KEY,oldMeta=process.env.WHATSAPP_ACCESS_TOKEN;
 process.env.OPENAI_API_KEY='test-ai-key';process.env.WHATSAPP_ACCESS_TOKEN='test-meta-token';
 const calls=[];
 const pool={async execute(sql,args=[]){
  if(sql.startsWith('SELECT j.inbound_message_id'))return [[{inbound_message_id:'wamid.in-2',restaurant_id:8,phone_number_id:'67890',sender:'306900000001',text_body:'Hi',name:'Cafe',locale:'en',currency:'EUR'}]];
  if(sql.startsWith('UPDATE whatsapp_ai_jobs j JOIN'))return [{affectedRows:1}];
  if(sql.startsWith('SELECT name,description'))return [[]];
  if(sql.startsWith('SELECT s.enabled FROM whatsapp_ai_settings'))return [[{enabled:0}]];
  if(sql.startsWith("UPDATE whatsapp_ai_jobs SET status='failed'"))return [{affectedRows:1}];
  throw Error('Unexpected SQL: '+sql);
 }};
 const fetcher=async(url)=>{calls.push(url);return {ok:true,json:async()=>({choices:[{message:{content:'Hello'}}]})}};
 try{
  const result=await processWhatsAppAIJobs(pool,{fetcher});
  assert.deepEqual(result,{claimed:1,sent:0,failed:1});
  assert.equal(calls.length,1);
 }finally{
  if(oldAI===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldAI;
  if(oldMeta===undefined)delete process.env.WHATSAPP_ACCESS_TOKEN;else process.env.WHATSAPP_ACCESS_TOKEN=oldMeta;
 }
});

test('continuous worker answers for every paid restaurant plus listed pilot restaurants', async t => {
 const {startWhatsAppAIWorker,workerScope} = await import('../src/whatsapp-ai-worker.js');
 const keys = ['WHATSAPP_AI_WORKER_ENABLED','WHATSAPP_AI_WORKER_RESTAURANT_ID','OPENAI_API_KEY','WHATSAPP_ACCESS_TOKEN'];
 const previous = keys.map(key => process.env[key]);
 t.after(() => keys.forEach((key, i) => {
  if (previous[i] === undefined) delete process.env[key];
  else process.env[key] = previous[i];
 }));
 assert.deepEqual(workerScope({WHATSAPP_AI_WORKER_RESTAURANT_ID:'37, 5,x,37'}).alwaysAllowed,[37,5]);
 assert.deepEqual(workerScope({}).alwaysAllowed,[]);
 process.env.WHATSAPP_AI_WORKER_ENABLED='1';
 process.env.OPENAI_API_KEY='test';
 process.env.WHATSAPP_ACCESS_TOKEN='test';
 process.env.WHATSAPP_AI_WORKER_RESTAURANT_ID='37';
 const seen=[];
 const pool={async execute(sql,args){seen.push([sql,args]);return [[]];}};
 startWhatsAppAIWorker(pool);
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(seen.length,1);
 const [sql,args]=seen[0];
 assert.match(sql,/sub\.status='active'/,'paid restaurants only');
 assert.match(sql,/OR j\.restaurant_id IN \(\?\)/,'plus the pilot list');
 assert.match(sql,/JOIN whatsapp_ai_settings s ON s\.restaurant_id=j\.restaurant_id AND s\.enabled=1/,'owner opt-in still required');
 assert.match(sql,/whatsapp_numbers w ON .* AND w\.active=1/,'linked number still required');
 assert.deepEqual(args,[37]);
 process.env.WHATSAPP_AI_WORKER_ENABLED='0';
 startWhatsAppAIWorker(pool);
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(seen.length,1,'off switch: only super-admin pilots are served (none here)');
});

test('Hostinger can load the WhatsApp worker synchronously', () => {
 execFileSync(process.execPath, ['-e', 'require("./src/whatsapp-ai-worker.js")'], {
  cwd: new URL('../', import.meta.url),
 });
});
