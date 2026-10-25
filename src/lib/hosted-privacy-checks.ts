import type {User} from 'firebase/auth';
import {authFetch} from './auth-fetch';
const ID=/^scout-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function privacyPackIds(value:string) {
 const ids=[...new Set(value.trim().split(/[\s,]+/).filter(Boolean))];
 if(ids.length<1||ids.length>3||ids.some(id=>!ID.test(id)))throw new Error('Enter one to three valid fictional pack IDs.');
 return ids;
}
export type PrivacyCheck={name:string;status:number;expected:number;type:string;passed:boolean};
export type PrivacyReport={scope:'hosted-preview';startedAt:string;finishedAt:string;accountScopeHash:string;forbiddenPackIds:string[];ownerControlId?:string;passed:boolean;checks:PrivacyCheck[]};
export async function checkHostedPrivacy(user:User,values:string[],ownerControlId:string|undefined,signal:AbortSignal,current:()=>boolean):Promise<PrivacyReport> {
 const ids=privacyPackIds(values.join('\n')),checks:PrivacyCheck[]=[],startedAt=new Date().toISOString();
 if(ownerControlId&&(!ID.test(ownerControlId)||ids.includes(ownerControlId)))throw new Error('The positive control must be a different fictional pack owned by this account.');
 const combined=AbortSignal.any([signal,AbortSignal.timeout(60_000)]);
 let controlError:string|undefined;
 const active=()=>{combined.throwIfAborted();if(!current())throw new Error('The account changed. Start again in the intended test account.');};
 async function bounded<T>(operation:()=>Promise<T>):Promise<T> {
  active();let stop=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{stop=()=>reject(new Error('Verification stopped. Check your session and retry.'));combined.addEventListener('abort',stop,{once:true});});
  try{return await Promise.race([operation(),interrupted]);}finally{combined.removeEventListener('abort',stop);}
 }
 const step=async(name:string,path:string,options:RequestInit,expected:number,kind?:'history'|'missing'|'unavailable'|'owner'|'image',unsigned=false)=>{
  const response=await bounded(()=>unsigned?fetch(path,{...options,signal:combined,cache:'no-store',redirect:'error'}):authFetch(user,path,{...options,signal:combined}));
  try{active();}catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  const type=response.headers.get('content-type')?.split(';')[0]||'';
  let passed=response.status===expected;
  if(kind==='image')passed=passed&&type==='image/png'&&/^[a-f0-9]{64}$/.test(response.headers.get('x-download-sha256')||'');
  if(kind&&kind!=='image'&&passed&&type==='application/json') {
   const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
   const cancel=()=>{void reader?.cancel().catch(()=>{});};combined.addEventListener('abort',cancel,{once:true});
   try {
    if(!reader)throw new Error('Missing verification response');
    for(;;){const chunk=await bounded(()=>reader.read());if(chunk.done)break;size+=chunk.value.length;if(size>65536)throw new Error('Verification response exceeds its limit');chunks.push(chunk.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const data=JSON.parse(new TextDecoder().decode(bytes));
    if(kind==='history')passed=Array.isArray(data.scouts)&&!data.scouts.some((row:{id?:string})=>row&&ids.includes(row.id||''));
    if(kind==='missing'){passed=typeof data.error==='string';controlError=data.error;}
    if(kind==='unavailable')passed=typeof data.error==='string'&&data.error===controlError;
    if(kind==='owner')passed=data.id===ownerControlId;
   }finally{combined.removeEventListener('abort',cancel);await reader?.cancel().catch(()=>{});reader?.releaseLock();}
  } else {
   if(kind&&kind!=='image')passed=false;
   await response.body?.cancel().catch(()=>{});
  }
  if(expected===404&&/zip|image\//.test(type))passed=false;
  checks.push({name,status:response.status,expected,type,passed});return passed;
 };
 const finish=async()=>{
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(user.uid));active();
  return {scope:'hosted-preview' as const,startedAt,finishedAt:new Date().toISOString(),accountScopeHash:Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join(''),forbiddenPackIds:ids,ownerControlId,passed:checks.every(check=>check.passed),checks};
 };
 if(!await step('History excludes first-account packs','/api/scouts',{},200,'history'))return finish();
 if(!await step('Unknown pack is unavailable','/api/scouts/scout-'+crypto.randomUUID(),{},404,'missing'))return finish();
 for(const [index,id]of ids.entries()) {
  const name='First-account pack '+(index+1);
  if(!await step(name+' metadata','/api/scouts/'+id,{},404,'unavailable'))return finish();
  if(!await step(name+' image','/api/assets/'+id+'/home-desktop-hero.png',{},404))return finish();
  const post={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scoutId:id})};
  for(const [route,label]of [['bundle','ZIP'],['enhance','enhancement'],['copy','copy']])if(!await step(name+' '+label,'/api/'+route,post,404))return finish();
 }
 const cursor=btoa(JSON.stringify([1,'fictional-different-owner','2026-10-25T00:00:00.000Z',ids[0]])).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
 if(!await step('Foreign-account history cursor','/api/scouts?cursor='+cursor,{},400))return finish();
 if(!await step('Unsigned history','/api/scouts',{},401,undefined,true))return finish();
 if(!await step('Unsigned image','/api/assets/'+ids[0]+'/home-desktop-hero.png',{},401,undefined,true))return finish();
 if(!await step('Unsigned ZIP','/api/bundle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scoutId:ids[0]})},401,undefined,true))return finish();
 if(!await step('Malformed session','/api/scouts/'+ids[0],{headers:{Authorization:'Bearer fictional-invalid-token'}},401,undefined,true))return finish();
 if(ownerControlId) {
  if(!await step('Own fictional pack metadata','/api/scouts/'+ownerControlId,{},200,'owner'))return finish();
  if(!await step('Own fictional image','/api/assets/'+ownerControlId+'/home-desktop-hero.png',{},200,'image'))return finish();
 }
 return finish();
}
