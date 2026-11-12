import express from 'express';
import { requireAuth } from './auth.js';
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
 router.get('/platform/restaurants',requireAuth,async(req,res)=>{
  if(req.user.platformRole!=='super_admin')return res.status(403).json({error:'Forbidden'});
  try{const [rows]=await pool.query('SELECT r.id,r.name,r.slug,r.country_code,r.currency,r.locale,COUNT(m.user_id) AS members FROM restaurants r LEFT JOIN restaurant_members m ON m.restaurant_id=r.id GROUP BY r.id ORDER BY r.id DESC LIMIT 100');res.json({restaurants:rows});}
  catch{res.status(503).json({error:'Database unavailable'});}
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
 router.get('/my/restaurants',requireAuth,async(req,res)=>{
  try {
   const [rows]=await pool.execute('SELECT r.id,r.name,r.slug,r.currency,r.locale,m.role FROM restaurant_members m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.user_id=? ORDER BY r.name',[req.user.id]);
   res.json({restaurants:rows});
  } catch {res.status(503).json({error:'Database unavailable'});}
 });
 router.get('/public/restaurants/:slug/menu',async(req,res)=>{
  if(!/^[a-z0-9-]{1,160}$/.test(req.params.slug))return res.status(400).json({error:'Invalid slug'});
  try {
   const [restaurants]=await pool.execute('SELECT id,name,slug,currency,locale FROM restaurants WHERE slug=? LIMIT 1',[req.params.slug]);
   if(!restaurants.length)return res.status(404).json({error:'Restaurant not found'});
   const restaurant=restaurants[0];
   const [items]=await pool.execute('SELECT id,name,description,price_minor FROM menu_items WHERE restaurant_id=? AND active=1 ORDER BY id',[restaurant.id]);
   res.json({restaurant,items});
  } catch {res.status(503).json({error:'Database unavailable'});}
 });
 return router;
}
