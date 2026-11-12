import express from 'express';
import { requireAuth } from './auth.js';
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
