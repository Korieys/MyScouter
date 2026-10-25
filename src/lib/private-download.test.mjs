import {test,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {loadPrivateDownload} from './private-download.ts';
import {privateBinary} from './private-binary.ts';
import {buildBundle} from './bundle.ts';
const originalFetch=globalThis.fetch;
const owner={uid:'owner-a',getIdToken:async()=>'synthetic-owner-token'};
const id='scout-11111111-1111-4111-8111-111111111111';
const load=(filename,signal=new AbortController().signal,user=owner)=>loadPrivateDownload(user,id,filename,signal);
afterEach(()=>{globalThis.fetch=originalFetch;mock.restoreAll();});

test('large generated ZIP reaches the browser byte-for-byte with verified owner authentication',async()=>{
 const bytes=await buildBundle(['large.png','small.png'],async name=>name==='large.png'?randomBytes(6*1024*1024+19):Buffer.from('second file'));
 let request;
 globalThis.fetch=async(path,options)=>{request={path,options};return privateBinary(bytes,{'Content-Type':'application/zip'});};
 const blob=await load();
 assert.equal(request.path,'/api/bundle');assert.equal(request.options.headers.get('authorization'),'Bearer synthetic-owner-token');
 assert.deepEqual(JSON.parse(request.options.body),{scoutId:id});assert.equal(request.options.cache,'no-store');
 assert.equal(blob.size,bytes.length);assert.equal(blob.type,'application/zip');
 assert.equal(createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
});

test('individual PNG downloads use the owned asset route and the same integrity check',async()=>{
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);let path;
 globalThis.fetch=async target=>{path=target;return privateBinary(bytes,{'Content-Type':'image/png'});};
 const blob=await load('home-desktop-hero.png');
 assert.equal(path,`/api/assets/${id}/home-desktop-hero.png`);assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);
});

test('truncated, oversized and same-length damaged files are rejected before saving',async()=>{
 const original=Buffer.from('complete fixture');
 for(const bytes of [original.subarray(0,5),Buffer.concat([original,Buffer.from('extra')]),Buffer.from('damaged! fixture')]){
  const valid=privateBinary(original,{'Content-Type':'application/zip'});
  globalThis.fetch=async()=>new Response(bytes,{headers:valid.headers});
  await assert.rejects(load(),/incomplete or damaged/);
 }
});

test('missing or malformed file metadata, wrong MIME and excessive declared sizes fail without reading a body',async()=>{
 for(const changes of [{'x-download-bytes':''},{'x-download-bytes':'0'},{'x-download-bytes':'1e6'},{'x-download-bytes':String(130*1024*1024)},{'x-download-sha256':'not-a-hash'},{'content-type':'text/html'}]){
  const valid=privateBinary(Buffer.from('fixture'),{'Content-Type':'application/zip'});let canceled=false;
  const body=new ReadableStream({cancel(){canceled=true;}});
  globalThis.fetch=async()=>new Response(body,{headers:{...Object.fromEntries(valid.headers),...changes}});
  await assert.rejects(load(),/incomplete or damaged/);assert.equal(canceled,true);
 }
 const valid=privateBinary(Buffer.from('fixture'),{'Content-Type':'image/png'});
 valid.headers.set('x-download-bytes',String(21*1024*1024));globalThis.fetch=async()=>valid;
 await assert.rejects(load('hero.png'),/incomplete or damaged/);
});

test('deadline releases both stalled token and body reads and cancels the body',async()=>{
 for(const phase of ['token','body']){
  const deadline=new AbortController();let requestedTimeout,canceled=false,finishToken,called=false;
  mock.method(AbortSignal,'timeout',ms=>{requestedTimeout=ms;return deadline.signal;});
  const valid=privateBinary(Buffer.from('fixture'),{'Content-Type':'application/zip'});
  globalThis.fetch=async()=>{called=true;return new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:valid.headers});};
  const user=phase==='token'?{getIdToken:()=>new Promise(resolve=>{finishToken=resolve;})}:owner;
  const task=load(undefined,new AbortController().signal,user);
  await new Promise(resolve=>setImmediate(resolve));deadline.abort();
  await assert.rejects(task,/took too long.*retry/);assert.equal(requestedTimeout,60_000);
  if(phase==='token'){finishToken('late-token');await new Promise(resolve=>setImmediate(resolve));assert.equal(called,false);}
  else assert.equal(canceled,true);
  mock.restoreAll();
 }
});

test('account cancellation during token retrieval never sends a later authenticated request',async()=>{
 const controller=new AbortController();let finishToken,calls=0;
 globalThis.fetch=async()=>{calls++;return privateBinary(Buffer.from('fixture'),{'Content-Type':'application/zip'});};
 const task=load(undefined,controller.signal,{getIdToken:()=>new Promise(resolve=>{finishToken=resolve;})});
 controller.abort();await assert.rejects(task,/cancelled/);
 finishToken('late-token');await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
 await assert.rejects(load(undefined,controller.signal),/cancelled/);
});

test('expired sessions and server failures retain actionable retry messages',async()=>{
 globalThis.fetch=async()=>Response.json({error:'Your session has expired. Please sign in again.'},{status:401});
 await assert.rejects(load(),/sign in again/);
 globalThis.fetch=async()=>Response.json({error:'We could not pack every asset. Please retry the download.'},{status:503});
 await assert.rejects(load(),/retry the download/);
});
