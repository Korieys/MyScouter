import {createHash} from 'node:crypto';
import {ScoutError} from './scout-access';
export function captureMode(env:NodeJS.ProcessEnv=process.env) {
 const mode=env.CAPTURE_WORKER_MODE||'inline';
 if(!['inline','cloud-run-jobs'].includes(mode))throw new ScoutError(503,'Capture configuration is unavailable.');
 if(mode==='cloud-run-jobs'&&(env.VERCEL_ENV!=='preview'||env.CAPTURE_WORKER_ENABLED!=='true'))throw new ScoutError(503,'The isolated capture preview is not enabled.');
 return mode as 'inline'|'cloud-run-jobs';
}
export function workerConfig(env:NodeJS.ProcessEnv=process.env,now=Date.now()) {
 if(env.VERCEL_ENV!=='preview')throw new ScoutError(404,'Worker endpoint unavailable.');
 if(captureMode(env)!=='cloud-run-jobs')throw new ScoutError(404,'Worker endpoint unavailable.');
 const project=env.CAPTURE_WORKER_PROJECT,number=env.CAPTURE_WORKER_PROJECT_NUMBER,region=env.CAPTURE_WORKER_REGION;
 const job=env.CAPTURE_WORKER_JOB,dispatcher=env.CAPTURE_WORKER_DISPATCHER;
 const runtime=env.CAPTURE_WORKER_RUNTIME_EMAIL,subject=env.CAPTURE_WORKER_RUNTIME_SUBJECT,broker=env.CAPTURE_WORKER_BROKER_URL;
 const accountHash=env.CAPTURE_WORKER_ACCOUNT_HASH;const windowEnd=env.CAPTURE_WORKER_WINDOW_END;const windowId=env.CAPTURE_WORKER_WINDOW_ID;const etag=env.CAPTURE_WORKER_JOB_ETAG; const key=env.CAPTURE_WORKER_ENVELOPE_KEY,pool=env.CAPTURE_WORKER_WIF_POOL,provider=env.CAPTURE_WORKER_WIF_PROVIDER;
 const bad=()=>new ScoutError(503,'Isolated capture configuration is incomplete.');
 if(!project||env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!==project||! /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)||!number||!/^\d{6,20}$/.test(number)||!region||! /^[a-z]+-[a-z]+\d$/.test(region)||
 !job||! /^[a-z][a-z0-9-]{0,61}$/.test(job)||!dispatcher||dispatcher!=='myscouter-preview-dispatch@'+project+'.iam.gserviceaccount.com'||
 runtime!=='myscouter-preview-capture@'+project+'.iam.gserviceaccount.com'||!subject||!/^\d{10,30}$/.test(subject)||
 !key||! /^[a-f0-9]{64}$/.test(key)||!pool||! /^[a-z][a-z0-9-]{3,31}$/.test(pool)||!provider||! /^[a-z][a-z0-9-]{3,31}$/.test(provider)||!broker||!etag||etag.length>256||!accountHash||!/^[a-f0-9]{64}$/.test(accountHash)||windowId!=='isolation-preview-2026-10-25'||windowEnd!=='2026-10-27T00:00:00.000Z'||Date.parse(windowEnd)<=now)throw bad();
 const url=new URL(broker);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port||url.pathname!=='/api/capture-worker')throw bad();
 return {project,number,region,job,dispatcher,runtime,subject,broker:url.href,key,pool,provider,etag,accountHash,budget:{id:windowId,limit:20,until:Date.parse(windowEnd)}};
}
export type WorkerConfig=ReturnType<typeof workerConfig>;

export function assertWorkerAccount(uid:string,config:WorkerConfig){if(createHash('sha256').update(uid).digest('hex')!==config.accountHash)throw new ScoutError(403,'The isolated preview is limited to its dedicated test account.');}

// The first hosted worker window is public-only. Encrypted credential retention
// needs its own approved disclosure and explicit request consent before activation.
export function assertWorkerLoginPolicy(input:{login?:unknown},body:Record<string,unknown>,env:NodeJS.ProcessEnv=process.env){
 if(!input.login)return;
 const login=body.login as {temporaryStorageConsent?:unknown}|undefined;
 if(env.CAPTURE_WORKER_LOGIN_ENABLED!=='true'||login?.temporaryStorageConsent!==true)throw new ScoutError(503,'Website sign-in on this preview is not available yet. Capture a public page for now.');
}
