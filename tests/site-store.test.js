import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSite,saveSite,canPublish,setPublished,loadPublicSite} from '../src/site-store.js';

const restaurant={id:4,name:'Cheema Cafe',slug:'cheema-cafe',country_code:'PK',currency:'PKR'};
const rec=(handler)=>{const queries=[];return {queries,async execute(sql,args){queries.push({sql,args});return handler(sql,args)}}};

test('loadSite returns defaults when no row exists and survives corrupt JSON',async()=>{
 const none=await loadSite(rec(()=>[[]]),restaurant);
 assert.equal(none.published,false);
 assert.equal(none.config.headline,'Cheema Cafe');
 const bad=await loadSite(rec(()=>[[{config:'{not json',description:null,published:1}]]),restaurant);
 assert.equal(bad.published,true);
 assert.equal(bad.config.theme,'green');
});

test('saveSite stores sanitized JSON and never touches the published flag',async()=>{
 const db=rec(()=>[{}]);
 const saved=await saveSite(db,restaurant,{config:{headline:'Hi <b>',theme:'nope',phone:'bad!'},description:'x'.repeat(900)});
 assert.equal(saved.description.length,500);
 assert.equal(saved.config.theme,'green');
 assert.equal(saved.config.phone,'');
 assert.ok(!db.queries[0].sql.includes('published'));
 assert.equal(JSON.parse(db.queries[0].args[1]).headline,'Hi <b>');
});

test('publishing needs an active website plan unless super admin or free pilot flag',async()=>{
 const withPlan=rec(()=>[[{id:1}]]);
 assert.equal(await canPublish(withPlan,4,{free:false}),true);
 assert.match(withPlan.queries[0].sql,/status='active'/);
 assert.match(withPlan.queries[0].sql,/FIND_IN_SET\('website',features\)/);
 assert.equal(await canPublish(rec(()=>[[]]),4,{free:false}),false);
 const skip=rec(()=>{throw Error('should not query')});
 assert.equal(await canPublish(skip,4,{superAdmin:true,free:false}),true);
 assert.equal(await canPublish(skip,4,{free:true}),true);
});

test('setPublished writes 1 or 0',async()=>{
 const db=rec(()=>[{}]);
 await setPublished(db,restaurant,true);await setPublished(db,restaurant,false);
 assert.equal(db.queries[0].args[2],1);assert.equal(db.queries[1].args[2],0);
});

test('public site loads only published sites and active items, and rejects bad slugs without querying',async()=>{
 const db=rec(sql=>sql.includes('FROM restaurants r')?[[{...restaurant,config:JSON.stringify({headline:'Hello',theme:'gold'})}]]:[[{name:'Fries',description:null,price_minor:100}]]);
 const site=await loadPublicSite(db,'cheema-cafe');
 assert.equal(site.config.headline,'Hello');
 assert.equal(site.items.length,1);
 assert.match(db.queries[0].sql,/s\.published=1/);
 assert.match(db.queries[1].sql,/active=1/);
 const none=rec(()=>{throw Error('no query')});
 assert.equal(await loadPublicSite(none,'Bad Slug!'),null);
 assert.equal(await loadPublicSite(rec(()=>[[]]),'unknown'),null);
});

test('sites router checks the restaurant admin role and sends a strict CSP',()=>{
 const src=readFileSync(new URL('../src/sites.js',import.meta.url),'utf8');
 assert.match(src,/role='admin'/);
 assert.match(src,/Content-Security-Policy/);
 assert.match(src,/requireAuth, restaurantAdmin/);
 const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 assert.ok(server.includes('sitesRouter(pool)'));
 assert.ok(server.includes("'/api/restaurants/:restaurantId/site/generate'"));
 assert.match(readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8'),/CREATE TABLE IF NOT EXISTS restaurant_sites/);
});
