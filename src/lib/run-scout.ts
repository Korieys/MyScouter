import type {User} from 'firebase/auth';
import {authFetch,jsonResult} from './auth-fetch';

export type ScoutProgress = {step:string; detail:string; progress:number};
async function scoutRequest(user:User,path:string,options:RequestInit,signal:AbortSignal,timeout:number) {
    const bounded=AbortSignal.any([signal,AbortSignal.timeout(timeout)]);
    bounded.throwIfAborted();
    let abort:()=>void=()=>{};
    const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(bounded.reason);bounded.addEventListener('abort',abort,{once:true});});
    try {return await Promise.race([authFetch(user,path,{...options,signal:bounded}),cancelled]);}
    finally {bounded.removeEventListener('abort',abort);}
}
export function forwardProgress(previous:ScoutProgress|null, incoming:ScoutProgress):ScoutProgress|null {
    if (!incoming || typeof incoming.step!=='string' || typeof incoming.detail!=='string' || !Number.isFinite(incoming.progress) || incoming.progress<0 || incoming.progress>100) return previous;
    return previous && incoming.progress<previous.progress ? previous : incoming;
}

// Start observing before the long POST. Polls use the same authenticated access
// as the saved pack; a not-yet-created record is expected during startup.
export async function runScout(user:User, input:Record<string,unknown>, update:(value:ScoutProgress)=>void, signal:AbortSignal, interval=1500) {
    const jobId=`job-${crypto.randomUUID()}`;
    const polling=new AbortController();
    const abort=()=>polling.abort();
    signal.addEventListener('abort',abort,{once:true});
    let last:ScoutProgress|null=null;
    const report=(value:ScoutProgress)=>{
        signal.throwIfAborted();
        last=forwardProgress(last,value);
        if(last)update(last);
    };
    const pause=()=>new Promise<void>(resolve=>{
        const done=()=>{clearTimeout(timer);polling.signal.removeEventListener('abort',done);resolve();};
        const timer=setTimeout(done,interval);
        polling.signal.addEventListener('abort',done,{once:true});
        if(polling.signal.aborted)done();
    });
    const watch=(async()=>{
        for(let count=0;count<400 && !polling.signal.aborted;count++) {
            try {
                const response=await scoutRequest(user,`/api/scout/progress?jobId=${jobId}`,{},polling.signal,10000);
                if(response.ok) {
                    const data=await response.json();
                    // Only the coordinator may finish, after the copy request.
                    if(!polling.signal.aborted && data.progress && data.progress.progress<95)report(data.progress);
                }
            } catch { /* A transient progress failure must not duplicate a capture. */ }
            if(!polling.signal.aborted)await pause();
        }
    })();
    try {
        report({step:'init',detail:'Starting scout...',progress:0});
        const scout=await jsonResult(await scoutRequest(user,'/api/scout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,jobId})},signal,300000));
        signal.throwIfAborted();
        report({step:'enhance',detail:'Capture saved. Creating mockups...',progress:72});
        const optional=async(path:string)=>{
            try {await jsonResult(await scoutRequest(user,path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scoutId:scout.id})},signal,90000));return true;}
            catch {signal.throwIfAborted();return false;}
        };
        const enhanced=await optional('/api/enhance');
        report({step:'copy',detail:'Writing field notes from the captured page...',progress:95});
        const copied=await optional('/api/copy');
        signal.throwIfAborted();
        report({step:enhanced&&copied?'done':'saved',detail:enhanced&&copied?'Mission complete. Opening your pack...':'Capture saved. Opening your pack with options to retry unfinished work...',progress:100});
        return scout.id as string;
    } finally {
        polling.abort();
        signal.removeEventListener('abort',abort);
        await watch;
    }
}
