import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'node:crypto';
import { integrationRouter } from '../src/integrations.js';
import { resolveIncomingWhatsAppSip } from '../src/whatsapp-sip-routing.js';
import { emitWhatsAppCallLog, normalizeBusinessPhone, parseBusinessSipUri, sipFailClosedEnabled } from '../src/whatsapp-sip-identifiers.js';

// This file tests enforced behavior; all other suite tests use the default OFF flag.
const previousFlag=process.env.WHATSAPP_SIP_FAIL_CLOSED_ENABLED;
process.env.WHATSAPP_SIP_FAIL_CLOSED_ENABLED='1';
after(()=>{if(previousFlag===undefined)delete process.env.WHATSAPP_SIP_FAIL_CLOSED_ENABLED;else process.env.WHATSAPP_SIP_FAIL_CLOSED_ENABLED=previousFlag});
import { processVapiEvent } from '../src/vapi-events.js';
import { vapiToolAdapterRouter } from '../src/vapi-adapter.js';

const example = {
  4: { phone_number_id:'meta-four', number:'15551560265', sip_user:'+15551560265',
    sip_host:'sip.vapi.ai', vapi_phone_number_id:'vp-4', assistant_id:'asst-4' },
};
function poolFor(state=example, { numberTenant=4, assistantTenant=4 }={}) {
  const queries=[];
  return { queries, async query(sql, params) {
    queries.push({sql, params});
    if(sql.startsWith('SELECT setting_value')) return [[{setting_value:JSON.stringify(state)}]];
    return [[]];
  }, async execute(sql, params) {
    queries.push({sql, params});
    if(sql.startsWith('SELECT restaurant_id FROM whatsapp_numbers')) {
      return [numberTenant ? [{restaurant_id:numberTenant}] : []];
    }
    if(sql.startsWith('SELECT restaurant_id FROM voice_assistants')) {
      return [assistantTenant ? [{restaurant_id:assistantTenant}] : []];
    }
    if(sql.includes('FROM voice_assistants')) return [[{restaurant_id:assistantTenant}]];
    return [{affectedRows:1}];
  } };
}
const call=(resource='vp-4',sip='sip:+15551560265@sip.vapi.ai')=>({
  id:'call-123',type:'inboundPhoneCall',phoneNumberId:resource,assistantId:'asst-4',
  phoneNumber:{id:resource,provider:'vapi',sipUri:sip},
});
const resolve=(pool,number=call(),assistantId='asst-4')=>resolveIncomingWhatsAppSip(pool,{call:number,assistantId});

test('business +E164 and digits-only SIP aliases normalize to one identity',()=>{
  assert.equal(normalizeBusinessPhone('+1 (555) 156-0265'),'15551560265');
  assert.equal(normalizeBusinessPhone('15551560265'),'15551560265');
  assert.deepEqual(parseBusinessSipUri('sip:+15551560265@sip.vapi.ai'),{digits:'15551560265',host:'sip.vapi.ai'});
  assert.deepEqual(parseBusinessSipUri('sip:15551560265@sip.vapi.ai'),{digits:'15551560265',host:'sip.vapi.ai'});
  assert.equal(normalizeBusinessPhone('sip:15551560265@sip.vapi.ai'),null);
});

test('correct incoming SIP resource maps through active Meta number ownership, never restaurant name',async()=>{
  const pool=poolFor();
  const route=await resolve(pool);
  assert.equal(route.scope,'validated');
  assert.equal(route.tenantId,4);
  assert.equal(route.metaPhoneNumberId,'meta-four');
  assert.equal(route.vapiPhoneNumberId,'vp-4');
  assert.ok(pool.queries.some(q=>q.sql.includes('FROM whatsapp_numbers')&&q.params[0]==='meta-four'));
  assert.equal(pool.queries.some(q=>/name|slug/i.test(q.sql)),false,'names are never used for tenant lookup');
  assert.equal((await resolve(pool,call('vp-4','sip:15551560265@sip.vapi.ai'))).scope,'validated');
});

test('unknown SIP resource rejects even when its assistant ID resembles the correct tenant',async()=>{
  const pool=poolFor();
  const result=await resolve(pool,call('unrecognized-vapi-id'));
  assert.deepEqual([result.scope,result.reason],['rejected','unknown_phone_resource']);
  assert.equal(pool.queries.some(q=>/INSERT|UPDATE|DELETE/i.test(q.sql)),false);
});

test('missing SIP resource is not silently resolved from a customer or assistant name',async()=>{
  const pool=poolFor();
  const result=await resolve(pool,{id:'call-x',type:'inboundPhoneCall',phoneNumber:{provider:'vapi'}});
  assert.equal(result.reason,'missing_phone_resource');
});

