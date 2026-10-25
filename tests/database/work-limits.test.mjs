import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {initializeApp as clientApp,deleteApp as deleteClientApp} from 'firebase/app';
import {getFirestore as clientFirestore,connectFirestoreEmulator,doc,getDoc,setDoc,terminate} from 'firebase/firestore';
import {workStore,LIMIT_COLLECTION,attemptAsset} from '../../src/lib/work-store.ts';
import {WORK_LIMITS} from '../../src/lib/work-policy.ts';
import {readScoutHistory} from '../../src/lib/scout-history.ts';
import {removeScout} from '../../src/lib/scout-deletion.ts';
import {assertOwner} from '../../src/lib/scout-access.ts';
import {createScoutAccess} from '../../src/lib/scout-server.ts';

const projectId='demo-myscouter-readiness';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8187')throw Error('These tests require the disposable local demo emulator on 8187.');
if(process.env.FIREBASE_STORAGE_EMULATOR_HOST!=='127.0.0.1:9197')throw Error('Deletion tests require the disposable local storage emulator on 9197.');
let app,db,bucket;
const limits=(kind,patch)=>({...WORK_LIMITS,[kind]:{...WORK_LIMITS[kind],...patch}});
const owned=(uid,id)=>({id,userId:uid,url:'https://example.com',domain:'example.com',brandColor:'#123456',pages:[{url:'https://example.com',title:'Fictional QA',screenshots:[]}],textContent:'Synthetic website text for tests.',devices:['desktop'],enhancedAssets:[],copy:null,createdAt:'2026-10-23T00:00:00Z',status:'captured'});
async function scout(uid) {const id='scout-'+randomUUID(),ref=db.collection('privateScouts').doc(id);await ref.set(owned(uid,id));return ref;}
const accountRef=(uid,kind)=>db.collection(LIMIT_COLLECTION).doc(`account-${createHash('sha256').update(uid).digest('hex')}-${kind}`);
const globalRef=kind=>db.collection(LIMIT_COLLECTION).doc('global-'+kind);
before(()=>{app=initializeApp({projectId,storageBucket:projectId+'.appspot.com'},'myscouter-work-tests');db=getFirestore(app);bucket=getStorage(app).bucket();});
beforeEach(async()=>{
 // Only the strict demo project on the loopback emulator can reach this cleanup.
 await db.recursiveDelete(db.collection(LIMIT_COLLECTION));
});
after(async()=>{await db.terminate();await deleteApp(app);});

test('early progress correlation preserves server IDs and rejects other owners and deleted packs',async()=>{
 const owner=randomUUID(),other=randomUUID(),job='job-'+randomUUID(),ref=await scout(owner);
 await ref.update({progressJobId:job,progress:{step:'capture',detail:'Fictional progress',progress:35,timestamp:1}});
 const access=createScoutAccess(()=>({db,auth:{verifyIdToken:async token=>({uid:token})}}));
 const request=uid=>new Request('https://app.example/api/scout/progress',{headers:{Authorization:'Bearer '+uid}});
 assert.equal((await access.requireProgress(request(owner),job)).id,ref.id);
 assert.notEqual(ref.id,job);
 await assert.rejects(access.requireProgress(request(other),job),{status:404});
 await assert.rejects(access.requireProgress(request(owner),'job-'+randomUUID()),{status:404});
 await assert.rejects(access.requireProgress(request(owner),'job-arbitrary'),{status:400});
 const reserved=await workStore(db).reserve(owner,'capture');
 await workStore(db).complete(reserved.lease,ref,{status:'captured'});
 assert.equal((await access.requireProgress(request(owner),job)).progressJobId,job);
 await ref.update({status:'deleting'});
 await assert.rejects(access.requireProgress(request(owner),job),{status:404});
});

test('simultaneous capture requests reserve only one per account across store instances',async()=>{
 const uid=randomUUID(),a=workStore(db),b=workStore(db);
 const results=await Promise.allSettled([a.reserve(uid,'capture'),b.reserve(uid,'capture')]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.find(x=>x.status==='rejected').reason.status,409);
 assert.equal((await accountRef(uid,'capture').get()).data().attempts,1);
 assert.equal((await globalRef('capture').get()).data().attempts,1);
 const lease=results.find(x=>x.status==='fulfilled').value.lease;await a.release(lease);
});

test('failed attempts consume daily allowance, release is idempotent, and retries stop at the limit',async()=>{
 const uid=randomUUID(),store=workStore(db,Date.now,limits('capture',{accountDaily:2}));
 for(let i=0;i<2;i++){const result=await store.reserve(uid,'capture');await store.release(result.lease);await store.release(result.lease);}
 await assert.rejects(store.reserve(uid,'capture'),error=>error.status===429 && error.retryAfter>0);
 assert.equal((await accountRef(uid,'capture').get()).data().attempts,2);
 assert.deepEqual((await accountRef(uid,'capture').get()).data().active,[]);
});

