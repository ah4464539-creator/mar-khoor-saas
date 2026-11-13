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
