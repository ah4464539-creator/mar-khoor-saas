import express from 'express';
import crypto from 'node:crypto';

function authorized(req){
 const secret=process.env.VAPI_TOOL_SECRET;
 const token=req.get('x-markhoor-tool-secret')||'';
 if(!secret||!token)return false;
 const a=Buffer.from(token),b=Buffer.from(secret);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
export function voiceToolsRouter(pool){
 const router=express.Router();
 router.use((req,res,next)=>{
  if(!process.env.VAPI_TOOL_SECRET)return res.status(503).json({error:'Voice tools not configured'});
  if(!authorized(req))return res.status(401).json({error:'Unauthorized'});
  next();
 });
 // The restaurant identity comes from the server-side assistant mapping, not from a caller.
 router.get('/assistants/:assistantId/menu',async(req,res)=>{
  const assistantId=req.params.assistantId;
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(assistantId))return res.status(400).json({error:'Invalid assistant'});
  try{
   const [restaurants]=await pool.execute('SELECT r.id,r.name,r.currency,r.locale FROM voice_assistants v JOIN restaurants r ON r.id=v.restaurant_id WHERE v.assistant_id=? AND v.active=1 LIMIT 1',[assistantId]);
   if(!restaurants.length)return res.status(404).json({error:'Assistant not mapped'});
   const restaurant=restaurants[0];
   const [items]=await pool.execute('SELECT id,name,description,price_minor FROM menu_items WHERE restaurant_id=? AND active=1 ORDER BY id',[restaurant.id]);
   res.json({restaurant:{name:restaurant.name,currency:restaurant.currency,locale:restaurant.locale},items});
  }catch{res.status(503).json({error:'Voice menu unavailable'});}
 });
 return router;
}
