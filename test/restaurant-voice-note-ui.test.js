import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function control(extra={}){
  const handlers={};
  return {disabled:false,hidden:false,dataset:{},addEventListener:(n,cb)=>{handlers[n]=cb;},
    click:async()=>handlers.click?.(), ...extra};
}
function browser(){
  let stopped=0,submits=0,uploads=0,postBody,postUrl;
  const item=new Map();
  for(const id of ['#start-voice-note','#stop-voice-note','#send-voice-note',
    '#cancel-voice-note','#voice-note-status']){
    item.set(id,control());
  }
  item.get('#start-voice-note').closest=()=>({dataset:{transcribeUrl:'/r/alpha/assistant/transcribe'}});
  const input={value:''};
  const form=control({elements:{message:input},requestSubmit:()=>submits++});
  item.set('#assistant form',form);
  class Recorder{
    static isTypeSupported(mime){return mime.startsWith('audio/webm');}
    constructor(_stream,opts){this.mimeType=opts?.mimeType||'audio/webm';this.state='inactive';}
    start(){this.state='recording';}
    stop(){
      this.state='inactive';
      this.ondataavailable?.({data:new Blob([new Uint8Array(300)],{type:'audio/webm'})});
      this.onstop?.();
    }
  }
  const listeners={};
  const context=vm.createContext({
    document:{querySelector:x=>item.get(x)},
    window:{MarKhoorVoice:{isActive:()=>false},addEventListener:(n,cb)=>{listeners[n]=cb;}},
    addEventListener:()=>{},
    navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stopped++}]})}},
    MediaRecorder:Recorder,Blob,AbortController,
    fetch:async(url,options)=>{
      uploads++;postUrl=url;postBody=options.body;
      return {ok:true,json:async()=>({text:'Please show the menu'})};
    },
    setTimeout:()=>1,clearTimeout:()=>{},
  });
  vm.runInContext(readFileSync(new URL('../public/restaurant-assistant-voice-note.js',import.meta.url),'utf8'),context);
  return {item,input,form,context,stopped:()=>stopped,submits:()=>submits,
    uploads:()=>uploads,post:()=>({url:postUrl,body:postBody}),listeners};
}
test('voice note records only mic, requires Send, transcribes and posts to normal AI chat',async()=>{
  const h=browser();
  const record=h.item.get('#start-voice-note');
  const stop=h.item.get('#stop-voice-note');
  const send=h.item.get('#send-voice-note');
  await record.click();
  assert.equal(stop.hidden,false);
  assert.equal(h.uploads(),0);
  await stop.click();
  assert.equal(send.hidden,false);
  assert.equal(h.stopped(),1);
  assert.equal(h.uploads(),0);
  await send.click();
  assert.equal(h.uploads(),1);
  assert.equal(h.post().url,'/r/alpha/assistant/transcribe');
  assert.equal(h.post().body.size,300);
  assert.equal(h.input.value,'Please show the menu');
  assert.equal(h.submits(),1);
  assert.equal(record.hidden,false);
});
test('discarded voice note never reaches AI transcription',async()=>{
  const h=browser();
  await h.item.get('#start-voice-note').click();
  await h.item.get('#cancel-voice-note').click();
  await h.item.get('#send-voice-note').click();
  assert.equal(h.uploads(),0);
  assert.equal(h.submits(),0);
  assert.equal(h.stopped(),1);
});