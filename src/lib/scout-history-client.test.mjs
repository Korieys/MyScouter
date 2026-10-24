import {test,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {loadScoutHistory} from './scout-history-client.ts';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;mock.restoreAll();});

test('history requests use the current account token, encode cursors and refuse malformed payloads',async()=>{
 const calls=[],user={getIdToken:async()=>'owner-token'};
 globalThis.fetch=async(path,options)=>{calls.push({path,options});return Response.json({scouts:[],nextCursor:null});};
 assert.deepEqual(await loadScoutHistory(user,'next value',new AbortController().signal),{scouts:[],nextCursor:null});
 assert.equal(calls[0].path,'/api/scouts?cursor=next%20value');assert.equal(calls[0].options.headers.get('Authorization'),'Bearer owner-token');assert.equal(calls[0].options.cache,'no-store');
 for(const value of [{}, {scouts:[],nextCursor:42}, {scouts:[{id:'../../escape'}],nextCursor:null}]){
  globalThis.fetch=async()=>Response.json(value);
  await assert.rejects(loadScoutHistory(user,null,new AbortController().signal),/history could not load/);
 }
});

test('cancelling history stops waiting even when account-token retrieval is still pending',async()=>{
 const controller=new AbortController();let finishToken;const calls=[];
 globalThis.fetch=async(path,options)=>{calls.push(options.signal.aborted);throw Error('aborted');};
 const result=loadScoutHistory({getIdToken:()=>new Promise(resolve=>{finishToken=resolve;})},null,controller.signal);
 controller.abort();await assert.rejects(result,/cancelled/);
 finishToken('late-token');await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[true]);
});

test('deadline releases a stalled history request with a retryable message',async()=>{
 const deadline=new AbortController();let timeout;
 mock.method(AbortSignal,'timeout',ms=>{timeout=ms;return deadline.signal;});
 let sentSignal;
 globalThis.fetch=async(path,options)=>{sentSignal=options.signal;return new Promise(()=>{});};
 const result=loadScoutHistory({getIdToken:async()=>'owner-token'},null,new AbortController().signal);
 await new Promise(resolve=>setImmediate(resolve));deadline.abort();
 await assert.rejects(result,/took too long.*try again/);assert.equal(timeout,20_000);assert.equal(sentSignal.aborted,true);
});
