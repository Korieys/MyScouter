import {randomUUID} from 'node:crypto';
import type {Firestore,Timestamp} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {WORKER_COLLECTION,type WorkerJob} from './capture-worker-broker';
import {workerId} from './capture-worker-contract';
import {recordedAssets,validScoutId,ScoutError,type ScoutRecord} from './scout-access';
type Version={seconds:number;nanoseconds:number};
const version=(t:Timestamp|undefined):Version|null=>t?{seconds:t.seconds,nanoseconds:t.nanoseconds}:null;
const same=(a:Version|null,b:Version|null)=>JSON.stringify(a)===JSON.stringify(b);
export type WorkerCleanupPlan={project:string;window:string;createdAt:number;actions:{id:string;version:Version;scoutVersion:Version|null;mode:'purge-envelope'|'orphan-assets';objects:{name:string;generation:string}[]}[]};
export async function planWorkerCleanup(db:Firestore,bucket:Bucket,project:string,window:string,now=Date.now()):Promise<WorkerCleanupPlan> {
 if(!/^[a-zA-Z0-9-]{1,64}$/.test(window))throw Error('Invalid worker window.');
 const docs=await db.collection(WORKER_COLLECTION).where('windowId','==',window).limit(20).get();
 const plan:WorkerCleanupPlan={project,window,createdAt:now,actions:[]};
 for(const snap of docs.docs){
  const j=snap.data() as WorkerJob;if(j.expiresAt>now)continue;
  const record=await db.collection('privateScouts').doc(validScoutId(j.scoutId)).get();
  const r=record.data() as ScoutRecord|undefined;
  if(r&&r.userId!==j.uid)throw new ScoutError(409,'Worker ownership changed. Review manually.');
  if(now<j.cleanupAfter){if(j.envelope||j.capability)plan.actions.push({id:j.id,version:version(snap.updateTime)!,scoutVersion:version(record.updateTime),mode:'purge-envelope',objects:[]});continue;}
  const prefix='private-scouts/'+j.scoutId+'/w-'+workerId(j.id)+'-',keep=new Set(r?recordedAssets(r):[]);
  const [files,,response]=await bucket.getFiles({prefix,autoPaginate:false,maxResults:91});
  if(files.length>90||(response as {nextPageToken?:string})?.nextPageToken||files.some(file=>!file.name.startsWith(prefix)||!j.assets[file.name.slice(('private-scouts/'+j.scoutId+'/').length)]))throw new ScoutError(409,'Unexpected worker cleanup scope.');
  const objects=[];
  for(const file of files){
   if(keep.has(file.name.slice(('private-scouts/'+j.scoutId+'/').length)))continue;
   const generation=String(file.metadata?.generation||'');
   if(!/^[0-9]+$/.test(generation))throw new ScoutError(409,'Worker object generation unavailable.');
   objects.push({name:file.name,generation});
  }
  if(objects.length||j.envelope||j.capability||!j.cleanedAt)plan.actions.push({id:j.id,version:version(snap.updateTime)!,scoutVersion:version(record.updateTime),mode:'orphan-assets',objects});
 }
 return plan;
}
export async function applyWorkerCleanup(db:Firestore,bucket:Bucket,project:string,plan:WorkerCleanupPlan,now=Date.now()) {
 if(plan.project!==project||!Number.isSafeInteger(plan.createdAt)||plan.createdAt>now+5000||now-plan.createdAt>3600000||!Array.isArray(plan.actions)||plan.actions.length>20)throw new ScoutError(409,'Review a fresh worker cleanup plan for this project.');
 for(const action of plan.actions){
  const ref=db.collection(WORKER_COLLECTION).doc(workerId(action.id)),lock=randomUUID();
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ref),j=snap.data() as WorkerJob|undefined;
   if(!j||j.windowId!==plan.window||j.expiresAt>now||!same(version(snap.updateTime),action.version))throw new ScoutError(409,'The worker job changed after inspection.');
   const scout=await tx.get(db.collection('privateScouts').doc(validScoutId(j.scoutId))),r=scout.data() as ScoutRecord|undefined;
   if(!same(version(scout.updateTime),action.scoutVersion)||(r&&r.userId!==j.uid)||!['purge-envelope','orphan-assets'].includes(action.mode)||!Array.isArray(action.objects)||action.objects.length>90)throw new ScoutError(409,'The pack changed after inspection.');
   const prefix='private-scouts/'+j.scoutId+'/w-'+j.id+'-',keep=new Set(r?recordedAssets(r):[]);
   if(action.mode==='purge-envelope'&&action.objects.length||action.mode==='orphan-assets'&&now<j.cleanupAfter||
    action.objects.some(o=>!o.name.startsWith(prefix)||!j.assets[o.name.slice(('private-scouts/'+j.scoutId+'/').length)]||keep.has(o.name.slice(('private-scouts/'+j.scoutId+'/').length))||!/^\d+$/.test(o.generation)))throw new ScoutError(409,'Worker cleanup scope is unavailable.');
   tx.update(ref,{envelope:null,capability:null,result:null,state:j.state==='completed'?'completed':'failed',cleanupLock:lock});
  });
  for(const object of action.objects)await bucket.file(object.name,{generation:object.generation}).delete({ignoreNotFound:true});
  await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.data()?.cleanupLock!==lock)throw new ScoutError(409,'Worker cleanup lock changed.');tx.update(ref,{cleanupLock:null,cleanedAt:now});});
 }
 return {jobs:plan.actions.length,objects:plan.actions.reduce((n,a)=>n+a.objects.length,0)};
}
