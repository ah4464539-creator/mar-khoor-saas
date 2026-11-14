import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTrustProxy,securityHeaders,rateLimit,jsonErrorHandler,audit,accessLog} from '../src/security.js';

const fakeRes=()=>{const res={headers:{},code:200,body:null,
 set(k,v){this.headers[k]=v;return this},status(c){this.code=c;return this},json(b){this.body=b;return this},on(){}};return res};

test('parseTrustProxy defaults to one hop and accepts false or a small number',()=>{
 assert.equal(parseTrustProxy(undefined),1);
 assert.equal(parseTrustProxy(''),1);
 assert.equal(parseTrustProxy('false'),false);
 assert.equal(parseTrustProxy('0'),false);
 assert.equal(parseTrustProxy('2'),2);
 assert.equal(parseTrustProxy('999'),1);
 assert.equal(parseTrustProxy('x'),1);
});

test('security headers are set, and HSTS only on secure requests',()=>{
 const plain=fakeRes();let called=false;
 securityHeaders({secure:false},plain,()=>{called=true});
 assert.ok(called);
 assert.equal(plain.headers['X-Content-Type-Options'],'nosniff');
 assert.equal(plain.headers['X-Frame-Options'],'DENY');
 assert.ok(!plain.headers['Strict-Transport-Security']);
 const secure=fakeRes();securityHeaders({secure:true},secure,()=>{});
 assert.match(secure.headers['Strict-Transport-Security'],/max-age=/);
});

test('rate limiter blocks over the limit per IP, resets after the window and honours methods',()=>{
 let time=1000;
 const limit=rateLimit({windowMs:60000,max:2,methods:['POST'],now:()=>time,name:'t'});
 const run=(ip,method='POST')=>{const res=fakeRes();let passed=false;limit({ip,method},res,()=>{passed=true});return {passed,res}};
 assert.ok(run('1.1.1.1').passed);
 assert.ok(run('1.1.1.1').passed);
 const blocked=run('1.1.1.1');
 assert.equal(blocked.passed,false);
 assert.equal(blocked.res.code,429);
 assert.ok(Number(blocked.res.headers['Retry-After'])>=1);
 assert.ok(run('2.2.2.2').passed);
 assert.ok(run('1.1.1.1','GET').passed);
 time+=61000;
 assert.ok(run('1.1.1.1').passed);
});

test('json error handler hides details and maps body errors',()=>{
 const quiet=console.error;console.error=()=>{};
 try{
  const bad=fakeRes();jsonErrorHandler({type:'entity.parse.failed'},{},bad,()=>{});
  assert.equal(bad.code,400);
  const big=fakeRes();jsonErrorHandler({type:'entity.too.large'},{},big,()=>{});
  assert.equal(big.code,413);
  const boom=fakeRes();jsonErrorHandler(Error('secret stack info'),{method:'GET',path:'/x'},boom,()=>{});
  assert.equal(boom.code,500);
  assert.deepEqual(boom.body,{error:'Internal error'});
 }finally{console.error=quiet}
});

test('audit writes a trimmed action and never throws',async()=>{
 const calls=[];
 await audit({async execute(sql,args){calls.push({sql,args})}},{actorUserId:3,restaurantId:9,action:'x'.repeat(300)});
 assert.match(calls[0].sql,/INSERT INTO audit_logs/);
 assert.equal(calls[0].args[2].length,120);
 const warn=console.warn;console.warn=()=>{};
 try{await audit({async execute(){throw Error('db down')}},{action:'a'});await audit({},{action:'a'})}finally{console.warn=warn}
});

test('access log only reports server errors',()=>{
 let handler;const res={statusCode:500,on(event,fn){handler=fn}};
 const logged=[];const err=console.error;console.error=m=>logged.push(m);
 try{accessLog({method:'GET',path:'/p'},res,()=>{});handler();res.statusCode=200;handler()}finally{console.error=err}
 assert.equal(logged.length,1);
 assert.ok(!logged[0].includes('Bearer'));
});
