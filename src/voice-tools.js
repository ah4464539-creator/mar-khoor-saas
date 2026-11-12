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

 router.post('/assistants/:assistantId/orders',createVoiceOrderHandler(pool));
 return router;
}

export function createVoiceOrderHandler(pool){
 return async(req,res)=>{
  const assistantId=req.params.assistantId;
  const {call_id,customer_name,confirmed,items}=req.body||{};
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(assistantId)||typeof call_id!=='string'||!/^[-a-zA-Z0-9_:]{1,128}$/.test(call_id)||confirmed!==true||typeof customer_name!=='string'||!customer_name.trim()||customer_name.length>160||!Array.isArray(items)||items.length<1||items.length>30)return res.status(400).json({error:'Invalid confirmed order'});
  const quantities=new Map();
  for(const item of items){
   if(!Number.isSafeInteger(item?.menu_item_id)||item.menu_item_id<1||!Number.isSafeInteger(item?.quantity)||item.quantity<1||item.quantity>99)return res.status(400).json({error:'Invalid order item'});
   const next=(quantities.get(item.menu_item_id)||0)+item.quantity;
   if(next>99)return res.status(400).json({error:'Quantity limit exceeded'});
   quantities.set(item.menu_item_id,next);
  }
  let connection;
  try{
   connection=await pool.getConnection();
   await connection.beginTransaction();
   const [mapped]=await connection.execute('SELECT restaurant_id FROM voice_assistants WHERE assistant_id=? AND active=1 LIMIT 1',[assistantId]);
   if(!mapped.length){await connection.rollback();return res.status(404).json({error:'Assistant not mapped'});}
   const restaurantId=mapped[0].restaurant_id;
   const [claim]=await connection.execute('INSERT INTO voice_order_requests(assistant_id,call_id,restaurant_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[assistantId,call_id,restaurantId]);
   if(claim.affectedRows!==1){
    const [existing]=await connection.execute('SELECT order_id FROM voice_order_requests WHERE assistant_id=? AND call_id=?',[assistantId,call_id]);
    await connection.rollback();
    if(existing[0]?.order_id)return res.status(200).json({order_id:existing[0].order_id,status:'already_received'});
    return res.status(409).json({error:'Order already processing'});
   }
   const ids=[...quantities.keys()];
   const [menu]=await connection.query('SELECT id,name,price_minor FROM menu_items WHERE restaurant_id=? AND active=1 AND id IN ('+ids.map(()=>'?').join(',')+') FOR UPDATE',[restaurantId,...ids]);
   if(menu.length!==ids.length){await connection.rollback();return res.status(409).json({error:'Some menu items unavailable'});}
   let total=0;
   for(const item of menu){total+=Number(item.price_minor)*quantities.get(item.id);if(!Number.isSafeInteger(total)||total>1000000000){await connection.rollback();return res.status(400).json({error:'Order total exceeds limit'});}}
   const [order]=await connection.execute('INSERT INTO orders(restaurant_id,customer_name,total_minor) VALUES (?,?,?)',[restaurantId,customer_name.trim(),total]);
   for(const item of menu)await connection.execute('INSERT INTO order_items(order_id,menu_item_id,name_snapshot,quantity,unit_price_minor) VALUES (?,?,?,?,?)',[order.insertId,item.id,item.name,quantities.get(item.id),item.price_minor]);
   await connection.execute('UPDATE voice_order_requests SET order_id=? WHERE assistant_id=? AND call_id=?',[order.insertId,assistantId,call_id]);
   await connection.commit();
   res.status(201).json({order_id:order.insertId,status:'pending',total_minor:total});
  }catch{if(connection)await connection.rollback().catch(()=>{});res.status(503).json({error:'Voice order unavailable'});}
  finally{connection?.release();}
 };
}
