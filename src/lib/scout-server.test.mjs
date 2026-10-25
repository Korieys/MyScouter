import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createScoutAccess} from './scout-server.ts';

const id='scout-11111111-1111-4111-8111-111111111111';
const record={id,userId:'owner-a',pages:[],enhancedAssets:[]};
const request=token=>new Request('https://app.example/api/scouts/'+id,{headers:token?{Authorization:'Bearer '+token}:{}});

test('saved-record access verifies identity before database reads and isolates accounts',async()=>{
 const reads=[],verifications=[];
 const access=createScoutAccess(()=>({
  auth:{verifyIdToken:async(token,revoked)=>{verifications.push([token,revoked]);if(token==='revoked')throw Error('revoked');return{uid:token};}},
  db:{collection:name=>({doc:docId=>({get:async()=>{reads.push([name,docId]);return{exists:name==='privateScouts'&&docId===id,data:()=>docId===id?record:undefined};}})})},
 }));
 for(const token of [undefined,'revoked']) await assert.rejects(access.requireScout(request(token),id),{status:401});
 assert.equal(reads.length,0);
 const owner=request('owner-a');
 assert.equal(await access.requireUser(owner),'owner-a');
 assert.equal((await access.requireScout(owner,id)).record,record);
 assert.equal(verifications.filter(([token])=>token==='owner-a').length,1,'one verification per request');
 assert.equal(reads.length,2);assert.equal(reads[0][0],'privateScoutAccountState');assert.deepEqual(reads[1],['privateScouts',id]);
 await assert.rejects(access.requireScout(request('owner-b'),id),{status:404});
 await assert.rejects(access.requireScout(request('owner-a'),'scout-22222222-2222-4222-8222-222222222222'),{status:404});
 const before=reads.length;
 await assert.rejects(access.requireScout(request('owner-a'),'../scouts/legacy'),{status:404});
 assert.equal(reads.length,before+1,'only the account state is read for an invalid scout id');
 assert.ok(verifications.every(([,revoked])=>revoked===true));
});

test('request identity cache never survives a new request or hides revoked sessions',async()=>{
 let calls=0;
 const access=createScoutAccess(()=>({auth:{verifyIdToken:async()=>{if(++calls>1)throw Error('revoked');return{uid:'owner-a'};}},db:{collection:()=>({doc:()=>({get:async()=>({exists:false})})})}}));
 assert.equal(await access.requireUser(request('same-token')),'owner-a');
 await assert.rejects(access.requireUser(request('same-token')),{status:401});
 assert.equal(calls,2);
});
