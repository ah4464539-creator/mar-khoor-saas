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
 return router;
}