test('global concurrency and global daily limits apply across different customer accounts',async()=>{
 const store=workStore(db,Date.now,limits('capture',{globalConcurrent:2,globalDaily:3}));
 const results=await Promise.allSettled([store.reserve(randomUUID(),'capture'),store.reserve(randomUUID(),'capture'),store.reserve(randomUUID(),'capture')]);
 const accepted=results.filter(x=>x.status==='fulfilled');assert.equal(accepted.length,2);
 assert.equal(results.find(x=>x.status==='rejected').reason.status,429);
 for(const result of accepted)await store.release(result.value.lease);
 const last=await store.reserve(randomUUID(),'capture');await store.release(last.lease);
 await assert.rejects(store.reserve(randomUUID(),'capture'),{status:429});
 assert.equal((await globalRef('capture').get()).data().attempts,3);
});

test('midnight resets counts but cannot bypass active work; stale completions cannot overwrite a replacement',async()=>{
 let now=Date.parse('2026-10-23T23:59:50Z');
 const uid=randomUUID(),ref=await scout(uid),store=workStore(db,()=>now,limits('copy',{accountDaily:1}));
 const first=await store.reserve(uid,'copy',ref);
 now+=20000;await assert.rejects(store.reserve(uid,'copy',ref),{status:409});
 now+=90000;const second=await store.reserve(uid,'copy',ref);
 await assert.rejects(store.complete(first.lease,ref,{copy:{pitch:'stale'}}),{status:409});
 await store.release(first.lease);
 assert.equal((await accountRef(uid,'copy').get()).data().active[0].token,second.lease.token);
 const copy={pitch:'Fictional',tagline:'Synthetic',twitter:'Example',blurbs:['Test']};
 await store.complete(second.lease,ref,{copy});
 assert.deepEqual((await ref.get()).data().copy,copy);
 assert.equal((await accountRef(uid,'copy').get()).data().attempts,1);
});

test('completed processing is returned from the saved record without a new reservation or charge',async()=>{
 const uid=randomUUID(),ref=await scout(uid),store=workStore(db,Date.now,limits('copy',{accountDaily:1}));
 const first=await store.reserve(uid,'copy',ref);
 const copy={pitch:'Fictional',tagline:'Synthetic',twitter:'Example',blurbs:['Test']};
 await store.complete(first.lease,ref,{copy,userId:'forged',id:'changed'});
 const replay=await store.reserve(uid,'copy',ref);
 assert.equal(replay.cached,true);assert.deepEqual(replay.record.copy,copy);
 assert.equal(replay.record.userId,uid);assert.equal(replay.record.id,ref.id);
 assert.equal((await accountRef(uid,'copy').get()).data().attempts,1);
 assert.deepEqual((await globalRef('copy').get()).data().active,[]);
});

test('another owner cannot reserve or finish work for a scout',async()=>{
 const owner=randomUUID(),other=randomUUID(),ref=await scout(owner),store=workStore(db);
 await assert.rejects(store.reserve(other,'copy',ref),{status:404});
 assert.equal((await globalRef('copy').get()).exists,false);
 const foreign=await scout(other),reserved=await store.reserve(other,'copy',foreign);
 await assert.rejects(store.complete(reserved.lease,ref,{copy:{pitch:'forged'}}),{status:404});
 assert.equal((await ref.get()).data().copy,null);await store.release(reserved.lease);
});

test('usage corruption fails closed instead of silently granting a fresh allowance',async()=>{
 const uid=randomUUID(),store=workStore(db);
 await accountRef(uid,'capture').set({day:'2026-10-23',attempts:-1,active:[]});
 await assert.rejects(store.reserve(uid,'capture'),{status:503});
 assert.equal((await globalRef('capture').get()).exists,false);
});

test('replacement enhancement names cannot overwrite images from another attempt',()=>{
 const a=attemptAsset('hero-1-enhanced.png',randomUUID()),b=attemptAsset('hero-1-enhanced.png',randomUUID());
 assert.notEqual(a,b);assert.ok(a.startsWith('hero-1-enhanced-'));assert.ok(a.endsWith('.png'));
 assert.throws(()=>attemptAsset('../escape.png',randomUUID()));
 assert.throws(()=>attemptAsset('safe.png','../../forged'));
});

test('current rules deny all client reads and writes of private packs and usage reservations',async()=>{
 const uid='synthetic-client',ref=await scout(uid),reserved=await workStore(db).reserve(uid,'capture');
 for(const authenticated of [false,true]) {
  const app=clientApp({projectId,apiKey:'fictional-test-key'},'client-'+randomUUID());
  const client=clientFirestore(app);
  connectFirestoreEmulator(client,'127.0.0.1',8187,authenticated?{mockUserToken:{sub:uid,user_id:uid,email:'fictional@example.com'}}:{});
  try {
   for(const target of [ref.path,accountRef(uid,'capture').path,globalRef('capture').path]) {
    await assert.rejects(getDoc(doc(client,target)),{code:'permission-denied'});
    await assert.rejects(setDoc(doc(client,target),{attempts:0,active:[]}),{code:'permission-denied'});
   }
  } finally {await terminate(client);await deleteClientApp(app);}
 }
 await workStore(db).release(reserved.lease);
});

