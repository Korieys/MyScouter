import {ScoutError} from './scout-access';
import type {WorkerConfig} from './capture-worker-config';
import type {WorkerStore} from './capture-worker-broker';
import type {CaptureInput} from './capture-worker-contract';
import type {WorkLease} from './work-store';
type Fetcher=typeof fetch;
async function cloudJSON(url:string,body:unknown,token?:string,send:Fetcher=fetch) {
 try{
  const response=await send(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  if(!response.ok)throw Error('Provider request failed');
  const text=await response.text();if(text.length>100000)throw Error('Provider response too large');
  return JSON.parse(text);
 }catch{throw new ScoutError(503,'The isolated capture service is unavailable. Please try again later.');}
}
export async function dispatchToken(config:WorkerConfig,subjectToken:string,send:Fetcher=fetch) {
 if(!subjectToken||subjectToken.length>16384)throw new ScoutError(503,'Capture workload identity is unavailable.');
 const audience='//iam.googleapis.com/projects/'+config.number+'/locations/global/workloadIdentityPools/'+config.pool+'/providers/'+config.provider;
 const federated=await cloudJSON('https://sts.googleapis.com/v1/token',{audience,grantType:'urn:ietf:params:oauth:grant-type:token-exchange',requestedTokenType:'urn:ietf:params:oauth:token-type:access_token',scope:'https://www.googleapis.com/auth/cloud-platform',subjectTokenType:'urn:ietf:params:oauth:token-type:jwt',subjectToken},undefined,send);
 if(typeof federated.access_token!=='string')throw new ScoutError(503,'Capture workload identity is unavailable.');
 const impersonated=await cloudJSON('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+config.dispatcher+':generateAccessToken',{scope:['https://www.googleapis.com/auth/cloud-platform'],lifetime:'600s'},federated.access_token,send);
 if(typeof impersonated.accessToken!=='string')throw new ScoutError(503,'Capture workload identity is unavailable.');
 return impersonated.accessToken as string;
}
export function runJobRequest(config:WorkerConfig,job:{id:string;token:string}) {
 const resource='projects/'+config.project+'/locations/'+config.region+'/jobs/'+config.job;
 return {url:'https://run.googleapis.com/v2/'+resource+':run',body:{etag:config.etag,overrides:{taskCount:1,timeout:'240s',containerOverrides:[{name:'capture',env:[
  {name:'CAPTURE_WORKER_JOB_ID',value:job.id},{name:'CAPTURE_WORKER_CAPABILITY',value:job.token},{name:'CAPTURE_WORKER_BROKER_URL',value:config.broker},
 ]}]}},resource};
}
const pause=(ms:number,signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve();},abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason);};
 const timer=setTimeout(done,ms);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});
export async function runIsolatedCapture(input:CaptureInput,lease:WorkLease,store:WorkerStore,config:WorkerConfig,signal:AbortSignal,
 options:{fetch?:Fetcher;subjectToken?:string;interval?:number;now?:()=>number}={}) {
 const send=options.fetch||fetch,clock=options.now||Date.now,job=await store.create(input,lease);
 let execution:string|undefined,accessToken:string|undefined,ready=false;
 try{
  accessToken=await dispatchToken(config,options.subjectToken||process.env.VERCEL_OIDC_TOKEN||'',send);
  const launch=runJobRequest(config,job),operation=await cloudJSON(launch.url,launch.body,accessToken,send);
  // Never retry :run after an ambiguous response. A duplicate task cannot claim
  // the same envelope, but blindly retrying could still incur container costs.
  const name=operation.metadata?.name;
  if(typeof name==='string'&&name.startsWith(launch.resource+'/executions/')&&/^[a-zA-Z0-9/_-]+$/.test(name))execution=name;
  for(;;){
   signal.throwIfAborted();if(clock()>=job.expiresAt)throw new ScoutError(422,'The isolated capture timed out. Try a smaller page.');
   const current=await store.read(job.id);
   if(current?.state==='ready'&&current.result){ready=true;return {result:current.result,jobId:job.id};}
   if(current?.state==='failed'){
    const failures:Record<string,[number,string]>={'unsupported-login':[422,'Sign-in could not be verified. Use a same-site native form. Single sign-on, verification codes, CAPTCHA and script-only forms are not supported. No guest capture was saved.'],'planner-unavailable':[503,'AI-assisted sign-in is unavailable. Try Basic sign-in.'],'oversize-image':[422,'This screenshot exceeds the isolated worker limit of 3 MiB. Try a shorter page.'],'capture-timeout':[422,'The isolated capture timed out. Try a smaller page.']};
    const [status,message]=failures[current.failure||'']||[503,'The isolated capture could not finish. Please try again.'];throw new ScoutError(status,message);
   }
   if(!current||current.state==='completed')throw new ScoutError(503,'The isolated capture could not finish.');
   await pause(options.interval??1000,signal);
  }
 }finally{
  if(!ready){
   const drainUntil=await store.close(job.id);
   if(execution&&accessToken)await cloudJSON('https://run.googleapis.com/v2/'+execution+':cancel',{},accessToken,send).catch(()=>{});
   const drain=Math.min(30000,Math.max(0,drainUntil-clock()));if(drain)await pause(drain);
  }
 }
}
