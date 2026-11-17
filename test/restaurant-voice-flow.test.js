import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import crypto from 'node:crypto';

function mockControl(extra={}) {
 const handlers = new Map();
 return {disabled:false,hidden:false,dataset:{},addEventListener:(name,cb)=>handlers.set(name,cb),
  trigger(name,data){return handlers.get(name)?.(data)}, ...extra};
}
function createHarness() {
 const elements = new Map();
 const holder=mockControl({dataset:{
  menuUrl:'/api/public/restaurants/urban-cafe/menu',
  orderUrl:'/api/public/restaurants/urban-cafe/orders',
  voiceUrl:'/r/urban-cafe/assistant/voice',
 }});
 for (const selector of ['#start-voice','#stop-voice','#voice-status','#assistant-audio','#record-consent',
   '#start-recording','#stop-recording','#recording-download','#assistant-voice-orb','#orb-caption','#orb-close']) {
  elements.set(selector,mockControl());
 }
 elements.get('#start-voice').closest=()=>holder;
 elements.get('#assistant-audio').pause=()=>{};
 elements.get('#assistant-voice-orb').dataset={};
 let posts=0,menuloads=0,timer;
 const sentOrders=[],orderCards=[],notices=[],transcripts=[];
 const receiptToken='a'.repeat(48);
 const fetch=async(url,request)=>{
  if(url===holder.dataset.menuUrl){
   menuloads++;
   return {ok:true,json:async()=>({restaurant:{slug:'urban-cafe',currency:'PKR'},items:[
    {id:5,name:'Cappuccino',price_minor:42000},{id:6,name:'Mocha',price_minor:49000}
   ]})};
  }
  if(url===holder.dataset.orderUrl){
   posts++;
   sentOrders.push(JSON.parse(request.body));
   return {status:201,json:async()=>({
    order_id:123,status:'pending',total_minor:91000,tracking_token:receiptToken
   })};
  }
  throw Error('Unexpected mock network target');
 };
 const sandbox={document:{querySelector:s=>elements.get(s)},window:{
   MarKhoorAssistant:{
    upsertVoiceMessage:(role,id,text,append)=>transcripts.push({role,id,text,append}),
    showNotice:text=>notices.push(text),
    showOrder:receipt=>orderCards.push(receipt),
   },
   addEventListener:()=>{},
 },addEventListener:()=>{},navigator:{},fetch,crypto,
 AbortController,RTCPeerConnection:class{},MediaStream:class{},
 Intl,Map,Date,Number,Promise,String,JSON,Array,Error,
 clearTimeout:()=>{},setTimeout:(fn)=>{timer=fn;return 1;},
 URL:{revokeObjectURL:()=>{}},speechSynthesis:{},
 };
 sandbox.globalThis=sandbox;
 const context=vm.createContext(sandbox);
 const src=readFileSync(new URL('../public/restaurant-assistant-voice.js',import.meta.url),'utf8');
 vm.runInContext(src+'\nglobalThis.voiceTools={prepareOrder,submitOrder,handleRealtime,explicitYes,finish};',context);
 const current={peer:{connectionState:'connected',close:()=>{}},
  controller:new AbortController(),requestId:'f46ed7c9-a917-471c-bac4-72e6d333ba16',
  events:mockControl({readyState:'open',send:()=>{}}),mic:{getTracks:()=>[]}};
 context.current=current;
 vm.runInContext('call=current',context);
 return {current,voice:context.voiceTools,elements,posts:()=>posts,menuloads:()=>menuloads,
  sentOrders,orderCards,notices,transcripts,finishTimer:()=>timer};
}
test('realtime voice order needs draft, explicit customer confirmation, backend receipt and final goodbye',async()=>{
 const h=createHarness();
 const order={customer_name:'Guest',items:[{menu_item_id:5,quantity:1},{menu_item_id:6,quantity:1}]};
 await h.voice.prepareOrder(h.current,order);
 assert.equal(h.current.draft.total_minor,91000);
 assert.equal(h.posts(),0);
 assert.ok(h.notices.some(s=>s.includes('Draft order (not yet submitted)')));
 await assert.rejects(()=>h.voice.submitOrder(h.current,{confirmed:true}),/explicitly confirm/);
 assert.equal(h.posts(),0);
 h.voice.handleRealtime(h.current,{type:'conversation.item.input_audio_transcription.completed',
  item_id:'utterance1',transcript:'haan'});
 assert.ok(h.transcripts.some(e=>e.role==='user'&&e.text==='haan'));
 const placed=await h.voice.submitOrder(h.current,{confirmed:true});
 assert.equal(placed.order_id,123);
 assert.equal(h.posts(),1);
 assert.equal(h.sentOrders[0].client_request_id,h.current.requestId);
 assert.deepEqual([...h.sentOrders[0].items].map(i=>i.menu_item_id),[5,6]);
 assert.equal(h.orderCards.length,1);
 assert.equal(h.orderCards[0].tracking_token,'a'.repeat(48));
 assert.ok(h.notices.some(s=>/pending acceptance/.test(s)));
 assert.equal(h.current.closeAfterFinalReply,true);
 h.voice.handleRealtime(h.current,{type:'response.done',response:{output:[]}});
 assert.equal(typeof h.finishTimer(),'function');
 h.finishTimer()();
 assert.equal(h.elements.get('#assistant-voice-orb').hidden,true);
 assert.equal(h.elements.get('#start-voice').disabled,false);
});
test('voice ordering blocks nonexistent items, unsafe quantities and ambiguous confirmation',async()=>{
 const h=createHarness();
 await assert.rejects(()=>h.voice.prepareOrder(h.current,{customer_name:'A',
  items:[{menu_item_id:99,quantity:1}]}),/Invalid menu selection/);
 await assert.rejects(()=>h.voice.prepareOrder(h.current,{customer_name:'A',
  items:[{menu_item_id:5,quantity:100}]}),/Invalid menu selection/);
 assert.equal(h.voice.explicitYes('no'),false);
 assert.equal(h.voice.explicitYes('nahin'),false);
 assert.equal(h.voice.explicitYes('haan'),true);
 assert.equal(h.voice.explicitYes('haan nahi'),false);
 assert.equal(h.posts(),0);
});
