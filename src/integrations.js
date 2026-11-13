import express from 'express';
import crypto from 'node:crypto';
import {parseVapiEvent,processVapiEvent} from './vapi-events.js';
export function integrationRouter(pool){
 const router=express.Router();
 // Integration foundation only. Never treat inbound events as orders until authenticated and validated.
 router.post('/webhooks/vapi',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{
  const secret=process.env.VAPI_WEBHOOK_SECRET;
  if(!secret)return res.status(503).json({error:'Webhook not configured'});
  // Vapi custom credentials can send the secret as a Bearer token, in X-Vapi-Secret, or in a custom header.
  const provided=req.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]||req.get('x-vapi-secret')||req.get('x-markhoor-webhook-secret')||'';
  const a=Buffer.from(provided),b=Buffer.from(secret);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Unauthorized'});
  let payload;
  try{payload=JSON.parse(req.body.toString('utf8'))}catch{return res.status(400).json({error:'Invalid JSON'})}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return res.status(400).json({error:'Invalid event'});
  // Only call lifecycle events (status-update, end-of-call-report) are stored. Everything else is acknowledged and ignored.
  if(parseVapiEvent(payload).kind==='ignored')return res.status(202).json({received:true,processed:false});
  if(!pool)return res.status(503).json({error:'Call storage unavailable'});
  try{
   const result=await processVapiEvent(pool,payload);
   return res.status(202).json({received:true,processed:result.processed});
  }catch{return res.status(503).json({error:'Call storage unavailable'});}
 });
 // Meta WhatsApp Cloud API verification and signed event intake.
 router.get('/webhooks/whatsapp',(req,res)=>{
  const token=process.env.WHATSAPP_VERIFY_TOKEN;
  if(!token)return res.status(503).send('Not configured');
  if(req.query['hub.mode']!=='subscribe'||req.query['hub.verify_token']!==token||typeof req.query['hub.challenge']!=='string')return res.sendStatus(403);
  return res.status(200).type('text/plain').send(req.query['hub.challenge']);
 });
 router.post('/webhooks/whatsapp',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{
  const secret=process.env.META_APP_SECRET;
  if(!secret)return res.status(503).json({error:'Not configured'});
  if(!Buffer.isBuffer(req.body))return res.status(400).json({error:'Invalid body'});
  const signature=req.get('x-hub-signature-256')||'';
  if(!/^sha256=[a-f0-9]{64}$/.test(signature))return res.sendStatus(401);
  const expected='sha256='+crypto.createHmac('sha256',secret).update(req.body).digest('hex');
  if(!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.sendStatus(401);
  let payload;
  try{payload=JSON.parse(req.body.toString('utf8'))}catch{return res.status(400).json({error:'Invalid JSON'})}
  if(payload?.object!=='whatsapp_business_account'||!Array.isArray(payload.entry))return res.status(400).json({error:'Invalid WhatsApp event'});
  const messages=[],statuses=[];
  for(const entry of payload.entry){
   if(!Array.isArray(entry?.changes))continue;
   for(const change of entry.changes){
    if(change?.field!=='messages')continue;
    const phoneId=change.value?.metadata?.phone_number_id;
    if(Array.isArray(change.value?.statuses)){
     for(const event of change.value.statuses){
      if(typeof phoneId==='string'&&/^[0-9]{1,64}$/.test(phoneId)&&typeof event?.id==='string'&&event.id.length<=255&&/^wamid[.]/.test(event.id)&&['sent','delivered','read','failed'].includes(event.status)){
       statuses.push({phoneId,id:event.id,status:event.status});
      }
     }
    }
    if(!Array.isArray(change.value?.messages))continue;
    for(const msg of change.value.messages){
     if(typeof phoneId!=='string'||!/^[0-9]{1,64}$/.test(phoneId)||typeof msg?.id!=='string'||msg.id.length>255||!/^wamid[.]/.test(msg.id)||typeof msg.from!=='string'||!/^[0-9]{5,20}$/.test(msg.from))continue;
     const type=typeof msg.type==='string'?msg.type.slice(0,32):'unknown';
     const body=type==='text'&&typeof msg.text?.body==='string'?msg.text.body.slice(0,10000):null;
     messages.push({phoneId,id:msg.id,from:msg.from,type,body});
    }
   }
  }
  if(!messages.length&&!statuses.length)return res.status(202).json({received:true,processed:0});
  if(!pool)return res.status(503).json({error:'Message storage unavailable'});
  try{
   let processed=0;
   for(const msg of messages){
    const [mapped]=await pool.execute('SELECT restaurant_id FROM whatsapp_numbers WHERE phone_number_id=? AND active=1 LIMIT 1',[msg.phoneId]);
    if(!mapped.length)continue;
    const [result]=await pool.execute('INSERT IGNORE INTO whatsapp_inbound_messages(message_id,restaurant_id,phone_number_id,sender,message_type,text_body) VALUES (?,?,?,?,?,?)',[msg.id,mapped[0].restaurant_id,msg.phoneId,msg.from,msg.type,msg.body]);
    processed+=result.affectedRows;
    if(msg.type==='text'&&msg.body?.trim()){
     await pool.execute("INSERT INTO whatsapp_ai_jobs(inbound_message_id,restaurant_id) SELECT m.message_id,m.restaurant_id FROM whatsapp_inbound_messages m JOIN whatsapp_ai_settings s ON s.restaurant_id=m.restaurant_id AND s.enabled=1 WHERE m.message_id=? AND m.restaurant_id=? AND m.phone_number_id=? ON DUPLICATE KEY UPDATE inbound_message_id=inbound_message_id",[msg.id,mapped[0].restaurant_id,msg.phoneId]);
    }
   }
   let updated_statuses=0;
   for(const event of statuses){
    const [result]=await pool.execute(
     "UPDATE whatsapp_outbound_messages o JOIN whatsapp_numbers w ON w.phone_number_id=o.phone_number_id AND w.restaurant_id=o.restaurant_id AND w.active=1 SET o.status=?,o.status_at=NOW() WHERE o.message_id=? AND o.phone_number_id=? AND (o.status='accepted' OR (o.status='sent' AND ? IN ('delivered','read','failed')) OR (o.status='delivered' AND ?='read'))",
     [event.status,event.id,event.phoneId,event.status,event.status]
    );
    updated_statuses+=result.affectedRows;
   }
   return res.status(202).json({received:true,processed,updated_statuses});
  }catch{return res.status(503).json({error:'Message storage unavailable'});}

 });
 return router;
}
