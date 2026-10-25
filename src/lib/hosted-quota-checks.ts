import type {User} from 'firebase/auth';
import {authFetch} from './auth-fetch';
export const QUOTA_FIXTURE_URL='https://scout-quota-fixture.example.com';
export type QuotaReport={fixture:string;startedAt:string;finishedAt:string;passed:boolean;attemptStatuses:number[];replayStatus:number|null;retryAfterSeconds:number|null;historyFirstPageUnchanged:boolean;message:string};
export async function checkHostedCaptureQuota(user:User,signal:AbortSignal,current:()=>boolean):Promise<QuotaReport> {
 const startedAt=new Date().toISOString(),combined=AbortSignal.any([signal,AbortSignal.timeout(90_000)]),attemptStatuses:number[]=[];
 let replayStatus:number|null=null,retryAfterSeconds:number|null=null,message='';
 const active=()=>{combined.throwIfAborted();if(!current())throw Error('The account changed. Stop quota testing.');};
 async function request(path:string,options:RequestInit={}) {
  active();let stop=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{stop=()=>reject(Error('Quota check stopped. Check the test account before retrying.'));combined.addEventListener('abort',stop,{once:true});});
  try {const response=await Promise.race([authFetch(user,path,{...options,signal:combined}),interrupted]);active();return response;}
  finally{combined.removeEventListener('abort',stop);}
 }
 const history=async()=>{const response=await request('/api/scouts');if(!response.ok)throw Error('Cannot verify owned history.');const data=await response.json();active();if(!Array.isArray(data.scouts))throw Error('Invalid history response.');return data.scouts.map((row:{id:string})=>row.id);};
 const before=await history();
 const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:QUOTA_FIXTURE_URL,devices:['desktop']})};
 let daily=false;
 for(let attempt=0;attempt<11;attempt++) {
  const response=await request('/api/scout',options);attemptStatuses.push(response.status);
  if(response.status===429) {
   const data=await response.json();active();message=typeof data.error==='string'?data.error:'';
   const text=response.headers.get('retry-after')||'';
   retryAfterSeconds=/^[1-9][0-9]*$/.test(text)?Number(text):null;
   daily=message.startsWith('Your daily capture attempt limit')&&retryAfterSeconds!==null&&retryAfterSeconds<=86400;
   if(daily){const replay=await request('/api/scout',options);replayStatus=replay.status;await replay.body?.cancel().catch(()=>{});}
   break;
  }
  // NXDOMAIN must fail before a browser or AI stage; stop on any other response.
  await response.body?.cancel().catch(()=>{});
  if(response.status!==503){message='Unexpected fixture response; no further attempts were made.';break;}
 }
 const after=await history(),historyFirstPageUnchanged=JSON.stringify(before)===JSON.stringify(after);active();
 return {fixture:QUOTA_FIXTURE_URL,startedAt,finishedAt:new Date().toISOString(),passed:daily&&replayStatus===429&&historyFirstPageUnchanged,attemptStatuses,replayStatus,retryAfterSeconds,historyFirstPageUnchanged,message};
}
