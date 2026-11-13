import express from 'express';
import crypto from 'node:crypto';
import {createVoiceOrderHandler} from './voice-tools.js';

// Adapter for Vapi-style tool-calls payloads. Configure a private server URL
// and verify the provider's current security options before production.
export function vapiToolAdapterRouter(pool){
 const router=express.Router();
 router.post('/tools',express.json({limit:'128kb'}),async(req,res)=>{
  const secret=process.env.VAPI_TOOL_SECRET;
  const provided=req.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]??req.get('x-markhoor-tool-secret')??'';
  if(!secret)return res.status(503).json({error:'Not configured'});
  const a=Buffer.from(provided),b=Buffer.from(secret);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Unauthorized'});
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({error:'Invalid request'});
  const message=req.body.message;
  const calls=message?.toolCallList;
  const assistantId=message?.assistant?.id||message?.assistantId||message?.call?.assistantId||message?.call?.assistant?.id;
  if(!Array.isArray(calls)||calls.length<1||calls.length>10||typeof assistantId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(assistantId))return res.status(400).json({error:'Invalid tool call envelope'});
  if(new Set(calls.map(c=>c?.id)).size!==calls.length)return res.status(400).json({error:'Duplicate tool call ID'});
  const results=[];
  for(const call of calls){
   const id=call?.id;
   if(typeof id!=='string'||id.length>128)return res.status(400).json({error:'Invalid tool call ID'});
   const name=call?.function?.name;
   if(name==='place_order'){
    let args=call?.function?.arguments;
    if(typeof args==='string'){try{args=JSON.parse(args)}catch{args=null}}
    if(!args||typeof args!=='object'||Array.isArray(args)){results.push({toolCallId:id,result:{error:'Invalid arguments'}});continue}
    // The provider call identifier is read from the message envelope, not the model's arguments.
    const callId=message?.call?.id;
    if(typeof callId!=='string'||!/^[-a-zA-Z0-9_:]{1,128}$/.test(callId)){results.push({toolCallId:id,result:{error:'Missing call ID'}});continue}
    const payload={customer_name:args.customer_name,confirmed:args.confirmed,items:args.items,call_id:callId};
    // Never accept tenant identity or call ID supplied by model-generated arguments.
    const response=await new Promise(resolve=>{
     const mockRes={statusCode:200,status(code){this.statusCode=code;return this},json(body){resolve({status:this.statusCode,body});return this}};
     Promise.resolve(createVoiceOrderHandler(pool)({params:{assistantId},body:payload},mockRes)).catch(()=>resolve({status:503,body:{error:'Order unavailable'}}));
    });
    results.push({toolCallId:id,result:response.body});
    continue;
   }
   if(name!=='get_menu'){results.push({toolCallId:id,result:{error:'Unsupported tool'}});continue}
   try{
    const [mapped]=await pool.execute('SELECT r.id,r.name,r.currency,r.locale FROM voice_assistants v JOIN restaurants r ON r.id=v.restaurant_id WHERE v.assistant_id=? AND v.active=1 LIMIT 1',[assistantId]);
    if(!mapped.length){results.push({toolCallId:id,result:{error:'Assistant not mapped'}});continue}
    const restaurant=mapped[0];
    const [items]=await pool.execute('SELECT id,name,description,price_minor FROM menu_items WHERE restaurant_id=? AND active=1 ORDER BY id',[restaurant.id]);
    results.push({toolCallId:id,result:{restaurant:{name:restaurant.name,currency:restaurant.currency,locale:restaurant.locale},items}});
   }catch{results.push({toolCallId:id,result:{error:'Menu unavailable'}})}
  }
  res.json({results:results.map(({toolCallId,result})=>result.error
   ? {toolCallId,error:result.error}
   : {toolCallId,result:JSON.stringify(result)})});
 });
 return router;
}
