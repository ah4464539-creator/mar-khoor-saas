import express from 'express';
import crypto from 'node:crypto';
export function integrationRouter(){
 const router=express.Router();
 // Integration foundation only. Never treat inbound events as orders until authenticated and validated.
 router.post('/webhooks/vapi',express.raw({type:'application/json',limit:'256kb'}),(req,res)=>{
  const secret=process.env.VAPI_WEBHOOK_SECRET;
  if(!secret)return res.status(503).json({error:'Webhook not configured'});
  const provided=req.get('x-markhoor-webhook-secret')||'';
  const a=Buffer.from(provided),b=Buffer.from(secret);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Unauthorized'});
  let payload;
  try{payload=JSON.parse(req.body.toString('utf8'))}catch{return res.status(400).json({error:'Invalid JSON'})}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return res.status(400).json({error:'Invalid event'});
  // Intentionally acknowledge only; real Vapi event mapping and durable processing are pending.
  return res.status(202).json({received:true,processed:false});
 });
 // Meta WhatsApp Cloud API verification and signed event intake.
 router.get('/webhooks/whatsapp',(req,res)=>{
  const token=process.env.WHATSAPP_VERIFY_TOKEN;
  if(!token)return res.status(503).send('Not configured');
  if(req.query['hub.mode']!=='subscribe'||req.query['hub.verify_token']!==token||typeof req.query['hub.challenge']!=='string')return res.sendStatus(403);
  return res.status(200).type('text/plain').send(req.query['hub.challenge']);
 });
 router.post('/webhooks/whatsapp',express.raw({type:'application/json',limit:'256kb'}),(req,res)=>{
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
  // No customer messages are persisted or acted on until tenant routing is implemented.
  return res.status(202).json({received:true,processed:false});
 });
 return router;
}
