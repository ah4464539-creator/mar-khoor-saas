import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRoute,catalogWithRoutes,isOrderable,orderTotals,NEXT_STATUS} from '../src/number-routes.js';
import {quotePlan} from '../src/plan-quote.js';

test('normalizeRoute accepts a manual route and rejects bad input',()=>{
 assert.deepEqual(normalizeRoute('AE',{provider:'telnyx',mode:'manual',monthly_minor:2500,setup_minor:500,requirements:'Trade licence'}).route,
  {country_code:'AE',provider:'telnyx',mode:'manual',monthly_minor:2500,setup_minor:500,requirements:'Trade licence'});
 assert.equal(normalizeRoute('AE',{provider:'telnyx',mode:'manual',monthly_minor:2500}).route.setup_minor,0);
 for(const [country,input] of [
  ['ae',{provider:'telnyx',mode:'manual',monthly_minor:1}],
  ['AE',{provider:'nope',mode:'manual',monthly_minor:1}],
  ['AE',{provider:'telnyx',mode:'weird',monthly_minor:1}],
  ['AE',{provider:'telnyx',mode:'manual'}],
  ['AE',{provider:'telnyx',mode:'manual',monthly_minor:-1}],
  ['AE',{provider:'telnyx',mode:'manual',monthly_minor:1.5}],
  ['AE',{provider:'telnyx',mode:'manual',monthly_minor:1,requirements:'x'.repeat(501)}],
  ['AE',null]])
  assert.ok(normalizeRoute(country,input).error,JSON.stringify([country,input]));
});

test('a route cannot claim automatic provisioning before an adapter exists',()=>{
 assert.match(normalizeRoute('AE',{provider:'telnyx',mode:'auto',monthly_minor:1}).error,/not implemented/);
});

test('unavailable routes need no prices',()=>{
 assert.deepEqual(normalizeRoute('PK',{provider:'manual',mode:'unavailable'}).route.monthly_minor,null);
});

test('stored routes override the environment catalog and feed quotePlan',()=>{
 const base={services:{voice:4900},numbers:{AE:{monthly:9999,setup:0}}};
 const catalog=catalogWithRoutes(base,[{country_code:'AE',mode:'manual',monthly_minor:2500,setup_minor:500},{country_code:'PK',mode:'unavailable',monthly_minor:null,setup_minor:null}]);
 const ae=quotePlan({country:'AE',features:['voice'],numberMode:'new'},catalog);
 const number=ae.items.find(i=>i.label.startsWith('Local phone number'));
 assert.equal(number.monthly,2500);assert.equal(number.setup,500);
 const pk=quotePlan({country:'PK',features:['voice'],numberMode:'new'},catalog);
 assert.equal(pk.items.find(i=>i.label.startsWith('Local phone number')).status,'unavailable');
 assert.equal(base.numbers.AE.monthly,9999);
});

test('orderable quotes need confirmed prices and no unavailable line',()=>{
 const catalog={services:{voice:4900,website:1900},numbers:{AE:{monthly:2500,setup:500},PK:{status:'unavailable'}}};
 const ok=quotePlan({country:'AE',features:['voice','website'],numberMode:'new'},catalog);
 assert.equal(isOrderable(ok),true);
 assert.deepEqual(orderTotals(ok),{monthly:4900+1900+2500,firstPayment:4900+1900+2500+500});
 assert.equal(isOrderable(quotePlan({country:'PK',features:['voice'],numberMode:'new'},catalog)),false);
 assert.equal(isOrderable(quotePlan({country:'AE',features:['webAi'],numberMode:'existing'},catalog)),false);
 assert.equal(isOrderable({items:[]}),false);
 assert.equal(isOrderable(null),false);
});

test('order status can only move forward',()=>{
 assert.deepEqual(NEXT_STATUS.pending_payment,['paid','cancelled']);
 assert.equal(NEXT_STATUS.cancelled.length,0);
 assert.ok(!NEXT_STATUS.paid.includes('pending_payment'));
});
