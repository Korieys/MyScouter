import {createHash, randomUUID} from 'node:crypto';
import {accountStateRef} from './account-state';
import {FieldValue, type DocumentReference, type Firestore} from 'firebase-admin/firestore';
import {assertOwner, assetName, ScoutError, type ScoutRecord} from './scout-access';
import {secondsUntilReset, WORK_LIMITS, type WorkKind} from './work-policy';

export const LIMIT_COLLECTION = 'privateScoutLimits';
type Active = {token:string; until:number};
type Bucket = {day:string; attempts:number; active:Active[]};
export type WorkLease = {uid:string; kind:WorkKind; token:string; until:number};
type Reservation = {cached:true; record:ScoutRecord} | {cached:false; lease:WorkLease; record?:ScoutRecord};

function bucket(value: unknown, now:number): Bucket {
    const day = new Date(now).toISOString().slice(0,10);
    if (value === undefined) return {day,attempts:0,active:[]};
    const data = value as Bucket;
    if (!data || typeof data.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.day) ||
        !Number.isSafeInteger(data.attempts) || data.attempts < 0 || !Array.isArray(data.active) ||
        data.active.some(item => !item || typeof item.token !== 'string' || !Number.isSafeInteger(item.until))) {
        throw new ScoutError(503,'Usage tracking is temporarily unavailable. Please try again later.');
    }
    return {day,attempts:data.day === day ? data.attempts : 0,active:data.active.filter(item => item.until > now)};
}

export function attemptAsset(filename:string, token:string) {
    if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid work token');
    return assetName(assetName(filename).replace(/\.png$/,`-${token}.png`));
}

