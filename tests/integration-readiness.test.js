import test from 'node:test';
import assert from 'node:assert/strict';
import {checkIntegrationReadiness} from '../scripts/check-integrations.js';

test('integration readiness rejects absent credentials without printing secret values',()=>{
 const r=checkIntegrationReadiness({});
 assert.equal(r.ready,false);
 assert.deepEqual(r.groups.ai.missing,['OPENAI_API_KEY']);
 assert.equal(JSON.stringify(r).includes('secret-value'),false);
});
test('integration readiness accepts valid configuration but still requires live verification',()=>{
 const env={DB_USER:'dbuser',DB_PASSWORD:'secret-value',DB_NAME:'db',META_APP_SECRET:'secret-value',WHATSAPP_VERIFY_TOKEN:'secret-value',WHATSAPP_ACCESS_TOKEN:'secret-value',OPENAI_API_KEY:'secret-value',WHATSAPP_GRAPH_VERSION:'v23.0'};
 const r=checkIntegrationReadiness(env);
 assert.equal(r.ready,true);
 assert.equal(r.requires_live_verification,true);
 assert.equal(JSON.stringify(r).includes('secret-value'),false);
});
test('integration readiness rejects placeholders and invalid Graph versions',()=>{
 const env={DB_USER:'dbuser',DB_PASSWORD:'replace_me',DB_NAME:'db',META_APP_SECRET:'secret',WHATSAPP_VERIFY_TOKEN:'token',WHATSAPP_ACCESS_TOKEN:'token',OPENAI_API_KEY:'key',WHATSAPP_GRAPH_VERSION:'invalid'};
 const r=checkIntegrationReadiness(env);
 assert.equal(r.ready,false);
 assert.deepEqual(r.groups.database.missing,['DB_PASSWORD']);
 assert.ok(r.groups.meta_sending.missing.includes('WHATSAPP_GRAPH_VERSION (invalid)'));
});
