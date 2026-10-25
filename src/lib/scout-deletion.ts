import type {Firestore} from 'firebase-admin/firestore';
import type {getAdmin} from './firebase-admin';
import {validScoutId, ScoutError} from './scout-access';
import {SCOUT_COLLECTION} from './scout-server';
import {workStore} from './work-store';

type Bucket = ReturnType<typeof getAdmin>['bucket'];
const CLEANUP_MS=40_000;
const FILE_LIMIT=1000;

export async function removeScout(db:Firestore, bucket:Bucket, uid:string, value:unknown, expectedUpdateMs?:number) {
    const id=validScoutId(value),ref=db.collection(SCOUT_COLLECTION).doc(id),store=workStore(db);
    await store.beginDeletion(uid,ref,expectedUpdateMs);
    const deadline=Date.now()+CLEANUP_MS;
    const bounded=async<T>(operation:()=>Promise<T>):Promise<T>=>{
        const remaining=deadline-Date.now();
        if(remaining<=0)throw new Error('Cleanup deadline');
        let timer:ReturnType<typeof setTimeout> | undefined;
        try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cleanup deadline')),remaining);})]);}
        finally{clearTimeout(timer);}
    };
    try {
        // Include orphaned outputs, but only in the exact server-owned UUID folder.
        const prefix=`private-scouts/${id}/`;
        let count=0;
        for(;;){
            // Restart at the first page after each batch; deleting page members must
            // not cause cursor skips. Removed files are safe to retry.
            const [files]=await bounded(()=>bucket.getFiles({prefix,maxResults:100,autoPaginate:false}));
            if(files.length===0)break;
            count+=files.length;
            if(count>FILE_LIMIT || files.some(file=>!file.name.startsWith(prefix)))throw new Error('Unexpected deletion scope');
            for(let offset=0;offset<files.length;offset+=4) {
                const results=await bounded(()=>Promise.allSettled(files.slice(offset,offset+4).map(file=>file.delete({ignoreNotFound:true}))));
                if(results.some(result=>result.status==='rejected'))throw new Error('Object deletion failed');
            }
        }
        await bounded(()=>store.finishDeletion(uid,ref));
    } catch {
        // Retain the inaccessible record for an explicit retry after partial cleanup.
        throw new ScoutError(503,'Deletion could not finish. This pack is no longer available to open. Refresh your history and choose Finish deleting to retry.');
    }
}
