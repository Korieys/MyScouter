import {NextRequest,NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {getAdmin} from '@/lib/firebase-admin';
import {requireUser,saveAsset,SCOUT_COLLECTION} from '@/lib/scout-server';
import {errorResponse,publicScout,readInput,validProgressId,type ScoutRecord} from '@/lib/scout-access';
import {resolvePublic,publicUrl} from '@/lib/public-network';
import {emitProgress} from '@/lib/progress';
import {workStore} from '@/lib/work-store';
import {parseCaptureInput,type CaptureResult} from '@/lib/capture-worker-contract';
import {captureMode,workerConfig,assertWorkerAccount,assertWorkerLoginPolicy} from '@/lib/capture-worker-config';
import {workerStore,type WorkerStore} from '@/lib/capture-worker-broker';
import {runIsolatedCapture} from '@/lib/capture-worker-dispatch';
export const maxDuration=300;
export async function POST(req:NextRequest) {
 const scoutId='scout-'+randomUUID(),createdAt=new Date().toISOString();
 let recordCreated=false,captureSaved=false,release:(()=>Promise<void>)|undefined,workerId:string|undefined,broker:WorkerStore|undefined;
 try{
  const uid=await requireUser(req),body=await readInput(req),input=parseCaptureInput(body,scoutId);
  const mode=captureMode(),config=mode==='cloud-run-jobs'?workerConfig():undefined;
  if(config){assertWorkerAccount(uid,config);assertWorkerLoginPolicy(input,body);}
  const progressJobId=body.jobId===undefined?'job-'+randomUUID():validProgressId(body.jobId);
  const admin=getAdmin(),store=workStore(admin.db),reservation=await store.reserve(uid,'capture');
  if(reservation.cached)throw Error('Unexpected capture reservation');
  release=()=>store.release(reservation.lease);
  const existing=await admin.db.collection(SCOUT_COLLECTION).where('userId','==',uid).where('progressJobId','==',progressJobId).limit(1).get();
  if(!existing.empty)throw new (await import('@/lib/scout-access')).ScoutError(409,'This scout request has already started. Open your saved scouts or start a new request.');
  await resolvePublic(publicUrl(input.url));
  await admin.db.collection(SCOUT_COLLECTION).doc(scoutId).create({id:scoutId,userId:uid,url:input.url,domain:new URL(input.url).hostname,brandColor:input.brandColor,devices:input.devices,progressJobId,status:'capturing',pages:[],enhancedAssets:[],copy:null,textContent:'',createdAt});
  recordCreated=true;await emitProgress(scoutId,'init','Preparing scout...',5);
  let result:CaptureResult;
  if(config){
   broker=workerStore(admin.db,config.key,Date.now,config.budget);
   const remote=await runIsolatedCapture(input,reservation.lease,broker,config,AbortSignal.timeout(270000));
   result=remote.result;workerId=remote.jobId;
  }else{
   const {captureWebsite}=await import('@/lib/capture-engine');
   result=await captureWebsite(input,{save:saveAsset,progress:(step,detail,progress)=>emitProgress(scoutId,step,detail,progress)});
  }
  const record:ScoutRecord={id:scoutId,userId:uid,url:input.url,domain:new URL(input.url).hostname,brandColor:result.brandColor,pages:result.pages,textContent:result.textContent,devices:input.devices,status:'captured',enhancedAssets:[],copy:null,createdAt};
  await store.complete(reservation.lease,admin.db.collection(SCOUT_COLLECTION).doc(scoutId),record);captureSaved=true;release=undefined;
  if(workerId)await broker?.close(workerId,true).catch(()=>{});
  await emitProgress(scoutId,'complete','Capture saved. Preparing assets...',70).catch(()=>{});
  return NextResponse.json(publicScout(record),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){
  if(workerId)await broker?.close(workerId).catch(()=>{});
  if(recordCreated&&!captureSaved){await getAdmin().db.collection(SCOUT_COLLECTION).doc(scoutId).update({status:'failed'}).catch(()=>{});await emitProgress(scoutId,'error','The capture could not finish. Please try again.',-1).catch(()=>{});}
  return errorResponse(error,'The website could not be captured. Check its address and try again.');
 }finally{await release?.().catch(()=>{});}
}
