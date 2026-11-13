import express from 'express';
import { requireAuth } from './auth.js';
import {validPhone,validProviderId} from './voice-routing.js';
import {registerRegionalVoiceLine} from './voice-onboarding.js';
import {restaurantChat} from './restaurant-chat.js';
export function apiRouter(pool) {
 const router=express.Router();
 router.get('/platform/summary',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  try {
   const [[restaurants],[users],[orders]]=await Promise.all([
    pool.query('SELECT COUNT(*) AS count FROM restaurants'),
    pool.query('SELECT COUNT(*) AS count FROM users'),
    pool.query('SELECT COUNT(*) AS count FROM orders')
   ]);
   res.json({restaurants:restaurants[0].count,users:users[0].count,orders:orders[0].count});
  } catch {res.status(503).json({error:'Database unavailable'});}
 });
 router.get('/platform/whatsapp-ai/monitor',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  try{
   const [jobs]=await pool.execute("SELECT status,COUNT(*) AS count FROM whatsapp_ai_jobs GROUP BY status");
   const [stale]=await pool.execute("SELECT COUNT(*) AS count FROM whatsapp_ai_jobs WHERE status='processing' AND created_at<NOW()-INTERVAL 10 MINUTE");
   const [oldPending]=await pool.execute("SELECT COUNT(*) AS count FROM whatsapp_ai_jobs WHERE status='pending' AND created_at<NOW()-INTERVAL 5 MINUTE");
   const [outbound]=await pool.execute("SELECT status,COUNT(*) AS count FROM whatsapp_outbound_messages WHERE sent_at>=NOW()-INTERVAL 24 HOUR GROUP BY status");
   res.set('Cache-Control','no-store').json({jobs,stale_processing:Number(stale[0]?.count||0),delayed_pending:Number(oldPending[0]?.count||0),outbound_last_24h:outbound});
  }catch{res.status(503).json({error:'WhatsApp monitoring unavailable'});}
 });
 router.get('/platform/restaurants',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  try{const [rows]=await pool.query('SELECT r.id,r.name,r.slug,r.country_code,r.currency,r.locale,COUNT(m.user_id) AS members FROM restaurants r LEFT JOIN restaurant_members m ON m.restaurant_id=r.id GROUP BY r.id ORDER BY r.id DESC LIMIT 100');res.json({restaurants:rows});}
  catch{res.status(503).json({error:'Database unavailable'});}
 });
 router.post('/platform/restaurants',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  const {name,slug,country_code,currency,locale}=req.body??{};
  const valid=(value,pattern)=>typeof value==='string'&&pattern.test(value);
  if(!valid(name,/^.{1,160}$/u)||!name.trim()||!valid(slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/)||slug.length>160||
     !valid(country_code,/^[A-Z]{2}$/)||!valid(currency,/^[A-Z]{3}$/)||!valid(locale,/^[a-zA-Z0-9-]{2,20}$/)){
   return res.status(400).json({error:'Enter a name, URL slug, two-letter country, three-letter currency and locale.'});
  }
  try{
   if(!Intl.supportedValuesOf('currency').includes(currency)||!Intl.getCanonicalLocales(locale).length){
    return res.status(400).json({error:'Invalid currency or locale.'});
   }
  }catch{return res.status(400).json({error:'Invalid locale.'});}
  try{
   const [created]=await pool.execute('INSERT INTO restaurants(name,slug,country_code,currency,locale) VALUES (?,?,?,?,?)',[name.trim(),slug,country_code,currency,locale]);
   res.status(201).json({id:created.insertId,slug});
  }catch(error){
   if(error.code==='ER_DUP_ENTRY')return res.status(409).json({error:'This restaurant slug is already in use.'});
   res.status(503).json({error:'Restaurant could not be created.'});
  }
 });
 router.put('/platform/restaurants/:id/public-phone',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  const id=Number(req.params.id);
  const phone=req.body?.phone;
  if(!Number.isSafeInteger(id)||id<1||typeof phone!=='string'||(phone!==''&&!/^\+[1-9][0-9]{6,14}$/.test(phone))){
   return res.status(400).json({error:'Enter a restaurant ID and a phone in international format, or leave phone blank to remove it.'});
  }
  try{
   if(!phone){await pool.execute('DELETE FROM restaurant_public_phones WHERE restaurant_id=?',[id]);return res.json({phone:null});}
   await pool.execute('INSERT INTO restaurant_public_phones(restaurant_id,phone) VALUES (?,?) ON DUPLICATE KEY UPDATE phone=IF(restaurant_id=VALUES(restaurant_id),VALUES(phone),phone)',[id,phone]);
   const [rows]=await pool.execute('SELECT phone FROM restaurant_public_phones WHERE restaurant_id=?',[id]);
   if(rows[0]?.phone!==phone)return res.status(409).json({error:'This number belongs to another restaurant.'});
   res.json({phone});
  }catch(error){
   if(error.code==='ER_DUP_ENTRY')return res.status(409).json({error:'This number belongs to another restaurant.'});
   if(error.code==='ER_NO_REFERENCED_ROW_2')return res.status(404).json({error:'Restaurant not found.'});
   res.status(503).json({error:'Phone settings unavailable.'});
  }
 });
 router.put('/platform/restaurants/:id/voice-transfer',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  const id=Number(req.params.id);
  const {phone_number_id,staff_phone}=req.body??{};
  if(!Number.isSafeInteger(id)||id<1||!validProviderId(phone_number_id)||!validPhone(staff_phone)){
   return res.status(400).json({error:'Enter the restaurant ID, Vapi phone number ID and staff phone in international format.'});
  }
  try{
   const [phones]=await pool.execute('SELECT restaurant_id,phone FROM restaurant_public_phones WHERE restaurant_id=? OR phone=?',[id,staff_phone]);
   if(phones.some(line=>line.phone===staff_phone))return res.status(409).json({error:'Use a staff number separate from the public ordering numbers.'});
   const aiPhone=phones.find(line=>String(line.restaurant_id)===String(id))?.phone;
   if(!aiPhone)return res.status(409).json({error:'Save the dedicated storefront number first.'});
   await pool.execute(
    `INSERT INTO restaurant_voice_routes (restaurant_id,phone_number_id,ai_phone,staff_phone) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE phone_number_id=IF(restaurant_id=VALUES(restaurant_id),VALUES(phone_number_id),phone_number_id),
     ai_phone=IF(restaurant_id=VALUES(restaurant_id),VALUES(ai_phone),ai_phone),
     staff_phone=IF(restaurant_id=VALUES(restaurant_id),VALUES(staff_phone),staff_phone)`,[id,phone_number_id,aiPhone,staff_phone]);
   const [saved]=await pool.execute('SELECT phone_number_id FROM restaurant_voice_routes WHERE restaurant_id=?',[id]);
   if(saved[0]?.phone_number_id!==phone_number_id)return res.status(409).json({error:'That Vapi number is already assigned to another restaurant.'});
   res.json({configured:true});
  }catch(error){
   if(error.code==='ER_DUP_ENTRY')return res.status(409).json({error:'That Vapi number is already assigned to another restaurant.'});
   res.status(503).json({error:'Voice transfer settings unavailable.'});
  }
 });
 router.post('/platform/regional-voice-lines',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  const {country_code,phone_number_id}=req.body??{};
  if(typeof country_code!=='string'||!/^[A-Z]{2}$/.test(country_code)||!validProviderId(phone_number_id)){
   return res.status(400).json({error:'Enter a two-letter country code and a Vapi phone number ID.'});
  }
  const key=process.env.VAPI_PRIVATE_KEY;
  if(!key)return res.status(503).json({error:'Vapi inventory credentials are missing.'});
  try{
   const line=await registerRegionalVoiceLine(pool,{country_code,phone_number_id},key);
   if(!line)return res.status(422).json({error:'Vapi must show an active number with a dedicated assistant.'});
   res.status(201).json(line);
  }catch(error){
   if(error.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Number or assistant is already registered or assigned.'});
   res.status(503).json({error:'Voice inventory unavailable.'});
  }
 });
 router.get('/platform/voice-assistants',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  try{
   const [rows]=await pool.query('SELECT v.assistant_id,v.restaurant_id,r.name AS restaurant_name,v.active FROM voice_assistants v JOIN restaurants r ON r.id=v.restaurant_id ORDER BY v.created_at DESC LIMIT 200');
   res.json({assistants:rows});
  }catch{res.status(503).json({error:'Database unavailable'});}
 });
 router.put('/platform/voice-assistants/:assistantId',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  const assistantId=req.params.assistantId,restaurantId=req.body?.restaurant_id,active=req.body?.active;
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(assistantId)||!Number.isSafeInteger(restaurantId)||restaurantId<1||typeof active!=='boolean')return res.status(400).json({error:'Invalid mapping'});
  try{
   const [restaurants]=await pool.execute('SELECT id FROM restaurants WHERE id=? LIMIT 1',[restaurantId]);
   if(!restaurants.length)return res.status(404).json({error:'Restaurant not found'});
   await pool.execute('INSERT INTO voice_assistants(assistant_id,restaurant_id,active) VALUES (?,?,?) ON DUPLICATE KEY UPDATE restaurant_id=VALUES(restaurant_id),active=VALUES(active)',[assistantId,restaurantId,active]);
   res.json({assistant_id:assistantId,restaurant_id:restaurantId,active});
  }catch{res.status(503).json({error:'Mapping unavailable'});}
 });
 router.put('/platform/whatsapp-numbers/:phoneId',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  const phoneId=req.params.phoneId,restaurantId=req.body?.restaurant_id,active=req.body?.active;
  if(!/^[0-9]{1,64}$/.test(phoneId)||!Number.isSafeInteger(restaurantId)||restaurantId<1||typeof active!=='boolean')return res.status(400).json({error:'Invalid mapping'});
  try{
   const [restaurants]=await pool.execute('SELECT id FROM restaurants WHERE id=? LIMIT 1',[restaurantId]);
   if(!restaurants.length)return res.status(404).json({error:'Restaurant not found'});
   await pool.execute('INSERT INTO whatsapp_numbers(phone_number_id,restaurant_id,active) VALUES (?,?,?) ON DUPLICATE KEY UPDATE active=IF(restaurant_id=VALUES(restaurant_id),VALUES(active),active)',[phoneId,restaurantId,active]);
   const [mapped]=await pool.execute('SELECT restaurant_id FROM whatsapp_numbers WHERE phone_number_id=?',[phoneId]);
   if(String(mapped[0]?.restaurant_id)!==String(restaurantId))return res.status(409).json({error:'This WhatsApp number belongs to another restaurant.'});
   res.json({phone_number_id:phoneId,restaurant_id:restaurantId,active});
  }catch{res.status(503).json({error:'Mapping unavailable'});}
 });
 router.get('/platform/whatsapp-numbers',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  try{const [rows]=await pool.query('SELECT w.phone_number_id,w.restaurant_id,r.name AS restaurant_name,w.active FROM whatsapp_numbers w JOIN restaurants r ON r.id=w.restaurant_id ORDER BY w.phone_number_id LIMIT 200');res.json({numbers:rows});}
  catch{res.status(503).json({error:'Mapping unavailable'});}
 });
 router.get('/my/restaurants',requireAuth,async(req,res)=>{
  try {
   const [rows]=await pool.execute('SELECT r.id,r.name,r.slug,r.currency,r.locale,m.role FROM restaurant_members m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.user_id=? ORDER BY r.name',[req.user.id]);
   res.json({restaurants:rows});
  } catch {res.status(503).json({error:'Database unavailable'});}
 });
 const chatRequests=new Map();
 let chatWindowEnds=0, chatTotal=0;
 router.post('/public/restaurants/:slug/chat',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const key=process.env.OPENAI_API_KEY;
  if(process.env.WEB_CHAT_ENABLED!=='true'||!key)return res.status(503).json({error:'Chat is unavailable. You can still browse the menu and order.'});
  const message=req.body?.message;
  if(typeof message!=='string'||!message.trim()||message.length>500||!/^[-a-z0-9]{1,160}$/.test(req.params.slug)){
   return res.status(400).json({error:'Enter a question of up to 500 characters.'});
  }
  const now=Date.now();
  if(now>=chatWindowEnds){chatRequests.clear();chatTotal=0;chatWindowEnds=now+60000;}
  const count=chatRequests.get(req.ip)??0;
  if(count>=6||chatTotal>=60)return res.status(429).json({error:'Chat is busy. Try again in a minute.'});
  chatRequests.set(req.ip,count+1);
  chatTotal++;
  try{
   const [rows]=await pool.execute('SELECT id,name,locale,currency FROM restaurants WHERE slug=? LIMIT 1',[req.params.slug]);
   if(!rows.length)return res.status(404).json({error:'Restaurant not found.'});
   res.json(await restaurantChat(pool,rows[0],message.trim(),{key}));
  }catch{
   res.status(503).json({error:'Chat is temporarily unavailable. You can still order from the menu.'});
  }
 });
 router.get('/public/restaurants/:slug/menu',async(req,res)=>{
  if(!/^[a-z0-9-]{1,160}$/.test(req.params.slug))return res.status(400).json({error:'Invalid slug'});
  try {
   const [restaurants]=await pool.execute('SELECT r.id,r.name,r.slug,r.country_code,r.currency,r.locale,p.phone FROM restaurants r LEFT JOIN restaurant_public_phones p ON p.restaurant_id=r.id WHERE r.slug=? LIMIT 1',[req.params.slug]);
   if(!restaurants.length)return res.status(404).json({error:'Restaurant not found'});
   const restaurant=restaurants[0];
   const [items]=await pool.execute('SELECT id,name,description,price_minor FROM menu_items WHERE restaurant_id=? AND active=1 ORDER BY id',[restaurant.id]);
   res.json({restaurant,items,chat_enabled:process.env.WEB_CHAT_ENABLED==='true'&&Boolean(process.env.OPENAI_API_KEY)});
  } catch {res.status(503).json({error:'Database unavailable'});}
 });
 return router;
}