test('duplicate normalized + and digits-only WhatsApp numbers across tenants reject',async()=>{
  const state={...example,18:{phone_number_id:'meta-eighteen',number:'+1 (555) 156-0265',sip_user:'15551560265',
    sip_host:'sip.vapi.ai',vapi_phone_number_id:'vp-18',assistant_id:'asst-18'}};
  const pool=poolFor(state);
  const result=await resolve(pool);
  assert.equal(result.scope,'rejected');
  assert.equal(result.reason,'duplicate_normalized_number');
  assert.equal(pool.queries.some(q=>q.sql.includes('FROM whatsapp_numbers')),false,'fail before touching tenant data');
});

test('assistant from WhatsApp 18 cannot read WhatsApp 4 by reusing the SIP destination',async()=>{
  const result=await resolve(poolFor(),call(),'asst-18');
  assert.deepEqual([result.scope,result.reason],['rejected','assistant_mismatch']);
});

test('authoritative Meta-number owner mismatch blocks a valid-looking Vapi resource',async()=>{
  const result=await resolve(poolFor(example,{numberTenant:18}),call());
  assert.deepEqual([result.scope,result.reason],['rejected','phone_tenant_mismatch']);
});

test('active database voice-assistant owner mismatch blocks another tenant',async()=>{
  const result=await resolve(poolFor(example,{assistantTenant:18}),call());
  assert.deepEqual([result.scope,result.reason],['rejected','assistant_tenant_mismatch']);
});

test('SIP failure event with unknown phone cannot fall back into voice_calls of another tenant',async()=>{
  const pool=poolFor();
  const result=await processVapiEvent(pool,{message:{type:'status-update',status:'ended',
    call:{...call('unknown-vapi'),sip:{responseCode:503}}}});
  assert.deepEqual(result,{processed:false,reason:'sip_route_rejected'});
  assert.equal(pool.queries.some(q=>q.sql.includes('INSERT INTO voice_calls')),false);
});

test('Vapi get_menu tool denies cross-tenant SIP request before menu or order queries',async()=>{
  const pool=poolFor();
  const before=process.env.VAPI_TOOL_SECRET;
  process.env.VAPI_TOOL_SECRET='isolated-test-secret';
  const app=express();app.use('/integrations/vapi',vapiToolAdapterRouter(pool));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    const res=await fetch('http://127.0.0.1:'+server.address().port+'/integrations/vapi/tools',{
      method:'POST',headers:{'content-type':'application/json','authorization':'Bearer isolated-test-secret'},
      body:JSON.stringify({message:{assistantId:'asst-4',call:call('unknown-vapi'),
        toolCallList:[{id:'tool-1',function:{name:'get_menu',arguments:{}}}]}}),
    });
    assert.equal(res.status,403);
    assert.equal(pool.queries.some(q=>q.sql.includes('FROM menu_items')||q.sql.includes('INSERT INTO orders')),false);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    if(before===undefined)delete process.env.VAPI_TOOL_SECRET;
    else process.env.VAPI_TOOL_SECRET=before;
  }
});

test('structured trace logs business phone and safe IDs, never payload secrets or customer number',()=>{
  const logged=[];
  const record=emitWhatsAppCallLog({log:s=>logged.push(s)},{source:'meta',
    metaCallId:'meta-call-1',businessNumber:'+1 (555) 156-0265',tenantId:4,
    vapiPhoneNumberId:'vp-4',assistantId:'asst-4',sipStatus:'connect',sipResponse:503,
    customerNumber:'+19998887777',apiKey:'should-never-print',decision:'mapped'});
  assert.equal(record.meta_call_id,'meta-call-1');
  assert.equal(record.normalized_phone_number,'+15551560265');
  assert.equal(record.sip_response,503);
  assert.equal(JSON.stringify(record).includes('19998887777'),false);
  assert.equal(logged[0].includes('should-never-print'),false);
});

test('ordinary webCall is unaffected by WhatsApp SIP resolution',async()=>{
  assert.equal((await resolve(poolFor(),{id:'web-123',type:'webCall'},'asst-4')).scope,'other');
});


