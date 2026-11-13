import test from 'node:test';
import assert from 'node:assert/strict';
import {assignRegionalVoiceLine} from '../src/voice-onboarding.js';

test('regional line assignment requires payment, uses the restaurant country and preserves its number',async()=>{
 let eligible=false,phone;
 const line={phone_number_id:'line-gr',assistant_id:'assistant-gr',phone:'+302541012345'};
 const queries=[];
 const db={
  async beginTransaction(){},async commit(){},async rollback(){},release(){},
  async execute(sql,params){
   queries.push(sql);
   if(sql.includes('restaurant_paid_voice_access')){
    assert.deepEqual(params,[5,12]);
    return [eligible?[{country_code:'GR'}]:[]];
   }
   if(sql.startsWith('SELECT phone FROM'))return [phone?[{phone}]:[]];
   if(sql.includes('FROM regional_voice_lines')){
    assert.deepEqual(params,['GR']);
    return [[line]];
   }
   if(sql.startsWith('INSERT INTO voice_assistants'))assert.deepEqual(params,['assistant-gr',12]);
   if(sql.startsWith('INSERT INTO restaurant_public_phones'))phone=params[1];
   if(sql.startsWith('UPDATE regional_voice_lines'))assert.deepEqual(params,[12,'line-gr']);
   return [[]];
  }
 };
 const pool={async getConnection(){return db;}};
 assert.deepEqual(await assignRegionalVoiceLine(pool,12,5),{status:'not_eligible'});
 assert.equal(queries.length,1);
 eligible=true;
 const expected={status:'assigned',phone:line.phone};
 assert.deepEqual(await assignRegionalVoiceLine(pool,12,5),expected);
 assert.deepEqual(await assignRegionalVoiceLine(pool,12,5),expected);
 assert.equal(queries.filter(sql=>sql.startsWith('UPDATE regional_voice_lines')).length,1);
});
