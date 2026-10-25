import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {runScout} from './run-scout.ts';
const original=globalThis.fetch;
afterEach(()=>{globalThis.fetch=original;});
const user={getIdToken:async()=> 'fictional-owner'};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async condition=>{for(let i=0;i<100&&!condition();i++)await wait(5);assert.ok(condition());};

test('progress starts before capture completes, never moves backwards, and finishes only after copy',async()=>{
 const calls=[],updates=[];let finishCapture,finishCopy,job,polls=0;
 globalThis.fetch=async(path,options)=>{
  calls.push(path);assert.equal(options.headers.get('Authorization'),'Bearer fictional-owner');
  if(path.startsWith('/api/scout/progress')) {job=new URL(path,'https://app.example').searchParams.get('jobId');polls++;return polls===1?Response.json({}, {status:404}):Response.json({progress:{step:'capture',detail:'Capturing...',progress:polls===2?35:15}});}
  if(path==='/api/scout'){assert.equal(JSON.parse(options.body).jobId,job);return new Promise(resolve=>{finishCapture=resolve;});}
  if(path==='/api/copy')return new Promise(resolve=>{finishCopy=resolve;});
  return Response.json({});
 };
 const promise=runScout(user,{url:'https://example.com'},value=>updates.push(value),new AbortController().signal,5);
 await until(()=>polls>=3);assert.equal(calls[0].startsWith('/api/scout/progress'),true);assert.equal(updates.at(-1).progress,35);
 finishCapture(Response.json({id:'server-generated-id'}));await until(()=>finishCopy);
 assert.equal(updates.at(-1).progress,95);assert.ok(updates.every(value=>value.step!=='done'));
 finishCopy(Response.json({}));assert.equal(await promise,'server-generated-id');assert.equal(updates.at(-1).step,'done');
 const count=calls.length;await wait(20);assert.equal(calls.length,count);
});

test('cancellation ignores a late capture result and cannot start further work',async()=>{
 let finishCapture;const calls=[];const controller=new AbortController();
 globalThis.fetch=async(path)=>{calls.push(path);if(path==='/api/scout')return new Promise(resolve=>{finishCapture=resolve;});return Response.json({}, {status:404});};
 const promise=runScout(user,{},()=>{},controller.signal,5);await until(()=>finishCapture);
 controller.abort();finishCapture(Response.json({id:'old-account-pack'}));await assert.rejects(promise);
 assert.equal(calls.includes('/api/enhance'),false);assert.equal(calls.includes('/api/copy'),false);
});

test('optional processing failure opens the saved pack without claiming all work completed',async()=>{
 const updates=[];
 globalThis.fetch=async path=>path.startsWith('/api/scout/progress')?Response.json({}, {status:404}):path==='/api/scout'?Response.json({id:'saved-pack'}):Response.json({error:'Temporary failure'},{status:503});
 assert.equal(await runScout(user,{},value=>updates.push(value),new AbortController().signal,5),'saved-pack');
 assert.equal(updates.at(-1).step,'saved');assert.ok(updates.at(-1).detail.includes('retry'));
});

test('failed capture stops polling and never starts optional processing',async()=>{
 const calls=[];
 globalThis.fetch=async path=>{calls.push(path);return Response.json({error:'Capture unavailable'},{status:path==='/api/scout'?422:404});};
 await assert.rejects(runScout(user,{},()=>{},new AbortController().signal,5),/Capture unavailable/);
 assert.equal(calls.includes('/api/enhance'),false);const count=calls.length;await wait(20);assert.equal(calls.length,count);
});

test('account cancellation releases stalled token retrieval without sending a late request',async()=>{
 let release;const controller=new AbortController();const requests=[];
 const token=new Promise(resolve=>{release=resolve;});
 globalThis.fetch=async path=>{requests.push(path);return Response.json({});};
 const promise=runScout({getIdToken:()=>token},{},()=>{},controller.signal,5);
 controller.abort();await assert.rejects(promise);
 release('fictional-token');await wait(10);assert.deepEqual(requests,[]);
});