test('signed Meta calling webhook emits a Meta call ID bound to the authoritative phone mapping',async()=>{
  const state={4:{...example[4],phone_number_id:'1488585814336543'}};
  const pool=poolFor(state);
  const oldSecret=process.env.META_APP_SECRET;
  process.env.META_APP_SECRET='isolated-meta-test-secret';
  const lines=[],log=console.log;
  const app=express();app.use('/integrations',integrationRouter(pool));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    console.log=(...args)=>lines.push(args.join(' '));
    const body=JSON.stringify({object:'whatsapp_business_account',entry:[{
      changes:[{field:'calls',value:{
        metadata:{phone_number_id:'1488585814336543'},
        calls:[{id:'wacid.test-call-1',event:'connect',from:'+19998887777'}],
      }}],
    }]});
    const signature='sha256='+crypto.createHmac('sha256','isolated-meta-test-secret').update(body).digest('hex');
    const res=await fetch('http://127.0.0.1:'+server.address().port+'/integrations/webhooks/whatsapp',{
      method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body,
    });
    assert.equal(res.status,202);
    const record=lines.map(line=>{try{return JSON.parse(line)}catch{return null}})
      .find(v=>v?.event==='whatsapp_ai_call_route'&&v?.source==='meta');
    assert.ok(record,'signed Meta call gets a structured record');
    assert.equal(record.meta_call_id,'wacid.test-call-1');
    assert.equal(record.tenant_id,4);
    assert.equal(record.vapi_phone_number_resource,'vp-4');
    assert.equal(record.selected_assistant,'asst-4');
    assert.equal(record.normalized_phone_number,'+15551560265');
    assert.equal(lines.join(' ').includes('19998887777'),false,'caller PII not logged');
  }finally{
    console.log=log;await new Promise(resolve=>server.close(resolve));
    if(oldSecret===undefined)delete process.env.META_APP_SECRET;else process.env.META_APP_SECRET=oldSecret;
  }
});


test('inbound unknown phone resource without provider metadata fails closed',async()=>{
  const route=await resolve(poolFor(),{id:'c',type:'inboundPhoneCall',phoneNumberId:'orphan-resource'});
  assert.equal(route.scope,'rejected');
  assert.equal(route.reason,'unknown_phone_resource');
});

test('SIP inbound lacking phone ID does not fall back to an assistant',async()=>{
  const route=await resolve(poolFor(),{id:'c',type:'inboundPhoneCall'},'asst-18');
  assert.deepEqual([route.scope,route.reason],['rejected','missing_phone_resource']);
});

test('a separately identified Telnyx PSTN call is not reclassified as WhatsApp SIP',async()=>{
  const route=await resolve(poolFor(),{id:'pstn',type:'inboundPhoneCall',phoneNumberId:'telnyx-id',
    phoneNumber:{provider:'telnyx',number:'+14352959324'}},'pstn-assistant');
  assert.equal(route.scope,'other');
});


test('Telnyx PSTN route remains separate even when its assistant is shared with WhatsApp',async()=>{
  const route=await resolve(poolFor(),{id:'pstn',type:'inboundPhoneCall',
    phoneNumberId:'telnyx-only',phoneNumber:{provider:'telnyx',number:'+14352959324'}},'asst-4');
  assert.equal(route.scope,'other');
});


test('feature flag defaults OFF in production unless explicitly set to 1',()=>{
  assert.equal(sipFailClosedEnabled({}),false);
  assert.equal(sipFailClosedEnabled({WHATSAPP_SIP_FAIL_CLOSED_ENABLED:'false'}),false);
  assert.equal(sipFailClosedEnabled({WHATSAPP_SIP_FAIL_CLOSED_ENABLED:'1'}),true);
});

test('legacy Vapi tool routing remains unchanged while fail-closed flag is OFF',async()=>{
  const pool=poolFor();
  const saved=process.env.WHATSAPP_SIP_FAIL_CLOSED_ENABLED;
  process.env.WHATSAPP_SIP_FAIL_CLOSED_ENABLED='0';
  const old=process.env.VAPI_TOOL_SECRET;
  process.env.VAPI_TOOL_SECRET='isolated-test-secret';
  const app=express();app.use('/integrations/vapi',vapiToolAdapterRouter(pool));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try {
    const res=await fetch('http://127.0.0.1:'+server.address().port+'/integrations/vapi/tools',{
      method:'POST',headers:{'content-type':'application/json','authorization':'Bearer isolated-test-secret'},
      body:JSON.stringify({message:{assistantId:'asst-4',call:call('unknown-vapi'),toolCallList:[
        {id:'tool-1',function:{name:'get_menu',arguments:{}}}
      ]}}),
    });
    assert.notEqual(res.status,403,'flag OFF must not enforce a SIP ownership 403');
  }finally{
    await new Promise(resolve=>server.close(resolve));
    process.env.WHATSAPP_SIP_FAIL_CLOSED_ENABLED=saved;
    if(old===undefined)delete process.env.VAPI_TOOL_SECRET;else process.env.VAPI_TOOL_SECRET=old;
  }
});
