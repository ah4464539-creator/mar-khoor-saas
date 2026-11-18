import express from 'express';
import { newTrackingToken, hashTrackingToken, getOrderTracking } from './order-tracking.js';
import { validateFulfillment, isMissingFulfillmentSchema } from './order-fulfillment.js';
export function checkoutRouter(pool){
 const router=express.Router();
 // In production apply per-IP/restaurant rate limiting and abuse controls at the reverse proxy.
 router.post('/public/restaurants/:slug/orders',async(req,res)=>{
  const {customer_name,items,client_request_id=null}=req.body||{};
  // Optional fulfilment: legacy website checkouts without these details stay supported.
  const fulfillment=validateFulfillment(req.body||{});
  if(!fulfillment.ok)return res.status(400).json({error:fulfillment.error});
  // Stripe checkout is intentionally not exposed before a connected account, signed webhook,
  // and restaurant-level payment enablement are verified (see src/stripe-checkout.js).
  if(client_request_id!==null&&(typeof client_request_id!=='string'||!/^[0-9a-f-]{36}$/.test(client_request_id)))return res.status(400).json({error:'Invalid order request ID'});
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
   const [created]=await connection.execute('INSERT INTO orders (restaurant_id,customer_name,total_minor,client_request_id) VALUES (?,?,?,?)',[restaurantId,customer_name.trim(),total,client_request_id]);
   for(const item of menu)await connection.execute('INSERT INTO order_items (order_id,menu_item_id,name_snapshot,quantity,unit_price_minor) VALUES (?,?,?,?,?)',[created.insertId,item.id,item.name,quantities.get(item.id),item.price_minor]);
   if(fulfillment.present){const f=fulfillment.value;await connection.execute('INSERT INTO order_fulfillment (order_id,restaurant_id,order_type,customer_phone,delivery_address,delivery_instructions,payment_method,payment_status) VALUES (?,?,?,?,?,?,?,?)',
    [created.insertId,restaurantId,f.order_type,f.customer_phone,f.delivery_address,f.delivery_instructions,f.payment_method,f.payment_status]);}
   const trackingToken=newTrackingToken();
   await connection.execute('INSERT INTO order_tracking (order_id,token_hash) VALUES (?,?)',[created.insertId,hashTrackingToken(trackingToken)]);
   await connection.commit();
   const receipt={order_id:created.insertId,status:'pending',total_minor:total,tracking_token:trackingToken};
   if(fulfillment.present)Object.assign(receipt,{order_type:fulfillment.value.order_type,payment_method:fulfillment.value.payment_method,payment_status:'unpaid'});
   res.status(201).json(receipt);
  }catch(e){if(connection)await connection.rollback().catch(()=>{});if(e?.code==='ER_DUP_ENTRY'&&client_request_id)return res.status(409).json({error:'Order submission already attempted. Check your order history before retrying.'});if(isMissingFulfillmentSchema(e))console.error(JSON.stringify({event:'order_fulfillment_schema_missing'}));res.status(503).json({error:'Order service unavailable'});}
  finally{connection?.release();}
 });
 // The token is sent in a header so it stays out of URLs and logs.
 router.get('/public/orders/:orderId/status',async(req,res)=>{
  const result=await getOrderTracking(pool,Number(req.params.orderId),req.get('x-tracking-token'));
  res.set('Cache-Control','no-store');
  res.status(result.status).json(result.body);
 });
 return router;
}
