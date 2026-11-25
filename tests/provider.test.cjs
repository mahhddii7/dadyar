require('./register.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {httpFailure, retryAfterMs, retryDelay, fetchModel, ProviderFailure} = require('../src/server/ai/http.ts');
const {modelErrorMessage} = require('../src/server/ai/provider.ts');
const response = (code, type, headers={}) => Response.json({error:{code,type,message:'PRIVATE FILE DATA AND TOKEN'}},{status:429,headers});
const init = () => ({method:'POST',body:'{}',signal:AbortSignal.timeout(5000)});

for (const code of ['insufficient_quota','credit_balance_exhausted','billing_hard_limit_reached','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded']) {
 test('quota classification: '+code, async()=>{
  const e=await httpFailure(response(code,'insufficient_quota'));
  assert.equal(e.kind,'quota');assert.ok(e.message.includes(code));assert.equal(retryDelay(e,0),undefined);
  assert.ok(!modelErrorMessage(e).includes('PRIVATE'));
 });
}
test('unknown provider content and error codes are not disclosed',async()=>{
 const e=await httpFailure(response('PRIVATE_SECRET','unknown'));
 assert.equal(e.kind,'other');assert.ok(!e.message.includes('PRIVATE'));assert.match(e.message,/به‌تنهایی/);
 const html=await httpFailure(new Response('<html>PRIVATE</html>',{status:429}));assert.equal(html.kind,'other');assert.ok(!html.message.includes('PRIVATE'));
});
test('retry-after seconds, decimal seconds and dates',()=>{
 assert.equal(retryAfterMs('1.25'),1250);assert.equal(retryAfterMs(null),undefined);assert.equal(retryAfterMs('invalid'),undefined);
 assert.equal(retryAfterMs('Wed, 25 Nov 2026 12:00:05 GMT',Date.parse('2026-11-25T12:00:00Z')),5000);
 assert.equal(retryAfterMs('-1'),undefined);
});
test('backoff is bounded and never shortens a long server delay',()=>{
 assert.equal(retryDelay(new ProviderFailure('rate','rate_limit'),0,()=>0),1000);
 assert.equal(retryDelay(new ProviderFailure('rate','rate_limit'),1,()=>0),2000);
 assert.equal(retryDelay(new ProviderFailure('rate','rate_limit'),2),undefined);
 assert.equal(retryDelay(new ProviderFailure('rate','rate_limit',5000),0),5000);
 assert.equal(retryDelay(new ProviderFailure('rate','rate_limit',60000),0),undefined);
});
test('transient rate limit is retried and successful response is preserved',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>++calls===1?response('slow_down','rate_limit_error',{'retry-after':'0'}):Response.json({ok:true}));
 const r=await fetchModel('https://example.invalid',init());assert.equal(calls,2);assert.deepEqual(await r.json(),{ok:true});
});
test('persistent rate limit stops after three attempts',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response('rate_limit_exceeded','tokens',{'retry-after':'0'});});
 await assert.rejects(fetchModel('https://example.invalid',init()),e=>e.kind==='rate_limit');assert.equal(calls,3);
});
test('quota, unknown 429 and long retry-after do not loop',async t=>{
 for(const kind of ['quota','unknown','long']) {
  let calls=0;const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return kind==='quota'?response(null,'insufficient_quota'):kind==='unknown'?new Response('unknown',{status:429}):response('rate_limit_exceeded','tokens',{'retry-after':'60'});});
  await assert.rejects(fetchModel('https://example.invalid',init()),e=>e instanceof ProviderFailure);assert.equal(calls,1);mock.mock.restore();
 }
});
test('cancelling during retry wait prevents another request',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response('rate_limit_exceeded','tokens',{'retry-after':'1'});});
 const controller=new AbortController();const pending=fetchModel('https://example.invalid',{...init(),signal:controller.signal});
 const timer=setTimeout(()=>controller.abort(),10);
 try {await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(calls,1);}finally{clearTimeout(timer);}
});
test('authentication error is not retried or echoed',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{message:'PRIVATE KEY'}},{status:401});});
 await assert.rejects(fetchModel('https://example.invalid',init()),e=>e.message.includes('401')&&!e.message.includes('PRIVATE'));assert.equal(calls,1);
});