test('client transport preserves profile merges and rejects another account',async()=>{
 const uid='profile-'+randomUUID(),other='profile-'+randomUUID();
 const clients=[uid,other].map(owner=>{
  const app=clientApp({projectId,apiKey:'fictional-test-key'},'profile-client-'+randomUUID());
  const client=clientFirestore(app);
  connectFirestoreEmulator(client,'127.0.0.1',8187,{mockUserToken:{sub:owner,user_id:owner,email:'fictional@example.test'}});
  return {app,client};
 });
 try {
  const own=doc(clients[0].client,'users',uid);
  await setDoc(own,{uid,email:'fictional@example.test',displayName:'Initial fictional name'},{merge:true});
  await setDoc(own,{displayName:'Updated fictional name',lastLogin:'2026-10-24T00:00:00Z'},{merge:true});
  assert.deepEqual((await getDoc(own)).data(),{uid,email:'fictional@example.test',displayName:'Updated fictional name',lastLogin:'2026-10-24T00:00:00Z'});
  const foreign=doc(clients[1].client,'users',uid);
  await assert.rejects(getDoc(foreign),{code:'permission-denied'});
  await assert.rejects(setDoc(foreign,{displayName:'Must not be saved'},{merge:true}),{code:'permission-denied'});
  assert.equal((await getDoc(own)).data().displayName,'Updated fictional name');
 } finally {
  for(const {app,client} of clients){await terminate(client);await deleteClientApp(app);}
 }
});

async function historyFixtures(uid,count) {
 const records=Array.from({length:count},(_,index)=>{
  const id='scout-'+randomUUID();
  return {...owned(uid,id),createdAt:new Date(Date.UTC(2026,9,23,0,0,Math.floor(index/25))).toISOString(),pages:[{url:'https://example.com',title:'Fictional capture',screenshots:[{path:'private.png'}]}]};
 });
 const batch=db.batch();for(const record of records)batch.set(db.collection('privateScouts').doc(record.id),record);await batch.commit();
 return records.sort((a,b)=>a.createdAt>b.createdAt?-1:a.createdAt<b.createdAt?1:a.id>b.id?-1:a.id<b.id?1:0);
}

test('history paginates beyond 20 with tied timestamps, no gaps or duplicates and only owner metadata',async()=>{
 const uid=randomUUID(),other=randomUUID(),expected=await historyFixtures(uid,45);
 await historyFixtures(other,12);
 let cursor=null;const all=[],sizes=[];
 do {
  const page=await readScoutHistory(db,uid,cursor);sizes.push(page.scouts.length);all.push(...page.scouts);cursor=page.nextCursor;
 }while(cursor);
 assert.deepEqual(sizes,[20,20,5]);
 assert.deepEqual(all.map(s=>s.id),expected.map(s=>s.id));
 for(const row of all){assert.deepEqual(Object.keys(row).sort(),['createdAt','devices','domain','id','pages','status','url']);assert.deepEqual(row.pages,[{url:'https://example.com',title:'Fictional capture'}]);}
});

test('empty history and an exact full last page return no continuation cursor',async()=>{
 assert.deepEqual(await readScoutHistory(db,randomUUID(),null),{scouts:[],nextCursor:null});
 const uid=randomUUID();await historyFixtures(uid,20);
 const page=await readScoutHistory(db,uid,null);assert.equal(page.scouts.length,20);assert.equal(page.nextCursor,null);
});

test('history position survives a deleted anchor and does not repeat rows when newer scouts arrive',async()=>{
 const uid=randomUUID(),expected=await historyFixtures(uid,45);
 const first=await readScoutHistory(db,uid,null);
 await db.collection('privateScouts').doc(first.scouts.at(-1).id).delete();
 const inserted=owned(uid,'scout-'+randomUUID());inserted.createdAt='2026-10-24T00:00:00.000Z';await db.collection('privateScouts').doc(inserted.id).set(inserted);
 const second=await readScoutHistory(db,uid,first.nextCursor);
 assert.deepEqual(second.scouts.map(s=>s.id),expected.slice(20,40).map(s=>s.id));
 assert.equal((await readScoutHistory(db,uid,null)).scouts[0].id,inserted.id);
});

test('history rejects malformed and cross-account cursors; cursor positions cannot change ownership',async()=>{
 const uid=randomUUID(),other=randomUUID();await historyFixtures(uid,21);await historyFixtures(other,21);
 const page=await readScoutHistory(db,uid,null);
 await assert.rejects(readScoutHistory(db,other,page.nextCursor),{status:400});
 for(const cursor of ['', 'not_json', 'a'.repeat(1025),Buffer.from(JSON.stringify([1,uid,'bad-date','../outside'])).toString('base64url')]) await assert.rejects(readScoutHistory(db,uid,cursor),{status:400});
 const values=JSON.parse(Buffer.from(page.nextCursor,'base64url'));values[1]=other;
 const position=await readScoutHistory(db,other,Buffer.from(JSON.stringify(values)).toString('base64url'));
 for(const result of position.scouts)assert.equal((await db.collection('privateScouts').doc(result.id).get()).data().userId,other);
});

const putObject=async(name)=>{await bucket.file(name).save(Buffer.from('Synthetic deletion fixture'),{resumable:false});};

