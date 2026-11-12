import 'dotenv/config';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const required={
 database:['DB_USER','DB_PASSWORD','DB_NAME'],
 meta_webhook:['META_APP_SECRET','WHATSAPP_VERIFY_TOKEN'],
 meta_sending:['WHATSAPP_ACCESS_TOKEN'],
 ai:['OPENAI_API_KEY']
};
export function checkIntegrationReadiness(env=process.env){
 const groups={};
 for(const [group,names] of Object.entries(required)){
  const missing=names.filter(name=>!env[name]||/^(replace_|your_|changeme)/i.test(env[name]));
  groups[group]={ready:missing.length===0,missing};
 }
 const version=env.WHATSAPP_GRAPH_VERSION||'v23.0';
 if(!/^v\d{1,2}\.\d{1,2}$/.test(version)){groups.meta_sending.ready=false;groups.meta_sending.missing.push('WHATSAPP_GRAPH_VERSION (invalid)')}
 return {ready:Object.values(groups).every(g=>g.ready),groups,requires_live_verification:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const result=checkIntegrationReadiness();
 console.log(JSON.stringify(result,null,2));
 if(!result.ready)process.exitCode=1;
}
