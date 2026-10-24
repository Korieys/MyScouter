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
