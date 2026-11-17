import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { sitesRouter } from '../src/sites.js';

const restaurants={
  'alpha-cafe':{id:11,name:'Alpha Cafe',slug:'alpha-cafe',currency:'EUR',locale:'en',
    website_assistant_provisioned:1,config:JSON.stringify({assistantRecording:true})},
  'beta-cafe':{id:22,name:'Beta Cafe',slug:'beta-cafe',currency:'PKR',locale:'ur',
    website_assistant_provisioned:1,config:'{}'},
  'legacy-cafe':{id:33,name:'Legacy',slug:'legacy-cafe',currency:'PKR',locale:'en',
    website_assistant_provisioned:0,config:JSON.stringify({assistantRecording:true})}
};
const pool={
  async execute(sql,args){
    if(sql.includes('FROM restaurants r JOIN restaurant_sites'))
      return [restaurants[args[0]]?[restaurants[args[0]]]:[]];
    if(sql.includes('FROM menu_items WHERE restaurant_id='))return [[]];
    throw Error('Unexpected SQL');
  }
};
async function harness(upstream,run){
  const saved={key:process.env.OPENAI_API_KEY,reg:process.env.REGISTRATION_WEBSITE_ASSISTANT_ENABLED};
  process.env.OPENAI_API_KEY='fake-key-for-unit-test';
  delete process.env.REGISTRATION_WEBSITE_ASSISTANT_ENABLED;
  const app=express();
  app.use(sitesRouter(pool,{voiceFetch:upstream}));
  const server=app.listen(0);
  try{
    await new Promise(resolve=>server.once('listening',resolve));
    await run('http://127.0.0.1:'+server.address().port);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    if(saved.key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=saved.key;
    if(saved.reg===undefined)delete process.env.REGISTRATION_WEBSITE_ASSISTANT_ENABLED;else process.env.REGISTRATION_WEBSITE_ASSISTANT_ENABLED=saved.reg;
  }
}
const audio=Buffer.alloc(250,0x55);
const send=(base,slug,data=audio,mime='audio/webm')=>fetch(base+'/r/'+slug+'/assistant/transcribe',{
  method:'POST',headers:{'Content-Type':mime},body:data
});
test('voice note is transcribed by AI only for the selected opted-in restaurant',async()=>{
  let calls=0;
  await harness(async (url,options)=>{
    calls++;
    assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(options.method,'POST');
    assert.equal(options.body.get('model'),'gpt-4o-mini-transcribe');
    const file=options.body.get('file');
    assert.equal(file.name,'voice-note.webm');
    assert.equal(file.size,audio.length);
    return {ok:true,json:async()=>({text:' Do you have soup? '})};
  },async base=>{
    const a=await send(base,'alpha-cafe');
    assert.equal(a.status,200);
    assert.deepEqual(await a.json(),{text:'Do you have soup?'});
    assert.equal((await send(base,'beta-cafe')).status,404);
    assert.equal((await send(base,'legacy-cafe')).status,404);
    assert.equal((await send(base,'invalid-slug')).status,404);
    assert.equal(calls,1);
  });
});
test('voice note rejects invalid media, tiny payloads, missing provider and leaks',async()=>{
  let calls=0;
  await harness(async()=>{calls++;return {ok:false,json:async()=>({error:{message:'SECRET provider error'}})}},async base=>{
    assert.equal((await send(base,'alpha-cafe',audio,'text/plain')).status,415);
    assert.equal((await send(base,'alpha-cafe',Buffer.alloc(30))).status,400);
    const bad=await send(base,'alpha-cafe');
    assert.equal(bad.status,502);
    assert.doesNotMatch(await bad.text(),/SECRET|fake-key/);
    assert.equal(calls,1);
    delete process.env.OPENAI_API_KEY;
    assert.equal((await send(base,'alpha-cafe')).status,503);
    assert.equal(calls,1);
  });
});
test('voice note cannot inject an oversized transcription into chat',async()=>{
  await harness(async()=>({ok:true,json:async()=>({text:'a'.repeat(1201)})}),async base=>{
    assert.equal((await send(base,'alpha-cafe')).status,422);
  });
});