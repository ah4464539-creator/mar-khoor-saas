import express from 'express';
import { requireAuth } from './auth.js';
import { addWebsiteSettingsRoutes } from './restaurant-website.js';
export function operationsRouter(pool) {
 const router=express.Router();
 const access=async(req,res,next)=>{
  const id=Number(req.params.restaurantId);
  if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid restaurant'});
  try {
   if(req.user.platformRole==='super_admin'){req.restaurantId=id;return next();}
   const [rows]=await pool.execute("SELECT role FROM restaurant_members WHERE restaurant_id=? AND user_id=? AND role='admin' LIMIT 1",[id,req.user.id]);
   if(!rows.length)return res.status(403).json({error:'Forbidden'});
   req.restaurantId=id;next();
  }catch{res.status(503).json({error:'Database unavailable'});}
 };
 router.use('/restaurants/:restaurantId',requireAuth,access);
 addWebsiteSettingsRoutes(router, pool);
 const setupServices = ['website', 'voice', 'menu'];
 router.get('/restaurants/:restaurantId/setup', async (req,res,next) => {
  try {
   const [rows] = await pool.execute('SELECT selected_services,skipped FROM restaurant_setup WHERE restaurant_id=?',[req.restaurantId]);
   const row = rows[0];
   res.json({ saved: Boolean(row), services: row ? JSON.parse(row.selected_services) : [], skipped: Boolean(row?.skipped) });
  } catch(error) { next(error); }
 });
 router.put('/restaurants/:restaurantId/setup', async (req,res,next) => {
  const { services, skipped } = req.body ?? {};
  if (!Array.isArray(services) || services.length > setupServices.length ||
      services.some(service => !setupServices.includes(service)) || typeof skipped !== 'boolean') {
   return res.status(400).json({ error: 'Invalid setup options' });
  }
  try {
   await pool.execute('INSERT INTO restaurant_setup (restaurant_id,selected_services,skipped) VALUES (?,?,?) ON DUPLICATE KEY UPDATE selected_services=VALUES(selected_services),skipped=VALUES(skipped)',
    [req.restaurantId,JSON.stringify([...new Set(services)]),skipped]);
   res.json({ saved: true });
  } catch(error) { next(error); }
 });
 router.get('/restaurants/:restaurantId/menu',async(req,res)=>{
  try{const [items]=await pool.execute('SELECT id,name,description,price_minor,active FROM menu_items WHERE restaurant_id=? ORDER BY id DESC',[req.restaurantId]);res.json({items});}
  catch{res.status(503).json({error:'Database unavailable'});}
 });
 router.post('/restaurants/:restaurantId/menu',async(req,res)=>{
  const {name,description='',price_minor}=req.body||{};
  if(typeof name!=='string'||!name.trim()||name.length>180||typeof description!=='string'||description.length>10000||!Number.isSafeInteger(price_minor)||price_minor<0)return res.status(400).json({error:'Invalid menu item'});
  try{const [result]=await pool.execute('INSERT INTO menu_items (restaurant_id,name,description,price_minor) VALUES (?,?,?,?)',[req.restaurantId,name.trim(),description,price_minor]);res.status(201).json({id:result.insertId});}
  catch{res.status(503).json({error:'Database unavailable'});}
 });
 router.patch('/restaurants/:restaurantId/menu/:itemId',async(req,res)=>{
  const id=Number(req.params.itemId),{name,description,price_minor,active}=req.body||{};
  if(!Number.isSafeInteger(id)||id<1||typeof name!=='string'||!name.trim()||name.length>180||typeof description!=='string'||description.length>10000||!Number.isSafeInteger(price_minor)||price_minor<0||typeof active!=='boolean')return res.status(400).json({error:'Invalid item'});
  try{const [result]=await pool.execute('UPDATE menu_items SET name=?,description=?,price_minor=?,active=? WHERE id=? AND restaurant_id=?',[name.trim(),description,price_minor,active,id,req.restaurantId]);if(!result.affectedRows)return res.status(404).json({error:'Item not found'});res.json({updated:true});}
  catch{res.status(503).json({error:'Database unavailable'});}
 });
 router.get('/restaurants/:restaurantId/whatsapp/messages',async(req,res)=>{
  const before=req.query.before===undefined?null:Number(req.query.before);
  if(before!==null&&(!Number.isSafeInteger(before)||before<1))return res.status(400).json({error:'Invalid cursor'});
  try{
   const sql='SELECT id,message_id,phone_number_id,sender,message_type,text_body,received_at FROM whatsapp_inbound_messages WHERE restaurant_id=?'+(before===null?'':' AND id<?')+' ORDER BY id DESC LIMIT 50';
   const args=before===null?[req.restaurantId]:[req.restaurantId,before];
   const [messages]=await pool.execute(sql,args);
   res.json({messages,next_cursor:messages.length===50?messages[messages.length-1].id:null});
  }catch{res.status(503).json({error:'WhatsApp inbox unavailable'});}
 });
 router.get('/restaurants/:restaurantId/voice-calls',async(req,res)=>{
  const before=req.query.before===undefined?null:Number(req.query.before);
  if(before!==null&&(!Number.isSafeInteger(before)||before<1))return res.status(400).json({error:'Invalid cursor'});
  try{
   const sql='SELECT c.id,c.call_id,c.status,c.ended_reason,c.started_at,c.ended_at,r.order_id FROM voice_calls c LEFT JOIN voice_order_requests r ON r.assistant_id=c.assistant_id AND r.call_id=c.call_id WHERE c.restaurant_id=?'+(before===null?'':' AND c.id<?')+' ORDER BY c.id DESC LIMIT 50';
   const args=before===null?[req.restaurantId]:[req.restaurantId,before];
   const [calls]=await pool.execute(sql,args);
   res.json({calls,next_cursor:calls.length===50?calls[calls.length-1].id:null});
  }catch{res.status(503).json({error:'Call history unavailable'});}
 });
 router.get('/restaurants/:restaurantId/voice-calls/:callRowId',async(req,res)=>{
  const id=Number(req.params.callRowId);
  if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid call'});
  try{
   const [rows]=await pool.execute('SELECT c.id,c.call_id,c.status,c.ended_reason,c.transcript,c.started_at,c.ended_at,r.order_id FROM voice_calls c LEFT JOIN voice_order_requests r ON r.assistant_id=c.assistant_id AND r.call_id=c.call_id WHERE c.id=? AND c.restaurant_id=? LIMIT 1',[id,req.restaurantId]);
   if(!rows.length)return res.status(404).json({error:'Call not found'});
   res.json({call:rows[0]});
  }catch{res.status(503).json({error:'Call history unavailable'});}
 });
 router.get('/restaurants/:restaurantId/whatsapp/ai-settings',async(req,res)=>{
  try{const [rows]=await pool.execute('SELECT enabled FROM whatsapp_ai_settings WHERE restaurant_id=?',[req.restaurantId]);res.json({enabled:Boolean(rows[0]?.enabled)});}
  catch{res.status(503).json({error:'AI settings unavailable'});}
 });
 router.put('/restaurants/:restaurantId/whatsapp/ai-settings',async(req,res)=>{
  if(typeof req.body?.enabled!=='boolean')return res.status(400).json({error:'Invalid setting'});
  try{await pool.execute('INSERT INTO whatsapp_ai_settings(restaurant_id,enabled) VALUES (?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)',[req.restaurantId,req.body.enabled]);res.json({enabled:req.body.enabled});}
  catch{res.status(503).json({error:'AI settings unavailable'});}
 });
 router.get('/restaurants/:restaurantId/whatsapp/outbound',async(req,res)=>{
  try{
   const [messages]=await pool.execute('SELECT id,message_id,recipient,text_body,status,sent_at,status_at FROM whatsapp_outbound_messages WHERE restaurant_id=? ORDER BY id DESC LIMIT 50',[req.restaurantId]);
   res.json({messages});
  }catch{res.status(503).json({error:'Outgoing history unavailable'});}
 });
 router.post('/restaurants/:restaurantId/whatsapp/replies',async(req,res)=>{
  const messageId=req.body?.message_id,text=req.body?.text;
  if(typeof messageId!=='string'||messageId.length>255||!/^wamid[.]/.test(messageId)||typeof text!=='string'||!text.trim()||text.length>4096)return res.status(400).json({error:'Invalid reply'});
  const token=process.env.WHATSAPP_ACCESS_TOKEN;
  const version=process.env.WHATSAPP_GRAPH_VERSION||'v23.0';
  if(!token||!/^v[0-9]{1,2}[.][0-9]{1,2}$/.test(version))return res.status(503).json({error:'WhatsApp sending not configured'});
  try{
   const [rows]=await pool.execute("SELECT m.phone_number_id,m.sender FROM whatsapp_inbound_messages m JOIN whatsapp_numbers w ON w.phone_number_id=m.phone_number_id AND w.restaurant_id=m.restaurant_id AND w.active=1 WHERE m.message_id=? AND m.restaurant_id=? AND m.received_at>=NOW()-INTERVAL 24 HOUR AND m.message_type='text' LIMIT 1",[messageId,req.restaurantId]);
   if(!rows.length)return res.status(409).json({error:'No eligible recent inbound message'});
   const {phone_number_id:phoneId,sender}=rows[0];
   if(!/^[0-9]{1,64}$/.test(phoneId)||!/^[0-9]{5,20}$/.test(sender))return res.status(409).json({error:'Invalid recipient'});
   const response=await fetch('https://graph.facebook.com/'+version+'/'+phoneId+'/messages',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:sender,type:'text',text:{body:text.trim()}}),
    signal:AbortSignal.timeout(10000)
   });
   if(!response.ok)return res.status(502).json({error:'WhatsApp provider rejected message'});
   const data=await response.json();
   const outboundId=data?.messages?.[0]?.id;
   if(typeof outboundId!=='string')return res.status(502).json({error:'WhatsApp response missing message ID'});
   try{
    await pool.execute('INSERT INTO whatsapp_outbound_messages(message_id,restaurant_id,phone_number_id,recipient,text_body) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE message_id=message_id',[outboundId,req.restaurantId,phoneId,sender,text.trim()]);
   }catch{return res.status(503).json({sent:true,message_id:outboundId,history_saved:false});}
   return res.status(200).json({sent:true,message_id:outboundId,history_saved:true});
  }catch{return res.status(503).json({error:'WhatsApp sending unavailable'});}
 });
 router.get('/restaurants/:restaurantId/analytics',async(req,res)=>{
  try{
   const [counts]=await pool.execute("SELECT COUNT(*) AS total_orders,COALESCE(SUM(CASE WHEN status='completed' THEN total_minor ELSE 0 END),0) AS completed_revenue_minor,COUNT(CASE WHEN status='pending' THEN 1 END) AS pending_orders,COUNT(CASE WHEN status='completed' THEN 1 END) AS completed_orders FROM orders WHERE restaurant_id=?",[req.restaurantId]);
   const [recent]=await pool.execute("SELECT DATE(created_at) AS day,COUNT(*) AS orders,COALESCE(SUM(CASE WHEN status='completed' THEN total_minor ELSE 0 END),0) AS completed_revenue_minor FROM orders WHERE restaurant_id=? AND created_at>=CURRENT_DATE - INTERVAL 29 DAY GROUP BY DATE(created_at) ORDER BY day DESC",[req.restaurantId]);
   res.json({summary:counts[0],last_30_days:recent});
  }catch{res.status(503).json({error:'Analytics unavailable'});}
 });
 router.get('/restaurants/:restaurantId/orders',async(req,res)=>{
  try{const [orders]=await pool.execute('SELECT id,customer_name,status,total_minor,created_at FROM orders WHERE restaurant_id=? ORDER BY id DESC LIMIT 100',[req.restaurantId]);res.json({orders});}
  catch{res.status(503).json({error:'Database unavailable'});}
 });
 router.patch('/restaurants/:restaurantId/orders/:orderId/status',async(req,res)=>{
  const id=Number(req.params.orderId),status=req.body?.status;
  if(!Number.isSafeInteger(id)||id<1||!['accepted','preparing','ready','completed','cancelled'].includes(status))return res.status(400).json({error:'Invalid status'});
  const allowed={accepted:['pending'],preparing:['accepted'],ready:['preparing'],completed:['ready'],cancelled:['pending','accepted']};
  try{const [result]=await pool.query('UPDATE orders SET status=? WHERE id=? AND restaurant_id=? AND status IN (?)',[status,id,req.restaurantId,allowed[status]]);if(!result.affectedRows)return res.status(409).json({error:'Order missing or invalid status transition'});res.json({updated:true});}
  catch{res.status(503).json({error:'Database unavailable'});}
 });
 return router;
}