test('deletion checks ownership before storage and removes only the exact private pack folder across pages',async()=>{
 const uid=randomUUID(),ref=await scout(uid),other=await scout(randomUUID());
 let lists=0;const unreadable={getFiles:async()=>{lists++;throw Error('Must not list');}};
 await assert.rejects(removeScout(db,unreadable,'other-owner',ref.id),{status:404});
 await assert.rejects(removeScout(db,unreadable,uid,'scout-'+randomUUID()),{status:404});
 await assert.rejects(removeScout(db,unreadable,uid,'../outside'),{status:404});
 assert.equal(lists,0);
 const prefix=`private-scouts/${ref.id}/`;
 const keep=[`private-scouts/${other.id}/other.png`,`private-scouts/${ref.id}-sibling/keep.png`,`scouts/${ref.id}/legacy.png`];
 await Promise.all(keep.map(putObject));
 for(let offset=0;offset<205;offset+=20)await Promise.all(Array.from({length:Math.min(20,205-offset)},(_,i)=>putObject(prefix+`orphan-${offset+i}.png`)));
 await removeScout(db,bucket,uid,ref.id);
 assert.equal((await ref.get()).exists,false);
 assert.equal((await bucket.getFiles({prefix}))[0].length,0);
 for(const name of keep){assert.equal((await bucket.file(name).download())[0].toString(),'Synthetic deletion fixture');}
 assert.equal((await other.get()).exists,true);
});

test('active processing blocks deletion; deleting packs reject cached work and stale completion without refunding usage',async()=>{
 for(const kind of ['capture','enhance','copy']) {
  const uid=randomUUID(),ref=await scout(uid),store=workStore(db);
  const result=await store.reserve(uid,kind,kind==='capture'?undefined:ref);
  await assert.rejects(store.beginDeletion(uid,ref),{status:409});
  assert.equal((await ref.get()).data().status,'captured');
  await store.release(result.lease);
  await ref.update({copy:{pitch:'Synthetic'},enhancedAssets:['synthetic.png'],progress:{detail:'Synthetic'}});
  const before=(await accountRef(uid,kind).get()).data();
  await store.beginDeletion(uid,ref);await store.beginDeletion(uid,ref);
  const deleting=(await ref.get()).data();
  assert.equal(deleting.status,'deleting');assert.equal(deleting.textContent,'');assert.equal(deleting.copy,null);assert.deepEqual(deleting.pages,[]);assert.deepEqual(deleting.enhancedAssets,[]);assert.equal(deleting.progress,undefined);
  assert.throws(()=>assertOwner(deleting,uid),{status:404});
  for(const next of ['enhance','copy'])await assert.rejects(store.reserve(uid,next,ref),{status:404});
  await assert.rejects(store.complete(result.lease,ref,{status:'complete'}),{status:404});
  assert.deepEqual((await accountRef(uid,kind).get()).data(),before);
  await removeScout(db,bucket,uid,ref.id);
  assert.deepEqual((await accountRef(uid,kind).get()).data(),before);
 }
});

