import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {checkHostedPrivacy,privacyPackIds} from './hosted-privacy-checks.ts';
const ids=[1,2,3].map(n=>'scout-'+String(n).repeat(8)+'-1111-4111-8111-111111111111');
const own='scout-99999999-1111-4111-8111-111111111111',token='fictional-session-token',uid='fictional-owner-uid';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
function fixture(calls) {
 return async(path,options)=>{
  const header=new Headers(options.headers).get('Authorization');calls.push({path,header});
  if(header!=='Bearer '+token)return Response.json({error:'Sign in to continue.'},{status:401});
  if(path.startsWith('/api/scouts?'))return Response.json({error:'Invalid history position'},{status:400});
  if(path==='/api/scouts')return Response.json({scouts:[{id:own}]});
  if(path==='/api/scouts/'+own)return Response.json({id:own});
  if(['/api/enhance','/api/copy'].includes(path)&&JSON.parse(options.body).scoutId===own)return Response.json({success:true});
  if(path==='/api/assets/'+own+'/home-desktop-hero.png')return new Response('fictional PNG',{headers:{'Content-Type':'image/png','x-download-sha256':'a'.repeat(64)}});
  return Response.json({error:'This scout is unavailable for your account.'},{status:404});
 };
}
const user={uid,getIdToken:async()=>token};
test('privacy probe exercises actual protected paths with bounded IDs and exports no session or page content',async()=>{
 const calls=[];globalThis.fetch=fixture(calls);
 const report=await checkHostedPrivacy(user,ids,own,new AbortController().signal,()=>true);
 assert.equal(report.passed,true);assert.equal(report.checks.length,26);
 assert.equal(calls.length,26);assert.equal(report.accountScopeHash.length,64);
 const body=JSON.stringify(report);assert.equal(body.includes(token),false);assert.equal(body.includes(uid),false);assert.equal(body.includes('fictional PNG'),false);
 assert.deepEqual(report.checks.filter(c=>c.name.includes('First-account')).map(c=>c.status),Array(15).fill(404));
 assert.ok(calls.filter(c=>c.path==='/api/bundle').some(c=>c.header==='Bearer '+token));
});
test('unexpected downloadable data fails the probe and cancels its body without continuing processing requests',async()=>{
 const calls=[];const baseline=fixture(calls);let canceled=false;
 globalThis.fetch=async(path,options)=>path==='/api/assets/'+ids[0]+'/home-desktop-hero.png'?new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'Content-Type':'image/png'}}):baseline(path,options);
 const report=await checkHostedPrivacy(user,ids,undefined,new AbortController().signal,()=>true);
 assert.equal(report.passed,false);assert.equal(report.checks.at(-1).name,'First-account pack 1 image');assert.equal(canceled,true);
 assert.equal(calls.some(c=>c.path==='/api/enhance'||c.path==='/api/copy'),false);
});
test('invalid owner controls and too many unique packs cannot start a session request',async()=>{
 globalThis.fetch=()=>{throw Error('Unexpected network');};
 await assert.rejects(checkHostedPrivacy(user,ids,ids[0],new AbortController().signal,()=>true),/positive control/);
 assert.throws(()=>privacyPackIds(ids.concat(own).join('\n')),/one to three/);
 assert.throws(()=>privacyPackIds('../scouts/other'),/valid/);
 assert.deepEqual(privacyPackIds(ids[0]+'\n'+ids[0]),[ids[0]]);
});
test('canceling a stalled token request prevents a later authenticated request',async()=>{
 let finish,calls=0;globalThis.fetch=()=>{calls++;throw Error('Late request');};
 const controller=new AbortController();
 const result=checkHostedPrivacy({uid,getIdToken:()=>new Promise(resolve=>{finish=resolve;})},ids,undefined,controller.signal,()=>true);
 const rejected=assert.rejects(result,/stopped/);controller.abort();await rejected;finish(token);
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,0);
});
test('a changed account discards and closes a response before it can be inspected',async()=>{
 let current=true,canceled=false;
 globalThis.fetch=async()=>{current=false;return new Response(new ReadableStream({cancel(){canceled=true;}}));};
 await assert.rejects(checkHostedPrivacy(user,ids,undefined,new AbortController().signal,()=>current),/account changed/);
 assert.equal(canceled,true);
});
