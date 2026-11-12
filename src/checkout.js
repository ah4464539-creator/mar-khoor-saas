import express from 'express';
import crypto from 'node:crypto';
export function checkoutRouter(pool){
 const router=express.Router();
 // In production apply per-IP/restaurant rate limiting and abuse controls at the reverse proxy.
 router.post('/public/restaurants/:slug/orders',async(req,res)=>{
  const {customer_name,items}=req.body||{};
  if(!/^[a-z0-9-]{1,160}$/.test(req.params.slug)||typeof customer_name!=='string'||!customer_name.trim()||customer_name.length>160||!Array.isArray(items)||items.length<1||items.length>30)return res.status(400).json({error:'Invalid order'});
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
   const [restaurants]=await connection.execute('SELECT id FROM restaurants WHERE slug=? LIMIT 1',[req.params.slug]);
   if(!restaurants.length){await connection.rollback();return res.status(404).json({error:'Restaurant not found'});}
   const restaurantId=restaurants[0].id;
   const ids=[...quantities.keys()];
   const placeholders=ids.map(()=>'?').join(',');
   const [menu]=await connection.query(`SELECT id,name,price_minor FROM menu_items WHERE restaurant_id=? AND active=1 AND id IN (${placeholders}) FOR UPDATE`,[restaurantId,...ids]);
   if(menu.length!==ids.length){await connection.rollback();return res.status(409).json({error:'Some menu items are unavailable'});}
   let total=0;
   for(const item of menu){total+=Number(item.price_minor)*quantities.get(item.id);if(!Number.isSafeInteger(total)||total>1000000000){await connection.rollback();return res.status(400).json({error:'Order total exceeds limit'});}}
   const [created]=await connection.execute('INSERT INTO orders (restaurant_id,customer_name,total_minor) VALUES (?,?,?)',[restaurantId,customer_name.trim(),total]);
   for(const item of menu)await connection.execute('INSERT INTO order_items (order_id,menu_item_id,name_snapshot,quantity,unit_price_minor) VALUES (?,?,?,?,?)',[created.insertId,item.id,item.name,quantities.get(item.id),item.price_minor]);
   await connection.commit();
   res.status(201).json({order_id:created.insertId,status:'pending',total_minor:total});
  }catch(e){if(connection)await connection.rollback().catch(()=>{});res.status(503).json({error:'Order service unavailable'});}
  finally{connection?.release();}
 });
 return router;
}
