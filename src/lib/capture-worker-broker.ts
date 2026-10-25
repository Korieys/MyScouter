import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Firestore,Transaction,DocumentReference} from 'firebase-admin/firestore';
import {accountStateRef} from './account-state';
import {ScoutError} from './scout-access';
import {type WorkLease,LIMIT_COLLECTION} from './work-store';
import {SCOUT_COLLECTION} from './scout-server';
import {WORKER_LIMITS,WORKER_PROGRESS,workerId,workerAssetName,validateCaptureResult,parseWorkerInput,type CaptureInput,type CaptureResult} from './capture-worker-contract';
import {capabilityHash,sealWorkerInput,openWorkerInput} from './capture-worker-envelope';
import {redactLoginText,validateLoginPlan,type LoginField,type LoginPlan} from './capture-login';
export const WORKER_COLLECTION='privateCaptureWorkerJobs';
type Asset={sha256:string;bytes:number;width:number;height:number;stored:boolean};
export type WorkerJob={id:string;scoutId:string;uid:string;windowId:string;lease:WorkLease;state:'queued'|'claimed'|'ready'|'completed'|'failed';expiresAt:number;cleanupAfter:number;capability:string|null;envelope:ReturnType<typeof sealWorkerInput>|null;assets:Record<string,Asset>;bytes:number;calls:number;plannerCalls:number;progress:number;uploadUntil:number;uploadToken:string|null;result:CaptureResult|null;failure?:string;cleanedAt?:number};
export type WorkerStore=ReturnType<typeof workerStore>;
export function workerStore(db:Firestore,secret:string,clock:()=>number=Date.now,budget={id:'local-worker-test',limit:20,until:Number.MAX_SAFE_INTEGER}) {
 const ref=(id:string)=>db.collection(WORKER_COLLECTION).doc(workerId(id));
 async function locked(tx:Transaction,jobRef:DocumentReference,token:string,states:WorkerJob['state'][]) {
  const snap=await tx.get(jobRef),j=snap.data() as WorkerJob|undefined,now=clock();
  if(!j||!j.capability||capabilityHash(token)!==j.capability)throw new ScoutError(404,'Worker job unavailable.');
  const refs=[db.collection(SCOUT_COLLECTION).doc(j.scoutId),accountStateRef(db,j.uid),
   db.collection(LIMIT_COLLECTION).doc('account-'+createHash('sha256').update(j.uid).digest('hex')+'-capture'),
   db.collection(LIMIT_COLLECTION).doc('global-capture')];
  const [scout,account,perAccount,global]=await tx.getAll(...refs);
  if(j.expiresAt<=now||j.lease.until<=now||!states.includes(j.state)||account.exists||scout.data()?.userId!==j.uid||scout.data()?.status!=='capturing'||
  ![perAccount,global].every(s=>s.data()?.active?.some((a:{token:string;until:number})=>a.token===j.lease.token&&a.until>now)))throw new ScoutError(409,'Worker authorization expired.');
  if(j.calls>=WORKER_LIMITS.calls)throw new ScoutError(429,'Worker request budget reached.');
  return {j,scout:refs[0],now};
 }
 return {
  async create(input:CaptureInput,lease:WorkLease) {
   const id=randomUUID(),token=randomBytes(32).toString('base64url'),now=clock();
   const job:WorkerJob={id,windowId:budget.id,scoutId:input.id,uid:lease.uid,lease,state:'queued',expiresAt:Math.min(now+WORKER_LIMITS.expiresMs,lease.until,budget.until),cleanupAfter:lease.until+60000,capability:capabilityHash(token),envelope:sealWorkerInput(id,input,secret),assets:{},bytes:0,calls:0,plannerCalls:0,progress:5,uploadUntil:0,uploadToken:null,result:null};
   await db.runTransaction(async tx=>{
    const budgetRef=db.collection('privateCaptureWorkerBudgets').doc(budget.id),snapshot=await tx.get(budgetRef),used=snapshot.data()?.used??0;
    if(!Number.isSafeInteger(used)||used<0||used>=Math.min(20,budget.limit)||now>=budget.until)throw new ScoutError(429,'The isolated preview execution window is closed.');
    const [scout,account,own,global]=await tx.getAll(db.collection(SCOUT_COLLECTION).doc(input.id),accountStateRef(db,lease.uid),
     db.collection(LIMIT_COLLECTION).doc('account-'+createHash('sha256').update(lease.uid).digest('hex')+'-capture'),db.collection(LIMIT_COLLECTION).doc('global-capture'));
    if(lease.kind!=='capture'||lease.until<=now||account.exists||scout.data()?.userId!==lease.uid||scout.data()?.status!=='capturing'||
     ![own,global].every(s=>s.data()?.active?.some((a:{token:string;until:number})=>a.token===lease.token&&a.until>now)))throw new ScoutError(409,'Worker reservation unavailable.');
    tx.create(ref(id),job);tx.set(budgetRef,{used:used+1,until:budget.until});
   });return {id,token,expiresAt:job.expiresAt};
  },
  async claim(id:string,token:string) {
   return db.runTransaction(async tx=>{const {j}=await locked(tx,ref(id),token,['queued']);const input=parseWorkerInput(openWorkerInput(id,j.envelope!,secret));tx.update(ref(id),{state:'claimed',calls:j.calls+1});return input;});
  },
  async progress(id:string,token:string,step:unknown,progress:unknown) {
   const p=typeof step==='string'?WORKER_PROGRESS[step]:undefined;
   if(!p||typeof progress!=='number'||!Number.isInteger(progress)||progress<p.min||progress>p.max)throw new ScoutError(400,'Invalid worker progress.');
   await db.runTransaction(async tx=>{const {j,scout,now}=await locked(tx,ref(id),token,['claimed']);if(progress<j.progress)throw new ScoutError(409,'Worker progress cannot move backwards.');
    tx.update(ref(id),{calls:j.calls+1,progress});tx.update(scout,{progress:{step,detail:p.detail,progress,timestamp:now}});});
  },
  async beginUpload(id:string,token:string,raw:string,data:{sha256:string;bytes:number;width:number;height:number}) {
   if(!/^[a-f0-9]{64}$/.test(data.sha256)||!Number.isSafeInteger(data.bytes)||data.bytes<1||data.bytes>WORKER_LIMITS.assetBytes||!Number.isSafeInteger(data.width)||!Number.isSafeInteger(data.height)||data.width<1||data.width>1440||data.height<1||data.height>12000)throw new ScoutError(400,'Invalid worker image metadata.');
   return db.runTransaction(async tx=>{
    const {j,now}=await locked(tx,ref(id),token,['claimed']),input=parseWorkerInput(openWorkerInput(id,j.envelope!,secret)),name=workerAssetName(id,raw,input.devices),old=j.assets[name];
    if(old&&(old.sha256!==data.sha256||old.bytes!==data.bytes||old.width!==data.width||old.height!==data.height))throw new ScoutError(409,'A worker asset cannot be replaced.');
    if(old?.stored){tx.update(ref(id),{calls:j.calls+1});return {name,stored:true,lock:''};}
    if(j.uploadUntil>now)throw new ScoutError(409,'Wait for the current upload to finish.');
    if(!old&&(Object.keys(j.assets).length>=WORKER_LIMITS.assets||j.bytes+data.bytes>WORKER_LIMITS.totalBytes))throw new ScoutError(422,'This capture exceeds its isolated storage budget.');
    const lock=randomUUID();tx.update(ref(id),{assets:{...j.assets,[name]:{...data,stored:false}},bytes:j.bytes+(old?0:data.bytes),uploadUntil:now+30000,uploadToken:lock,calls:j.calls+1});
    return {name,stored:false,lock};
   });
  },
  async finishUpload(id:string,token:string,name:string,lock:string) {
   await db.runTransaction(async tx=>{const {j}=await locked(tx,ref(id),token,['claimed']);if(!j.assets[name]||j.uploadToken!==lock)throw new ScoutError(409,'Upload unavailable.');
    tx.update(ref(id),{assets:{...j.assets,[name]:{...j.assets[name],stored:true}},uploadUntil:0,uploadToken:null});});
  },
  async releaseUpload(id:string,lock:string) {await db.runTransaction(async tx=>{const s=await tx.get(ref(id));if(s.data()?.uploadToken===lock)tx.update(ref(id),{uploadUntil:0,uploadToken:null});}).catch(()=>{});},
  async plan(id:string,token:string,value:unknown,planner:(fields:LoginField[])=>Promise<LoginPlan>) {
   const fields=await db.runTransaction(async tx=>{
    const {j}=await locked(tx,ref(id),token,['claimed']),input=parseWorkerInput(openWorkerInput(id,j.envelope!,secret));
    if(input.login?.mode!=='advanced'||j.plannerCalls>=2||!Array.isArray(value)||!value.length||value.length>36)throw new ScoutError(400,'Invalid login-field request.');
    const ids=new Set<number>();const fields:LoginField[]=value.map(f=>{
     if(!f||typeof f!=='object'||Object.keys(f).some(k=>!['id','form','kind','label'].includes(k))||!Number.isInteger(f.id)||f.id<0||f.id>35||ids.has(f.id)||!Number.isInteger(f.form)||f.form<0||f.form>11||!['username','password','submit'].includes(f.kind)||typeof f.label!=='string'||f.label.length>120)throw new ScoutError(400,'Invalid login fields.');
     ids.add(f.id);
     // The planner receives structure only. Page labels and credential values never enter its input.
     return {id:f.id,form:f.form,kind:f.kind,label:f.kind};
    });tx.update(ref(id),{plannerCalls:j.plannerCalls+1,calls:j.calls+1});return fields;
   });
   const selected=validateLoginPlan(await planner(fields),fields);
   await db.runTransaction(async tx=>{await locked(tx,ref(id),token,['claimed']);});
   return selected;
  },
  async finish(id:string,token:string,value:unknown) {
   await db.runTransaction(async tx=>{const {j}=await locked(tx,ref(id),token,['claimed']),input=parseWorkerInput(openWorkerInput(id,j.envelope!,secret));
    if(j.uploadUntil>clock())throw new ScoutError(409,'An upload is still in progress.');
    const result=validateCaptureResult(value,input,id,j.assets);
    if(input.login){result.textContent=redactLoginText(result.textContent,input.login);result.pages=result.pages.map(p=>({...p,title:redactLoginText(p.title,input.login!)}));}
    tx.update(ref(id),{state:'ready',result,envelope:null,capability:null,calls:j.calls+1});});
  },
  async fail(id:string,token:string,code:unknown) {
   if(!['unsupported-login','planner-unavailable','oversize-image','capture-timeout','capture-unavailable'].includes(String(code)))throw new ScoutError(400,'Invalid worker failure.');
   await db.runTransaction(async tx=>{const {j}=await locked(tx,ref(id),token,['claimed']);tx.update(ref(id),{state:'failed',failure:code,envelope:null,capability:null,result:null,calls:j.calls+1});});
  },
  async read(id:string) {return (await ref(id).get()).data() as WorkerJob|undefined;},
  async close(id:string,completed=false) {
   return db.runTransaction(async tx=>{const snap=await tx.get(ref(id));const j=snap.data() as WorkerJob|undefined;if(!j)return 0;
    tx.update(ref(id),{state:completed?'completed':'failed',envelope:null,capability:null,result:null});return j.uploadUntil;});
  },
 };
}
