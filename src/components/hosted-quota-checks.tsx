"use client";
import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {checkHostedCaptureQuota,type QuotaReport} from '@/lib/hosted-quota-checks';
export function HostedQuotaChecks({user,current}:{user:User;current:()=>boolean}) {
 const [accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[report,setReport]=useState<QuotaReport|null>(null);
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>()=>{pending.current?.abort();pending.current=null;},[]);
 const run=async()=>{
  if(!accepted||pending.current||!current())return;
  const controller=new AbortController();pending.current=controller;setBusy(true);setError('');setReport(null);
  try{const data=await checkHostedCaptureQuota(user,controller.signal,current);if(!controller.signal.aborted&&current())setReport(data);}
  catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Quota verification failed.');}
  finally{if(pending.current===controller){pending.current=null;if(!controller.signal.aborted)setBusy(false);}}
 };
 return <section aria-label="Hosted daily capture quota" className="patch-card" style={{padding:'1.5rem',maxWidth:'960px',margin:'2rem auto'}}>
  <h2>Hosted daily capture quota</h2>
  <p>Run only after completing captures in the dedicated test account. This uses its remaining capture attempts today against the fixed NXDOMAIN fixture, with at most eleven attempts and one rejection replay. It stops before any AI stage. The account may be unable to capture until 00:00 UTC. Saved pack access is checked separately.</p>
  <label><input type="checkbox" disabled={busy} checked={accepted} onChange={event=>setAccepted(event.target.checked)}/> Use this dedicated test account’s remaining capture allowance</label>
  <button className="btn-outline" disabled={!accepted||busy} onClick={()=>void run()}>{busy?'Checking daily quota…':'Run bounded daily-quota check'}</button>
  {busy&&<button className="btn-outline" onClick={()=>{pending.current?.abort();pending.current=null;setBusy(false);setError('Quota check canceled. Started attempts still count.');}}>Cancel quota check</button>}
  {error&&<p role="alert">{error}</p>}
  {report&&<div role="status"><p>{report.passed?'Daily quota and replay checks passed':'Quota verification did not pass'}</p><pre aria-label="Sanitized quota report" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(report,null,2)}</pre></div>}
 </section>;
}
