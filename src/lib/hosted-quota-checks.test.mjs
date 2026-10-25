import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {checkHostedCaptureQuota,QUOTA_FIXTURE_URL} from './hosted-quota-checks.ts';
const original=globalThis.fetch,user={uid:'fixture-owner',getIdToken:async()=> 'fictional'};
afterEach(()=>{globalThis.fetch=original;});
test('quota probe stops at the account cap, checks Retry-After and verifies rejection replay without new history',async()=>{
 let attempts=0;globalThis.fetch=async(path,options)=>{
  if(path==='/api/scouts')return Response.json({scouts:[{id:'existing-owned-fixture'}]});
  assert.equal(path,'/api/scout');assert.equal(JSON.parse(options.body).url,QUOTA_FIXTURE_URL);
  return ++attempts<=2?Response.json({error:'DNS unavailable'},{status:503}):Response.json({error:'Your daily capture attempt limit has been reached.'},{status:429,headers:{'Retry-After':'3600'}});
 };
 const result=await checkHostedCaptureQuota(user,new AbortController().signal,()=>true);
 assert.equal(result.passed,true);assert.deepEqual(result.attemptStatuses,[503,503,429]);assert.equal(attempts,4);assert.equal(result.replayStatus,429);assert.equal(result.historyFirstPageUnchanged,true);
 assert.equal(JSON.stringify(result).includes('fictional-owner'),false);
});
test('global busy response and unexpected successful capture cannot be reported as a daily account cap',async()=>{
 for(const status of [200,429]) {
  let posts=0;globalThis.fetch=async path=>path==='/api/scouts'?Response.json({scouts:[]}):(++posts,Response.json({error:'The processing queue is busy.'},{status,headers:{'Retry-After':'30'}}));
  const result=await checkHostedCaptureQuota(user,new AbortController().signal,()=>true);
  assert.equal(result.passed,false);assert.equal(posts,1);assert.equal(result.replayStatus,null);
 }
});
test('quota probe is strictly bounded when no limit appears',async()=>{
 let posts=0;globalThis.fetch=async path=>path==='/api/scouts'?Response.json({scouts:[]}):(++posts,Response.json({error:'DNS unavailable'},{status:503}));
 const result=await checkHostedCaptureQuota(user,new AbortController().signal,()=>true);
 assert.equal(result.passed,false);assert.equal(posts,11);
});
