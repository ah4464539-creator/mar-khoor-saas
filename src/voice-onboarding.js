import {validPhone,validProviderId} from './voice-routing.js';

export async function assignRegionalVoiceLine(pool,restaurantId,userId){
 const db=await pool.getConnection();
 try{
  await db.beginTransaction();
  const [restaurants]=await db.execute(
   `SELECT r.country_code FROM restaurants r
    JOIN restaurant_members m ON m.restaurant_id=r.id AND m.user_id=? AND m.role='admin'
    JOIN restaurant_paid_voice_access p ON p.restaurant_id=r.id AND p.paid_until>UTC_TIMESTAMP()
    WHERE r.id=? FOR UPDATE`,[userId,restaurantId]);
  if(!restaurants.length){await db.rollback();return {status:'not_eligible'};}
  const [existing]=await db.execute(
   'SELECT phone FROM restaurant_public_phones WHERE restaurant_id=? FOR UPDATE',[restaurantId]);
  if(existing.length){await db.commit();return {status:'assigned',phone:existing[0].phone};}
  const [lines]=await db.execute(
   `SELECT phone_number_id,assistant_id,phone FROM regional_voice_lines
    WHERE country_code=? AND restaurant_id IS NULL ORDER BY phone_number_id LIMIT 1 FOR UPDATE`,
   [restaurants[0].country_code]);
  if(!lines.length){await db.commit();return {status:'awaiting_local_number'};}
  const line=lines[0];
  if(!validPhone(line.phone)||!validProviderId(line.assistant_id)||!validProviderId(line.phone_number_id)){
   throw Error('Invalid provider line inventory');
  }
  await db.execute('INSERT INTO voice_assistants(assistant_id,restaurant_id,active) VALUES (?,?,1)',[line.assistant_id,restaurantId]);
  await db.execute('INSERT INTO restaurant_public_phones(restaurant_id,phone) VALUES (?,?)',[restaurantId,line.phone]);
  await db.execute('UPDATE regional_voice_lines SET restaurant_id=? WHERE phone_number_id=?',[restaurantId,line.phone_number_id]);
  await db.commit();
  return {status:'assigned',phone:line.phone};
 }catch(error){
  await db.rollback().catch(()=>{});
  throw error;
 }finally{
  db.release();
 }
}

export async function registerRegionalVoiceLine(pool,{country_code,phone_number_id},apiKey){
 const response=await fetch('https://api.vapi.ai/phone-number/'+encodeURIComponent(phone_number_id),{
  headers:{Authorization:'Bearer '+apiKey},
  signal:AbortSignal.timeout(5000)
 });
 if(response.status===404)return null;
 if(!response.ok)throw Error('Vapi lookup failed');
 const line=await response.json();
 if(line.id!==phone_number_id||line.status!=='active'||!validPhone(line.number)||!validProviderId(line.assistantId))return null;
 await pool.execute(
  `INSERT INTO regional_voice_lines(phone_number_id,assistant_id,phone,country_code)
   SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM voice_assistants WHERE assistant_id=?)
     AND NOT EXISTS (SELECT 1 FROM restaurant_public_phones WHERE phone=?)`,
  [line.id,line.assistantId,line.number,country_code,line.assistantId,line.number]).then(([result])=>{
   if(result.affectedRows!==1)throw Object.assign(Error('Line already assigned'),{code:'ER_DUP_ENTRY'});
  });
 return {phone:line.number,country_code};
}
