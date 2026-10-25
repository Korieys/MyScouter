"use client";
import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {checkHostedPrivacy,privacyPackIds,type PrivacyReport} from '@/lib/hosted-privacy-checks';
export function HostedPrivacyChecks({user,current}:{user:User;current:()=>boolean}) {
 const [ids,setIds]=useState(''),[owner,setOwner]=useState(''),[report,setReport]=useState<PrivacyReport|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>()=>{pending.current?.abort();pending.current=null;},[]);
 const run=async()=>{
  if(pending.current)return;
  setError('');setReport(null);
  let parsed:string[];try{parsed=privacyPackIds(ids);}catch(reason){setError((reason as Error).message);return;}
  const controller=new AbortController();pending.current=controller;setBusy(true);
  try{const result=await checkHostedPrivacy(user,parsed,owner.trim()||undefined,controller.signal,current);if(!controller.signal.aborted&&current())setReport(result);}
  catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Verification could not finish. Retry.');}
  finally{if(pending.current===controller){pending.current=null;if(!controller.signal.aborted)setBusy(false);}}
 };
 const cancel=()=>{pending.current?.abort();pending.current=null;setBusy(false);setError('Verification canceled. You can retry.');};
 const save=()=>{
  if(!report||!current())return;
  const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  try{link.href=url;link.download='myscouter-hosted-privacy-report.json';document.body.appendChild(link);link.click();}
  finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 };
 return <section aria-label="Hosted privacy verification" className="patch-card" style={{padding:'1.5rem',maxWidth:'960px',margin:'0 auto'}}>
  <h1 className="heading-section">Hosted privacy verification</h1>
  <p>Preview-only checks use this browser’s signed-in test account. Enter completed fictional packs belonging to the first account. The checks request history, metadata, image, ZIP and processing access; they never request deletion.</p>
  <details><summary>Test account identifier</summary><code style={{overflowWrap:'anywhere'}}>{user.uid}</code></details>
  <label htmlFor="privacy-pack-ids">First-account fictional pack IDs (up to three)</label>
  <textarea id="privacy-pack-ids" value={ids} disabled={busy} onChange={event=>setIds(event.target.value)} rows={4} maxLength={250} style={{display:'block',width:'100%',margin:'0.5rem 0 1rem'}}/>
  <label htmlFor="privacy-own-pack">Completed fictional pack owned by this account (optional positive control)</label>
  <input id="privacy-own-pack" value={owner} disabled={busy} onChange={event=>setOwner(event.target.value)} maxLength={42} style={{display:'block',width:'100%',margin:'0.5rem 0 1rem'}}/>
  <button className="btn-scout" disabled={busy} onClick={()=>void run()}>{busy?'Checking access…':'Run privacy checks'}</button>
  {busy&&<button className="btn-outline" onClick={cancel}>Cancel checks</button>}
  {error&&<p role="alert">{error}</p>}
  {report&&<div aria-label="Privacy verification results" style={{marginTop:'1.5rem'}}>
   <p role="status"><strong>{report.passed?'All checks passed':'Verification failed — stop and investigate'}</strong> · {report.checks.length} endpoint checks</p>
   <p>The report contains status codes and a hashed account scope, without tokens or captured page content.</p>
   <div style={{overflowX:'auto'}}><table><thead><tr><th>Check</th><th>HTTP</th><th>Expected</th><th>Result</th></tr></thead><tbody>{report.checks.map(check=><tr key={check.name}><td>{check.name}</td><td>{check.status}</td><td>{check.expected}</td><td>{check.passed?'Pass':'FAIL'}</td></tr>)}</tbody></table></div>
   <button className="btn-outline" onClick={save}>Save verification report</button>
  </div>}
 </section>;
}
