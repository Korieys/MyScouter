import {test,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {deleteScout} from './scout-deletion-client.ts';
import {DELETE} from '../app/api/scouts/[id]/route.ts';
const id='scout-11111111-1111-4111-8111-111111111111',originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;mock.restoreAll();});

test('deletion rejects unsigned requests before configuration or database access',async()=>{
 const response=await DELETE(new Request('https://app.example/api/scouts/'+id,{method:'DELETE'}),{params:Promise.resolve({id})});
 assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'Sign in to continue.'});assert.equal(response.headers.get('Cache-Control'),'private, no-store');
});

test('deletion client sends the owner token and accepts only an explicit success response',async()=>{
 const calls=[];globalThis.fetch=async(path,options)=>{calls.push({path,options});return Response.json({deleted:true});};
 const user={getIdToken:async()=>'synthetic-owner-token'},signal=new AbortController().signal;
 await deleteScout(user,id,signal);assert.equal(calls[0].path,`/api/scouts/${id}`);assert.equal(calls[0].options.method,'DELETE');assert.equal(calls[0].options.headers.get('Authorization'),'Bearer synthetic-owner-token');
 for(const invalid of ['../other','scout-old','https://example.com'])await assert.rejects(deleteScout(user,invalid,signal),/cannot be deleted/);
 assert.equal(calls.length,1);
 for(const value of [{},{deleted:false}]){globalThis.fetch=async()=>Response.json(value);await assert.rejects(deleteScout(user,id,signal),/could not be confirmed/);}
 globalThis.fetch=async()=>Response.json({error:'Processing is active'},{status:409});await assert.rejects(deleteScout(user,id,signal),/Processing is active/);
});

test('cancellation during token retrieval sends no late destructive request',async()=>{
 let token;const controller=new AbortController(),calls=[];
 globalThis.fetch=async(...args)=>{calls.push(args);return Response.json({deleted:true});};
 const pending=deleteScout({getIdToken:()=>new Promise(resolve=>{token=resolve;})},id,controller.signal);
 controller.abort();await assert.rejects(pending,/check whether it finished/);
 token('late-token');await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,0);
});

test('deletion timeout reports an uncertain outcome instead of claiming cancellation or success',async()=>{
 const deadline=new AbortController();let timeout,signal;
 mock.method(AbortSignal,'timeout',ms=>{timeout=ms;return deadline.signal;});
 globalThis.fetch=async(path,options)=>{signal=options.signal;return new Promise(()=>{});};
 const result=deleteScout({getIdToken:async()=>'owner'},id,new AbortController().signal);
 await new Promise(resolve=>setImmediate(resolve));deadline.abort();await assert.rejects(result,/could not be confirmed.*whether it finished/);assert.equal(timeout,55000);assert.equal(signal.aborted,true);
});
