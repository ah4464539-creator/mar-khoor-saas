import 'dotenv/config';
import {restaurantChat} from './restaurant-chat.js';
import mysql from 'mysql2/promise';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

export async function processWhatsAppAIJobs(pool,{fetcher=fetch}={}){
 const key=process.env.OPENAI_API_KEY,metaToken=process.env.WHATSAPP_ACCESS_TOKEN;
 if(!key||!metaToken)throw Error('Missing AI or WhatsApp credentials');
 const started=Date.now();
 const [jobs]=await pool.execute("SELECT j.inbound_message_id,j.restaurant_id,m.phone_number_id,m.sender,m.text_body,r.name,r.slug,r.locale,r.currency FROM whatsapp_ai_jobs j JOIN whatsapp_inbound_messages m ON m.message_id=j.inbound_message_id AND m.restaurant_id=j.restaurant_id JOIN whatsapp_ai_settings s ON s.restaurant_id=j.restaurant_id AND s.enabled=1 JOIN restaurants r ON r.id=j.restaurant_id JOIN whatsapp_numbers w ON w.phone_number_id=m.phone_number_id AND w.restaurant_id=j.restaurant_id AND w.active=1 WHERE j.status='pending' AND m.message_type='text' AND m.text_body IS NOT NULL AND m.received_at>=NOW()-INTERVAL 23 HOUR ORDER BY j.created_at LIMIT 10");
 let sent=0,failed=0;
 for(const job of jobs){
  const [claimed]=await pool.execute("UPDATE whatsapp_ai_jobs j JOIN whatsapp_ai_settings s ON s.restaurant_id=j.restaurant_id AND s.enabled=1 SET j.status='processing' WHERE j.inbound_message_id=? AND j.restaurant_id=? AND j.status='pending'",[job.inbound_message_id,job.restaurant_id]);
  if(!claimed.affectedRows)continue;
  try{
   const result=await restaurantChat(pool,{...job,id:job.restaurant_id},job.text_body,{
    fetcher,key,model:process.env.WHATSAPP_AI_MODEL
   });
   let reply=result.reply.trim();
   if(result.wantsOrder){
    const origin=new URL(process.env.WHATSAPP_STOREFRONT_URL??'https://mar-khoor.com');
    if(origin.protocol!=='https:'||origin.username||origin.password||!/^[-a-z0-9]{1,160}$/.test(job.slug??'')){
     throw Error('Invalid WhatsApp storefront configuration');
    }
    const orderingPage=new URL('/menu.html',origin);
    orderingPage.searchParams.set('restaurant',job.slug);
    reply+='\n\n'+orderingPage.href;
   }
   const version=process.env.WHATSAPP_GRAPH_VERSION||'v23.0';
   if(!/^v[0-9]{1,2}[.][0-9]{1,2}$/.test(version))throw Error('Invalid Graph version');
   const [stillEnabled]=await pool.execute("SELECT s.enabled FROM whatsapp_ai_settings s JOIN whatsapp_numbers w ON w.restaurant_id=s.restaurant_id AND w.phone_number_id=? AND w.active=1 JOIN whatsapp_inbound_messages m ON m.message_id=? AND m.restaurant_id=s.restaurant_id WHERE s.restaurant_id=? AND m.received_at>=NOW()-INTERVAL 23 HOUR",[job.phone_number_id,job.inbound_message_id,job.restaurant_id]);
   if(!stillEnabled.length||!stillEnabled[0].enabled)throw Error('AI disabled, number unlinked or reply window expired');
   const meta=await fetcher('https://graph.facebook.com/'+version+'/'+job.phone_number_id+'/messages',{method:'POST',headers:{Authorization:'Bearer '+metaToken,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:job.sender,type:'text',text:{body:reply}}),signal:AbortSignal.timeout(10000)});
   if(!meta.ok)throw Error('WhatsApp provider unavailable');
   const data=await meta.json(),id=data?.messages?.[0]?.id;
   if(typeof id!=='string'||!id.startsWith('wamid.'))throw Error('Missing outbound ID');
   await pool.execute('INSERT INTO whatsapp_outbound_messages(message_id,restaurant_id,phone_number_id,recipient,text_body) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE message_id=message_id',[id,job.restaurant_id,job.phone_number_id,job.sender,reply]);
   await pool.execute("UPDATE whatsapp_ai_jobs SET status='sent',outbound_message_id=? WHERE inbound_message_id=?",[id,job.inbound_message_id]);
   sent++;
  }catch(error){
   // Do not automatically retry: provider may have accepted a message before DB failed.
   await pool.execute("UPDATE whatsapp_ai_jobs SET status='failed',last_error=? WHERE inbound_message_id=?",[String(error.message||'Failed').slice(0,255),job.inbound_message_id]);
   failed++;
  }
 }
 const result={claimed:jobs.length,sent,failed,duration_ms:Date.now()-started};
 console.info(JSON.stringify({event:'whatsapp_ai_worker_complete',...result}));
 return {claimed:jobs.length,sent,failed};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const pool=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 try{console.log(await processWhatsAppAIJobs(pool))}finally{await pool.end()}
}
