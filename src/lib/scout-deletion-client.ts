import type {User} from 'firebase/auth';
import {authFetch,jsonResult} from './auth-fetch';

export async function deleteScout(user:User,id:string,signal:AbortSignal) {
    if(!/^scout-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw new Error('This pack cannot be deleted. Refresh your history.');
    const deadline=AbortSignal.timeout(55_000),combined=AbortSignal.any([signal,deadline]);
    let onAbort=()=>{};
    const interrupted=new Promise<never>((_,reject)=>{
        onAbort=()=>reject(new Error('Deletion could not be confirmed. Refresh your history to check whether it finished before retrying.'));
        combined.addEventListener('abort',onAbort,{once:true});if(combined.aborted)onAbort();
    });
    try {
        const result=await Promise.race([authFetch(user,`/api/scouts/${id}`,{method:'DELETE',signal:combined}).then(jsonResult),interrupted]);
        if(result.deleted!==true)throw new Error('Deletion could not be confirmed. Refresh your history.');
    } finally {combined.removeEventListener('abort',onAbort);}
}