// Every read is inside the transaction and precedes writes. Provider work never
// runs inside a retried transaction. The same store is shared by all instances.
export function workStore(db:Firestore, clock:()=>number = Date.now, limits = WORK_LIMITS) {
    const refs = (uid:string, kind:WorkKind) => ({
        account:db.collection(LIMIT_COLLECTION).doc(`account-${createHash('sha256').update(uid).digest('hex')}-${kind}`),
        global:db.collection(LIMIT_COLLECTION).doc(`global-${kind}`),
    });
    return {
        async beginAccountDeletion(uid:string) {
            const state=accountStateRef(db,uid);
            const accounts=(['capture','enhance','copy'] as const).map(kind=>refs(uid,kind).account);
            await db.runTransaction(async transaction=>{
                const snapshots=await transaction.getAll(state,...accounts);
                if(snapshots[0].exists)return;
                const now=clock();
                if(snapshots.slice(1).some(snapshot=>bucket(snapshot.data(),now).active.length))throw new ScoutError(409,'Wait for your capture or processing to finish before deleting your account.');
                transaction.create(state,{uid,state:'deleting',requestedAt:new Date(now).toISOString()});
            });
        },
        async beginDeletion(uid:string,scout:DocumentReference,expectedUpdateMs?:number) {
            const accounts = (['capture','enhance','copy'] as const).map(kind=>refs(uid,kind).account);
            await db.runTransaction(async transaction=>{
                const snapshots=await transaction.getAll(scout,...accounts);
                const record=snapshots[0].data() as ScoutRecord | undefined;
                if (!record || record.userId!==uid) throw new ScoutError(404,'This scout is unavailable for your account. Refresh your history to check its latest state.');
                if(expectedUpdateMs!==undefined && snapshots[0].updateTime?.toMillis()!==expectedUpdateMs)throw new ScoutError(409,'The pack changed after the cleanup plan. Review a fresh plan.');
                if(record.status==='deleting')return;
                const now=clock();
                for(const snapshot of snapshots.slice(1)) {
                    if(bucket(snapshot.data(),now).active.length)throw new ScoutError(409,'Wait for your current capture or processing to finish before deleting a pack.');
                }
                // The shared reads make concurrent processing starts conflict and retry.
                transaction.update(scout,{status:'deleting',deletionStartedAt:new Date(now).toISOString(),
                    pages:[],enhancedAssets:[],copy:null,textContent:'',progress:FieldValue.delete()});
            });
        },
        async finishDeletion(uid:string,scout:DocumentReference) {
            await db.runTransaction(async transaction=>{
                const snapshot=await transaction.get(scout);
                if(!snapshot.exists)return; // Another confirmed cleanup already finished.
                const record=snapshot.data() as ScoutRecord;
                if(record.userId!==uid || record.status!=='deleting')throw new ScoutError(409,'The pack changed before deletion finished. Refresh your history.');
                transaction.delete(scout);
            });
        },
        async reserve(uid:string,kind:WorkKind,scout?:DocumentReference):Promise<Reservation> {
            const {account,global}=refs(uid,kind);
            const token=randomUUID();
            return db.runTransaction(async transaction => {
                const now=clock();
                if((await transaction.get(accountStateRef(db,uid))).exists)throw new ScoutError(410,'Account deletion has started.');
                let record:ScoutRecord | undefined;
                if (scout) {
                    record=assertOwner((await transaction.get(scout)).data() as ScoutRecord | undefined,uid);
                    if ((kind==='copy' && record.copy) || (kind==='enhance' && record.enhancedAssets.length)) return {cached:true,record};
                    if (!['captured','complete'].includes(record.status)) throw new ScoutError(409,'Wait for this capture to finish.');
                } else if (kind!=='capture') throw new Error('A saved scout is required');
                const snapshots=await transaction.getAll(account,global);
                const perAccount=bucket(snapshots[0].data(),now), shared=bucket(snapshots[1].data(),now);
                const policy=limits[kind];
                if (perAccount.active.length) throw new ScoutError(409,`You already have ${kind === 'capture' ? 'a capture' : 'processing'} in progress. Please wait before retrying.`,Math.max(1,Math.ceil((perAccount.active[0].until-now)/1000)));
                if (shared.active.length>=policy.globalConcurrent) throw new ScoutError(429,'The processing queue is busy. Please try again shortly.',30);
                if (perAccount.attempts>=policy.accountDaily) throw new ScoutError(429,`Your daily ${kind === 'capture' ? 'capture' : 'processing'} attempt limit has been reached. It resets at 00:00 UTC.`,secondsUntilReset(now));
                if (shared.attempts>=policy.globalDaily) throw new ScoutError(429,'The service has reached today’s processing limit. Please try again after 00:00 UTC.',secondsUntilReset(now));
                const active={token,until:now+policy.leaseMs};
                transaction.set(account,{...perAccount,attempts:perAccount.attempts+1,active:[active]});
                transaction.set(global,{...shared,attempts:shared.attempts+1,active:[...shared.active,active]});
                return {cached:false,lease:{uid,kind,...active},...(record ? {record} : {})};
            });
        },
        async complete(lease:WorkLease,scout:DocumentReference,patch:Partial<ScoutRecord>) {
            const {account,global}=refs(lease.uid,lease.kind);
            await db.runTransaction(async transaction => {
                const snapshots=await transaction.getAll(account,global,scout,accountStateRef(db,lease.uid));
                const now=clock(),perAccount=bucket(snapshots[0].data(),now),shared=bucket(snapshots[1].data(),now);
                assertOwner(snapshots[2].data() as ScoutRecord | undefined,lease.uid);
                if(snapshots[3].exists)throw new ScoutError(410,'Account deletion has started.');
                if (lease.until<=now || !perAccount.active.some(item=>item.token===lease.token) || !shared.active.some(item=>item.token===lease.token)) {
                    throw new ScoutError(409,'This processing request expired. Reopen your pack and retry.');
                }
                // Result updates cannot reassign a scout or replace another stage.
                const fields: (keyof ScoutRecord)[] = lease.kind==='copy' ? ['copy'] : lease.kind==='enhance' ? ['enhancedAssets','status'] : ['url','domain','brandColor','pages','textContent','devices','status'];
                const update=Object.fromEntries(fields.filter(field=>patch[field]!==undefined).map(field=>[field,patch[field]]));
                transaction.update(scout,update);
                transaction.set(account,{...perAccount,active:perAccount.active.filter(item=>item.token!==lease.token)});
                transaction.set(global,{...shared,active:shared.active.filter(item=>item.token!==lease.token)});
            });
        },
        async release(lease:WorkLease) {
            const {account,global}=refs(lease.uid,lease.kind);
            await db.runTransaction(async transaction => {
                const snapshots=await transaction.getAll(account,global);
                const now=clock();
                for (let i=0;i<snapshots.length;i++) {
                    const data=bucket(snapshots[i].data(),now);
                    if (!snapshots[i].exists) continue;
                    // Never refund started work: a timed-out provider may have charged it.
                    transaction.set(i===0?account:global,{...data,active:data.active.filter(item=>item.token!==lease.token)});
                }
            });
        },
    };
}
