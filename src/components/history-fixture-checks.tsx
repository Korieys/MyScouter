"use client";
import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {authFetch,jsonResult} from '@/lib/auth-fetch';
type Status={enabled:boolean;state:string;count:number;group:string;expiresAt:string};
export function HistoryFixtureChecks({user,current}:{user:User;current:()=>boolean}) {
 const [state,setState]=useState<Status|null>(null),[confirmation,setConfirmation]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  void authFetch(user,'/api/readiness/history-fixture',{signal:controller.signal}).then(jsonResult).then(data=>{if(!controller.signal.aborted&&current())setState(data);}).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Fixture status unavailable.');});
  return()=>{controller.abort();pending.current?.abort();pending.current=null;};
 },[user,current]);
 const expected=state?.state==='seeded'?'REMOVE 45 FIXTURES':'CREATE 45 FIXTURES';
 const apply=async()=>{
  if(!state?.enabled||state.state==='removed'||confirmation!==expected||pending.current||!current())return;
  const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
  try {
   const result=await jsonResult(await authFetch(user,'/api/readiness/history-fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:state.state==='seeded'?'remove':'seed',confirmation}),signal:controller.signal}));
   if(!controller.signal.aborted&&current()){setState(previous=>previous?{...previous,state:result.state}:previous);setConfirmation('');}
  }catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Fixture action could not be confirmed. Refresh before retrying.');}
  finally{if(pending.current===controller){pending.current=null;if(!controller.signal.aborted)setBusy(false);}}
 };
 return <section aria-label="Approved paging fixture" className="patch-card" style={{padding:'1.5rem',maxWidth:'960px',margin:'2rem auto'}}>
  <h2>Approved paging fixture</h2>
  <p>This separate test window creates only 45 explicitly listed metadata records for the bound test account, with no screenshots, AI work or quota changes. They are marked failed fictional captures. Removal is irreversible and must be approved separately at action time.</p>
  {state&&<p role="status">Fixture state: <strong>{state.state}</strong> · window {state.enabled?'enabled':'disabled'} · expires {state.expiresAt}</p>}
  {error&&<p role="alert">{error}</p>}
  {state?.enabled&&state.state!=='removed'&&<>
   <label htmlFor="fixture-confirmation">Type {expected}</label>
   <input id="fixture-confirmation" disabled={busy} value={confirmation} onChange={event=>setConfirmation(event.target.value)} style={{display:'block',width:'100%',margin:'0.5rem 0 1rem'}}/>
   <button className="btn-outline" disabled={busy||confirmation!==expected} onClick={()=>void apply()}>{busy?'Applying fixture action…':state.state==='seeded'?'Remove only the 45 fixture records':'Create the 45 fixture records'}</button>
  </>}
 </section>;
}
