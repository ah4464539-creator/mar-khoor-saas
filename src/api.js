import { trackSiteEvent } from './site-analytics.js';
import { getPilotIds, setPilot } from './whatsapp-pilot.js';
import { getSignupConfig, saveSignupConfig } from './whatsapp-signup-core.js';
import express from 'express';
import { requireAuth } from './auth.js';
import { audit } from './security.js';
import { deletePreview, deleteRestaurant } from './restaurant-delete.js';
import { loadPaymentSettings, publicPaymentOptions } from './payment-options.js';
// The real phone number and business name behind each Meta phone_number_id (read-only Graph call).
async function withDisplayNumbers(rows,{env=process.env,fetcher=fetch}={}){
 const token=env.WHATSAPP_ACCESS_TOKEN,version=/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION||'')?env.WHATSAPP_GRAPH_VERSION:'v23.0';
 return Promise.all(rows.map(async row=>{
  if(!token||!/^[0-9]{1,64}$/.test(String(row.phone_number_id)))return {...row,display_phone_number:null,verified_name:null,quality_rating:null};
  try{
   const r=await fetcher('https://graph.facebook.com/'+version+'/'+row.phone_number_id+'?fields=display_phone_number,verified_name,quality_rating,code_verification_status',{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(6000)});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)return {...row,display_phone_number:null,verified_name:null,quality_rating:null,lookup_error:String(d?.error?.message||('Meta '+r.status)).slice(0,160)};
   return {...row,display_phone_number:d.display_phone_number||null,verified_name:d.verified_name||null,quality_rating:d.quality_rating||null};
  }catch{return {...row,display_phone_number:null,verified_name:null,quality_rating:null,lookup_error:'Meta lookup failed'};}
 }));
}
export { withDisplayNumbers };
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
 // Permanently delete a restaurant (demo accounts). Preview first; confirm by typing its name.
 const protectedSlugs=()=>String(process.env.PROTECTED_RESTAURANT_SLUGS??'urban-cafe').split(',').map(s=>s.trim()).filter(Boolean);
 router.get('/platform/restaurants/:id/delete-preview',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid restaurant'});
  try{const preview=await deletePreview(pool,id);if(!preview)return res.status(404).json({error:'Restaurant not found'});
   if(protectedSlugs().includes(preview.restaurant.slug))preview.blockers.push('This restaurant is protected (demo website).');
   res.set('Cache-Control','no-store').json(preview);}
  catch{res.status(503).json({error:'Database unavailable'});}
 });
 router.delete('/platform/restaurants/:id',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  const id=Number(req.params.id);
  try{
   const result=await deleteRestaurant(pool,id,{confirmName:req.body?.confirm_name,protectedSlugs:protectedSlugs()});
   if(result.status===200)await audit(pool,{actorUserId:req.user.id,restaurantId:null,action:'restaurant.delete:'+id+':'+String(result.body.deleted).slice(0,80)});
   res.status(result.status).json(result.body);
  }catch{res.status(503).json({error:'Database unavailable'});}
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
   await audit(pool,{actorUserId:req.user.id,restaurantId,action:'voice_assistant.map:'+assistantId+':'+(active?'on':'off')});
   res.json({assistant_id:assistantId,restaurant_id:restaurantId,active});
  }catch{res.status(503).json({error:'Mapping unavailable'});}
 });
 router.get('/platform/whatsapp-signup',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  res.json({...await getSignupConfig(pool),app_secret_set:Boolean(process.env.META_APP_SECRET)});
 });
 router.put('/platform/whatsapp-signup',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  try{const saved=await saveSignupConfig(pool,req.body||{});await audit(pool,{actorUserId:req.user.id,restaurantId:null,action:'whatsapp_signup.config'});res.json({...saved,app_secret_set:Boolean(process.env.META_APP_SECRET)});}
  catch(error){res.status(error.status||503).json({error:error.status?error.message:'Could not save'});}
 });
 router.post('/platform/restaurants/:id/whatsapp-ai-pilot',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  const id=Number(req.params.id),on=req.body?.on;
  if(!Number.isSafeInteger(id)||id<1||typeof on!=='boolean')return res.status(400).json({error:'Invalid request'});
  try{
   const [found]=await pool.execute('SELECT id FROM restaurants WHERE id=? LIMIT 1',[id]);
   if(!found.length)return res.status(404).json({error:'Restaurant not found'});
   const list=await setPilot(pool,id,on);
   await audit(pool,{actorUserId:req.user.id,restaurantId:id,action:'whatsapp_ai.pilot:'+(on?'on':'off')});
   res.json({restaurant_id:id,ai_pilot:on,pilot:list});
  }catch{res.status(503).json({error:'Pilot setting unavailable'});}
 });
 router.post('/platform/whatsapp-accounts/:wabaId/subscribe',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  const wabaId=req.params.wabaId,token=process.env.WHATSAPP_ACCESS_TOKEN;
  if(!/^[0-9]{5,64}$/.test(wabaId))return res.status(400).json({error:'Invalid WhatsApp account ID'});
  if(!token)return res.status(503).json({error:'WHATSAPP_ACCESS_TOKEN is not set'});
  const version=/^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_VERSION||'')?process.env.WHATSAPP_GRAPH_VERSION:'v23.0';
  const url='https://graph.facebook.com/'+version+'/'+wabaId+'/subscribed_apps';
  try{
   const post=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(10000)});
   const posted=await post.json().catch(()=>({}));
   if(!post.ok)return res.status(502).json({error:String(posted?.error?.message||('Meta '+post.status)).slice(0,300)});
   const get=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(10000)});
   const listed=await get.json().catch(()=>({}));
   const apps=Array.isArray(listed?.data)?listed.data.map(a=>String(a?.whatsapp_business_api_data?.name||a?.name||a?.whatsapp_business_api_data?.id||'app').slice(0,80)):[];
   await audit(pool,{actorUserId:req.user.id,restaurantId:null,action:'whatsapp_account.subscribe:'+wabaId});
   console.log('WhatsApp account …'+wabaId.slice(-4)+' subscribed to the app ('+apps.length+' app(s))');
   res.json({subscribed:posted?.success===true,apps});
  }catch(error){res.status(502).json({error:'Meta request failed'});}
 });
 router.put('/platform/whatsapp-numbers/:phoneId',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  const phoneId=req.params.phoneId,restaurantId=req.body?.restaurant_id,active=req.body?.active;
  if(!/^[0-9]{1,64}$/.test(phoneId)||!Number.isSafeInteger(restaurantId)||restaurantId<1||typeof active!=='boolean')return res.status(400).json({error:'Invalid mapping'});
  try{
   const [restaurants]=await pool.execute('SELECT id FROM restaurants WHERE id=? LIMIT 1',[restaurantId]);
   if(!restaurants.length)return res.status(404).json({error:'Restaurant not found'});
   await pool.execute('INSERT INTO whatsapp_numbers(phone_number_id,restaurant_id,active) VALUES (?,?,?) ON DUPLICATE KEY UPDATE restaurant_id=VALUES(restaurant_id),active=VALUES(active)',[phoneId,restaurantId,active]);
   await audit(pool,{actorUserId:req.user.id,restaurantId,action:'whatsapp_number.map:'+phoneId+':'+(active?'on':'off')});
   res.json({phone_number_id:phoneId,restaurant_id:restaurantId,active});
  }catch{res.status(503).json({error:'Mapping unavailable'});}
 });
 router.get('/platform/whatsapp-numbers',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  try{const [rows]=await pool.query('SELECT w.phone_number_id,w.restaurant_id,r.name AS restaurant_name,r.slug AS restaurant_slug,w.active FROM whatsapp_numbers w JOIN restaurants r ON r.id=w.restaurant_id ORDER BY w.phone_number_id LIMIT 200');const pilot=new Set(await getPilotIds(pool));let ai=new Map();try{const [settings]=await pool.query('SELECT restaurant_id,enabled FROM whatsapp_ai_settings');ai=new Map(settings.map(r=>[Number(r.restaurant_id),Boolean(r.enabled)]));}catch{}res.json({numbers:(await withDisplayNumbers(rows)).map(r=>({...r,ai_pilot:pilot.has(Number(r.restaurant_id)),ai_enabled:ai.get(Number(r.restaurant_id))||false}))});}
  catch{res.status(503).json({error:'Mapping unavailable'});}
 });
 router.get('/my/restaurants',requireAuth,async(req,res)=>{
  try {
   const [rows]=await pool.execute('SELECT r.id,r.name,r.slug,r.country_code,r.currency,r.locale,m.role FROM restaurant_members m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.user_id=? ORDER BY r.name',[req.user.id]);
   res.json({restaurants:rows});
  } catch {res.status(503).json({error:'Database unavailable'});}
 });
 router.get('/public/restaurants/:slug/menu',async(req,res)=>{
  if(!/^[a-z0-9-]{1,160}$/.test(req.params.slug))return res.status(400).json({error:'Invalid slug'});
  try {
   const [restaurants]=await pool.execute('SELECT id,name,slug,currency,locale FROM restaurants WHERE slug=? LIMIT 1',[req.params.slug]);
   if(!restaurants.length)return res.status(404).json({error:'Restaurant not found'});
   const restaurant=restaurants[0];
   const [items]=await pool.execute('SELECT id,name,description,price_minor,category,image_url FROM menu_items WHERE restaurant_id=? AND active=1 ORDER BY id',[restaurant.id]);
   const payment_options=publicPaymentOptions(await loadPaymentSettings(pool,restaurant.id));
   res.json({restaurant,items,payment_options});
   trackSiteEvent(pool,restaurant.id,'menu_views',req);
  } catch {res.status(503).json({error:'Database unavailable'});}
 });
 return router;
}
