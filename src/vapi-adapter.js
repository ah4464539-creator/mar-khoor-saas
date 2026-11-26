import express from 'express';
import crypto from 'node:crypto';
import { runVapiToolCalls } from './vapi-tool-runner.js';

// Dedicated URL for Vapi tool calls (function tools). The same tools are also answered by the main
// Vapi webhook (`tool-calls` messages on /integrations/webhooks/vapi); see src/vapi-tool-runner.js.
export function vapiToolAdapterRouter(pool){
 const router=express.Router();
 router.post('/tools',express.json({limit:'128kb'}),async(req,res)=>{
  const secret=process.env.VAPI_TOOL_SECRET;
  const provided=req.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]??req.get('x-markhoor-tool-secret')??'';
  if(!secret)return res.status(503).json({error:'Not configured'});
  const a=Buffer.from(provided),b=Buffer.from(secret);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Unauthorized'});
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({error:'Invalid request'});
  const outcome=await runVapiToolCalls(pool,req.body.message);
  res.status(outcome.status).json(outcome.body);
 });
 return router;
}