test('concurrent processing start and deletion cannot both acquire a pack',async()=>{
 for(let n=0;n<4;n++){
  const uid=randomUUID(),ref=await scout(uid),store=workStore(db);
  const results=await Promise.allSettled([store.reserve(uid,'enhance',ref),store.beginDeletion(uid,ref)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  if(results[0].status==='fulfilled'){
   assert.equal(results[1].reason.status,409);await store.release(results[0].value.lease);
  }else{assert.equal(results[0].reason.status,404);}
  await removeScout(db,bucket,uid,ref.id);assert.equal((await ref.get()).exists,false);
 }
});

test('partial object deletion and failed final database writes retain inaccessible retry state',async()=>{
 const uid=randomUUID(),ref=await scout(uid),prefix=`private-scouts/${ref.id}/`;
 await Promise.all(['a.png','b.png'].map(name=>putObject(prefix+name)));
 const failing={getFiles:async options=>{
  const [files]=await bucket.getFiles(options);
  return [files.map(file=>({name:file.name,delete:options=>file.name.endsWith('/b.png')?Promise.reject(Error('Synthetic storage failure')):file.delete(options)}))];
 }};
 await assert.rejects(removeScout(db,failing,uid,ref.id),{status:503});
 assert.equal((await bucket.file(prefix+'a.png').exists())[0],false);
 assert.equal((await bucket.file(prefix+'b.png').exists())[0],true);
 assert.equal((await ref.get()).data().status,'deleting');
 const history=await readScoutHistory(db,uid,null);assert.equal(history.scouts[0].status,'deleting');assert.deepEqual(history.scouts[0].pages,[]);
 await removeScout(db,bucket,uid,ref.id);assert.equal((await ref.get()).exists,false);

 const finalRef=await scout(uid);await putObject(`private-scouts/${finalRef.id}/last.png`);
 let transaction=0;
 const failFinal={collection:name=>db.collection(name),runTransaction:callback=>++transaction===2?Promise.reject(Error('Synthetic database failure')):db.runTransaction(callback)};
 await assert.rejects(removeScout(failFinal,bucket,uid,finalRef.id),{status:503});
 assert.equal((await finalRef.get()).data().status,'deleting');
 assert.equal((await bucket.getFiles({prefix:`private-scouts/${finalRef.id}/` }))[0].length,0);
 await removeScout(db,bucket,uid,finalRef.id);assert.equal((await finalRef.get()).exists,false);
 await workStore(db).finishDeletion(uid,finalRef);
});

test('unexpected storage scope or an unbounded listing cannot broaden or silently finish cleanup',async()=>{
 const uid=randomUUID(),ref=await scout(uid);let deletes=0;
 await assert.rejects(removeScout(db,{getFiles:async()=>[[{name:'outside/keep.png',delete:async()=>{deletes++;}}]]},uid,ref.id),{status:503});
 assert.equal(deletes,0);assert.equal((await ref.get()).data().status,'deleting');
 let lists=0,active=0,maxActive=0;
 const repeating={getFiles:async()=>{lists++;return[Array.from({length:100},(_,i)=>({name:`private-scouts/${ref.id}/${i}.png`,delete:async()=>{active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setImmediate(resolve));active--;deletes++;}}))];}};
 await assert.rejects(removeScout(db,repeating,uid,ref.id),{status:503});
 assert.equal(lists,11);assert.equal(deletes,1000);assert.equal(maxActive,4);assert.equal((await ref.get()).exists,true);
 await removeScout(db,bucket,uid,ref.id);
});

import {accountStateRef} from '../../src/lib/account-state.ts';
import {requestAccountDeletion,processAccountDeletion,recoverInterruptedCapture,INTERRUPTED_AFTER_MS,REVOKED_TOKEN_DRAIN_MS} from '../../src/lib/scout-maintenance.ts';

test('interrupted captures recover after the writer fence, preserve neighbors and cannot be completed by an expired worker',async()=>{
 const uid=randomUUID(),other=randomUUID(),ref=await scout(uid),start=Date.parse('2026-10-24T12:00:00.000Z');
 const store=workStore(db,()=>start),reservation=await store.reserve(uid,'capture');
 await ref.update({status:'capturing',createdAt:new Date(start).toISOString()});
 await assert.rejects(recoverInterruptedCapture(db,other,ref.id,start+INTERRUPTED_AFTER_MS),{status:404});
 assert.equal(await recoverInterruptedCapture(db,uid,ref.id,start+INTERRUPTED_AFTER_MS-1),false);
 assert.equal(await recoverInterruptedCapture(db,uid,ref.id,start+INTERRUPTED_AFTER_MS),true);
 const saved=(await ref.get()).data();assert.equal(saved.status,'failed');assert.equal(saved.progress.progress,-1);
 assert.equal(await recoverInterruptedCapture(db,uid,ref.id,start+INTERRUPTED_AFTER_MS),false);
 await assert.rejects(workStore(db,()=>start+INTERRUPTED_AFTER_MS).complete(reservation.lease,ref,{status:'captured'}),{status:409});
 assert.equal((await ref.get()).data().status,'failed');
});

test('account deletion conflicts with active work and fences reads, cached results and new reservations',async()=>{
 const uid=randomUUID(),ref=await scout(uid),now=Date.now(),store=workStore(db,()=>now);
 const active=await store.reserve(uid,'capture');
 await assert.rejects(requestAccountDeletion(db,uid,now/1000,now),{status:409});
 assert.equal((await accountStateRef(db,uid).get()).exists,false);
 await store.release(active.lease);
 await requestAccountDeletion(db,uid,now/1000,now);
 await requestAccountDeletion(db,uid,now/1000,now);
 const access=createScoutAccess(()=>({db,auth:{verifyIdToken:async()=>({uid})}}));
 await assert.rejects(access.requireScout(new Request('https://app.example',{headers:{Authorization:'Bearer fictional'}}),ref.id),{status:410});
 for(const kind of ['capture','enhance','copy'])await assert.rejects(store.reserve(uid,kind,kind==='capture'?undefined:ref),{status:410});
 assert.equal((await accountRef(uid,'capture').get()).data().attempts,1,'started attempts remain counted');
});

test('account deletion drains only owned packs, waits out client tokens and recovers from identity failure',async()=>{
 const uid=randomUUID(),other=randomUUID(),a=await scout(uid),b=await scout(uid),neighbor=await scout(other),now=Date.now(),events=[];
 const file=ref=>bucket.file(`private-scouts/${ref.id}/fictional.png`);
 for(const ref of [a,b,neighbor])await file(ref).save(Buffer.from('fictional emulator bytes'));
 await db.collection('users').doc(uid).set({displayName:'Fictional lifecycle account'});
 await requestAccountDeletion(db,uid,now/1000,now);
 let failIdentity=true;
 const services={db,bucket,auth:{
  updateUser:async(id,patch)=>{assert.equal(id,uid);assert.equal(patch.disabled,true);events.push('disable');},
  revokeRefreshTokens:async id=>{assert.equal(id,uid);events.push('revoke');},
  deleteUser:async id=>{assert.equal(id,uid);events.push('delete');if(failIdentity)throw Error('Synthetic identity failure');},
 }};
 assert.equal((await processAccountDeletion(services,uid,now)).removedPack,true);
 assert.equal((await processAccountDeletion(services,uid,now)).removedPack,true);
 assert.deepEqual(events,['disable','revoke']);
 assert.equal((await file(neighbor).exists())[0],true);
 assert.equal((await neighbor.get()).exists,true);
 for(const ref of [a,b]){assert.equal((await ref.get()).exists,false);assert.equal((await file(ref).exists())[0],false);}
 assert.equal((await processAccountDeletion(services,uid,now+REVOKED_TOKEN_DRAIN_MS-1)).state,'deleting');
 assert.equal((await db.collection('users').doc(uid).get()).exists,true);
 await assert.rejects(processAccountDeletion(services,uid,now+REVOKED_TOKEN_DRAIN_MS),/Synthetic identity failure/);
 assert.equal((await accountStateRef(db,uid).get()).data().state,'deleting');
 failIdentity=false;assert.equal((await processAccountDeletion(services,uid,now+REVOKED_TOKEN_DRAIN_MS)).state,'complete');
 assert.equal((await processAccountDeletion(services,uid,now+REVOKED_TOKEN_DRAIN_MS+1)).state,'complete');
 assert.equal((await db.collection('users').doc(uid).get()).exists,false);
 assert.equal((await accountStateRef(db,uid).get()).data().uid,null);
});

test('an approved retention plan cannot delete a pack updated after inspection',async()=>{
 const uid=randomUUID(),ref=await scout(uid),version=(await ref.get()).updateTime.toMillis();
 await ref.update({textContent:'New fictional owner edit'});
 await assert.rejects(removeScout(db,bucket,uid,ref.id,version),{status:409});
 assert.equal((await ref.get()).data().status,'captured');
});

import {HISTORY_FIXTURE,applyHistoryFixture,fixtureRecords} from '../../src/lib/history-fixture.ts';
const pagingPlan=uid=>({...HISTORY_FIXTURE,projectId,group:'paging-fixture-'+randomUUID(),ownerScopeHash:createHash('sha256').update(uid).digest('hex'),scoutIds:Array.from({length:45},()=> 'scout-'+randomUUID())});
test('approved metadata fixture yields three private history pages, is idempotent and cleans only its fixed rows',async()=>{
 const uid=randomUUID(),other=randomUUID(),plan=pagingPlan(uid),neighbor=await scout(uid),foreign=await scout(other);
 const original=(await neighbor.get()).data(),otherOriginal=(await foreign.get()).data();
 await assert.rejects(applyHistoryFixture(db,other,'seed',plan),{status:403});
 assert.equal((await applyHistoryFixture(db,uid,'seed',plan)).created,true);
 assert.equal((await applyHistoryFixture(db,uid,'seed',plan)).created,false);
 const ids=[];let cursor=null,counts=[];
 do{const page=await readScoutHistory(db,uid,cursor);counts.push(page.scouts.length);ids.push(...page.scouts.map(item=>item.id));assert.ok(page.scouts.every(item=>!('textContent'in item)));cursor=page.nextCursor;}while(cursor);
 assert.deepEqual(counts,[20,20,6]);assert.equal(new Set(ids).size,46);
 assert.ok(plan.scoutIds.every(id=>ids.includes(id)));assert.ok(!ids.includes(foreign.id));
 assert.equal((await applyHistoryFixture(db,uid,'remove',plan)).removed,45);
 assert.equal((await applyHistoryFixture(db,uid,'remove',plan)).removed,0);
 assert.deepEqual((await neighbor.get()).data(),original);assert.deepEqual((await foreign.get()).data(),otherOriginal);
 await assert.rejects(applyHistoryFixture(db,uid,'seed',plan),{status:410});
});
test('paging fixture ID collision refuses the entire seed and preserves the existing record',async()=>{
 const uid=randomUUID(),plan=pagingPlan(uid),collision=db.collection('privateScouts').doc(plan.scoutIds[0]),existing=owned(randomUUID(),collision.id);
 await collision.create(existing);
 await assert.rejects(applyHistoryFixture(db,uid,'seed',plan),{status:409});
 assert.deepEqual((await collision.get()).data(),existing);
 const snapshots=await db.getAll(...plan.scoutIds.map(id=>db.collection('privateScouts').doc(id)));
 assert.equal(snapshots.filter(snapshot=>snapshot.exists).length,1);
});
test('paging fixture cleanup refuses any changed row before deleting others, then resumes after exact restoration',async()=>{
 const uid=randomUUID(),plan=pagingPlan(uid);await applyHistoryFixture(db,uid,'seed',plan);
 const changed=db.collection('privateScouts').doc(plan.scoutIds[0]);await changed.update({textContent:'A subsequent fictional edit'});
 await assert.rejects(applyHistoryFixture(db,uid,'remove',plan),{status:409});
 const snapshots=await db.getAll(...plan.scoutIds.map(id=>db.collection('privateScouts').doc(id)));
 assert.ok(snapshots.every(snapshot=>snapshot.exists));assert.equal((await changed.get()).data().textContent,'A subsequent fictional edit');
 await changed.set(fixtureRecords(uid,plan)[0]);
 assert.equal((await applyHistoryFixture(db,uid,'remove',plan)).removed,45);
});

import {workerStore,WORKER_COLLECTION} from '../../src/lib/capture-worker-broker.ts';
import {parseCaptureInput,WORKER_LIMITS} from '../../src/lib/capture-worker-contract.ts';
import {planWorkerCleanup,applyWorkerCleanup} from '../../src/lib/capture-worker-cleanup.ts';
import {persistWorkerAsset,workerPng} from '../../src/lib/capture-worker-upload.ts';
import {createWorkerHandler} from '../../src/lib/capture-worker-handler.ts';

import sharp from 'sharp';
const workerKey='ab'.repeat(32);
async function workerFixture(options={}){
 const uid=randomUUID(),id='scout-'+randomUUID(),ref=db.collection('privateScouts').doc(id),clock={now:Date.now()},window='qa-'+randomUUID();
 await ref.set({...owned(uid,id),url:'https://worker-fixture.example.com/',status:'capturing',pages:[],textContent:'',createdAt:new Date(clock.now).toISOString()});
 const usage=workStore(db,()=>clock.now),reserved=await usage.reserve(uid,'capture');
 const input=parseCaptureInput({url:'https://worker-fixture.example.com/',devices:options.devices||['desktop'],...(options.login?{login:options.login}:{})},id);
 const store=workerStore(db,workerKey,()=>clock.now,{id:window,limit:options.limit||20,until:clock.now+1000000});
 const job=await store.create(input,reserved.lease);
 return {uid,id,ref,clock,window,usage,lease:reserved.lease,input,store,job};
}
const pngFixture=()=>sharp({create:{width:1440,height:900,channels:3,background:'#123456'}}).png().toBuffer();
async function storedWorkerShot(f,name='home-desktop-hero.png',save=false){
 const png=await pngFixture(),meta=await workerPng(png),slot=await f.store.beginUpload(f.job.id,f.job.token,name,meta);
 if(save)await persistWorkerAsset(bucket,f.id,slot.name,png,meta.sha256);
 await f.store.finishUpload(f.job.id,f.job.token,slot.name,slot.lock);
 return {path:slot.name,viewport:'desktop',width:1440,height:900,type:name.includes('-full')?'full':'hero'};
}
test('isolated job envelope is private, one-claim-only, and cannot be claimed with another capability',async()=>{
 const f=await workerFixture();
 const saved=await f.store.read(f.job.id);assert.notEqual(saved.capability,f.job.token);assert.equal(saved.state,'queued');
 await assert.rejects(f.store.claim(f.job.id,'a'.repeat(43)),{status:404});
 assert.deepEqual(await f.store.claim(f.job.id,f.job.token),f.input);
 await assert.rejects(f.store.claim(f.job.id,f.job.token),{status:409});
 assert.equal((await f.ref.get()).data().status,'capturing');
});
test('isolated preview execution budget is transactional, cumulative and never reset by failure',async()=>{
 const f=await workerFixture({limit:2});await f.store.close(f.job.id);
 const results=await Promise.allSettled([f.store.create(f.input,f.lease),f.store.create(f.input,f.lease)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,429);
 const budget=await db.collection('privateCaptureWorkerBudgets').doc(f.window).get();assert.equal(budget.data().used,2);
});
test('worker callbacks are fenced by expiry, current reservation and account lifecycle',async()=>{
 const f=await workerFixture();await f.store.claim(f.job.id,f.job.token);
 f.clock.now=f.job.expiresAt;await assert.rejects(f.store.progress(f.job.id,f.job.token,'capture',35),{status:409});
 const g=await workerFixture();await g.store.claim(g.job.id,g.job.token);await g.usage.release(g.lease);
 await assert.rejects(g.store.progress(g.job.id,g.job.token,'capture',35),{status:409});
 const h=await workerFixture();await h.store.claim(h.job.id,h.job.token);await accountStateRef(db,h.uid).set({uid:h.uid,state:'deleting'});
 await assert.rejects(h.store.progress(h.job.id,h.job.token,'capture',35),{status:409});
});
test('worker progress uses bounded server-owned text and cannot move backwards or finish the customer trail',async()=>{
 const f=await workerFixture();await f.store.claim(f.job.id,f.job.token);
 await f.store.progress(f.job.id,f.job.token,'capture',35);
 const p=(await f.ref.get()).data().progress;assert.equal(p.detail,'Capturing website pages...');
 await assert.rejects(f.store.progress(f.job.id,f.job.token,'browser',10),{status:409});
 await assert.rejects(f.store.progress(f.job.id,f.job.token,'done',100),{status:400});
 await db.collection(WORKER_COLLECTION).doc(f.job.id).update({calls:WORKER_LIMITS.calls});
 await assert.rejects(f.store.progress(f.job.id,f.job.token,'capture',40),{status:429});
});
test('upload fence serializes decoding, reserves bytes once, and refuses replacement or another namespace',async()=>{
 const f=await workerFixture();await f.store.claim(f.job.id,f.job.token);
 const meta=await workerPng(await pngFixture());
 const results=await Promise.allSettled([f.store.beginUpload(f.job.id,f.job.token,'home-desktop-hero.png',meta),f.store.beginUpload(f.job.id,f.job.token,'home-desktop-full.png',meta)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 const slot=results.find(r=>r.status==='fulfilled').value;
 await f.store.finishUpload(f.job.id,f.job.token,slot.name,slot.lock);
 const raw=slot.name.slice(39),again=await f.store.beginUpload(f.job.id,f.job.token,raw,meta);assert.equal(again.stored,true);
 assert.equal((await f.store.read(f.job.id)).bytes,meta.bytes);
 await assert.rejects(f.store.beginUpload(f.job.id,f.job.token,raw,{...meta,sha256:'00'.repeat(32)}),{status:409});
 await assert.rejects(f.store.beginUpload(f.job.id,f.job.token,'../foreign.png',meta),{status:400});
 await assert.rejects(f.store.beginUpload(f.job.id,f.job.token,'home-desktop-full.png',{...meta,bytes:WORKER_LIMITS.assetBytes+1}),{status:400});
});
test('worker finish validates saved assets; only the API reservation can commit a private pack',async()=>{
 const f=await workerFixture();await f.store.claim(f.job.id,f.job.token);
 const shots=[await storedWorkerShot(f),await storedWorkerShot(f,'home-desktop-full.png')];
 await assert.rejects(f.store.finish(f.job.id,f.job.token,{pages:[],textContent:'forged',brandColor:'#123456'}),{status:422});
 await f.store.finish(f.job.id,f.job.token,{pages:[{url:f.input.url,title:'Fictional page',screenshots:shots}],textContent:'Fixture text',brandColor:'#123456'});
 const ready=await f.store.read(f.job.id);assert.equal(ready.state,'ready');assert.equal(ready.envelope,null);assert.equal(ready.capability,null);
 assert.equal((await f.ref.get()).data().status,'capturing');
 await f.usage.complete(f.lease,f.ref,{...ready.result,status:'captured'});
 await f.store.close(f.job.id,true);assert.equal((await f.ref.get()).data().status,'captured');
 await assert.rejects(f.usage.complete(f.lease,f.ref,{status:'captured'}),{status:409});
});
test('advanced worker login planning is bounded and redacts credentials again inside the API',async()=>{
 const login={mode:'advanced',url:'https://worker-fixture.example.com/login',username:'fictional-owner@example.test',password:'fictional-password-only',consent:true,aiConsent:true};
 const f=await workerFixture({login});await f.store.claim(f.job.id,f.job.token);
 const fields=[{id:0,form:0,kind:'username',label:login.username+' '+login.password},{id:1,form:0,kind:'password',label:encodeURIComponent(login.password)},{id:2,form:0,kind:'submit',label:'Sign in'}];
 let sent;const planner=async value=>{sent=JSON.stringify(value);return {username:0,password:1,submit:2};};
 await f.store.plan(f.job.id,f.job.token,fields,planner);assert.ok(!sent.includes(login.password));assert.ok(!sent.includes(login.username));
 await f.store.plan(f.job.id,f.job.token,fields,planner);
 await assert.rejects(f.store.plan(f.job.id,f.job.token,fields,planner),{status:400});
});
test('binary callback rejects unsigned/cross-job input before reading or storing PNG bytes',async()=>{
 const f=await workerFixture();await f.store.claim(f.job.id,f.job.token);let writes=0;
 const handler=createWorkerHandler({store:f.store,verify:async r=>{if(r.headers.get('authorization')!=='Bearer fictional')throw Object.assign(Error('Worker identity required.'),{status:401});},save:async()=>{writes++;},planner:async()=>({})});
 const r=new Request('https://broker.example/api',{method:'POST',headers:{Authorization:'Bearer fictional','x-capture-capability':'a'.repeat(43),'Content-Type':'image/png','Content-Length':'1','x-capture-width':'1440','x-capture-height':'900','x-capture-sha256':'00'.repeat(32)},body:new Uint8Array([0])});
 assert.equal((await handler(r,f.job.id,'asset')).status,404);assert.equal(writes,0);
});
test('expired worker cleanup preserves referenced output and neighboring packs; changed plans cannot apply',async()=>{
 const f=await workerFixture();await f.store.claim(f.job.id,f.job.token);
 const keep=await storedWorkerShot(f,'home-desktop-hero.png',true),orphan=await storedWorkerShot(f,'home-desktop-full.png',true);
 await f.ref.update({status:'captured',pages:[{url:f.input.url,title:'Fixture',screenshots:[keep]}]});await f.store.close(f.job.id,true);
 f.clock.now=f.lease.until+60001;
 const plan=await planWorkerCleanup(db,bucket,projectId,f.window,f.clock.now);
 assert.equal(plan.actions[0].objects.length,1);assert.ok(plan.actions[0].objects[0].name.endsWith(orphan.path));
 await f.ref.update({copy:{tagline:'Changed after review'}});
 await assert.rejects(applyWorkerCleanup(db,bucket,projectId,plan,f.clock.now),{status:409});
 const fresh=await planWorkerCleanup(db,bucket,projectId,f.window,f.clock.now);
 const tampered=structuredClone(fresh);tampered.actions[0].objects[0].name='private-scouts/scout-22222222-2222-4222-8222-222222222222/other.png';
 await assert.rejects(applyWorkerCleanup(db,bucket,projectId,tampered,f.clock.now),{status:409});
 assert.deepEqual(await applyWorkerCleanup(db,bucket,projectId,fresh,f.clock.now),{jobs:1,objects:1});
 assert.equal((await bucket.file('private-scouts/'+f.id+'/'+keep.path).exists())[0],true);
 assert.equal((await bucket.file('private-scouts/'+f.id+'/'+orphan.path).exists())[0],false);
 assert.equal((await f.ref.get()).data().status,'captured');
});
test('abandoned encrypted login payloads can be purged after expiry without deleting a pack or active objects',async()=>{
 const login={mode:'basic',url:'https://worker-fixture.example.com/login',username:'fictional',password:'fictional-password',consent:true};
 const f=await workerFixture({login});f.clock.now=f.job.expiresAt+1;
 const plan=await planWorkerCleanup(db,bucket,projectId,f.window,f.clock.now);
 assert.equal(plan.actions[0].mode,'purge-envelope');assert.equal(plan.actions[0].objects.length,0);
 await applyWorkerCleanup(db,bucket,projectId,plan,f.clock.now);
 const j=await f.store.read(f.job.id);assert.equal(j.envelope,null);assert.equal(j.capability,null);
 assert.equal((await f.ref.get()).data().status,'capturing');
 await assert.rejects(f.store.claim(f.job.id,f.job.token),{status:404});
});
