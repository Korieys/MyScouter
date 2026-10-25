import type {Firestore} from 'firebase-admin/firestore';
import type {getAdmin} from './firebase-admin';
import {accountStateRef} from './account-state';
import {ScoutError, validScoutId, type ScoutRecord} from './scout-access';
import {SCOUT_COLLECTION} from './scout-server';
import {removeScout} from './scout-deletion';
import {workStore} from './work-store';
import {WORK_LIMITS} from './work-policy';

type Services=ReturnType<typeof getAdmin>;
// No writer is authorized past this fence. Capture functions are limited to
// 300 seconds; their reservations last 330 seconds. Extra time covers skew.
export const INTERRUPTED_AFTER_MS=WORK_LIMITS.capture.leaseMs+60_000;
export const REVOKED_TOKEN_DRAIN_MS=65*60_000;

function createdTime(value:unknown) {
    if(typeof value!=='string')return null;
    const time=Date.parse(value);
    return Number.isFinite(time)?time:null;
}

export function maintenanceReason(record:ScoutRecord, now:number, retentionDays?:number) {
    const created=createdTime(record.createdAt);
    if(created===null || created>now)return null;
    if(record.status==='capturing' && created+INTERRUPTED_AFTER_MS<=now)return 'interrupted' as const;
    if(record.status==='deleting')return 'deleting' as const;
    if(retentionDays!==undefined && Number.isInteger(retentionDays) && retentionDays>=1 && retentionDays<=365 &&
       created+retentionDays*86_400_000<=now)return 'retention' as const;
    return null;
}

// Recovery never silently removes a pack. An interrupted capture becomes a
// failed, empty pack that its owner can explicitly delete using the existing UI.
export async function recoverInterruptedCapture(db:Firestore, uid:string, value:unknown, now=Date.now()) {
    const ref=db.collection(SCOUT_COLLECTION).doc(validScoutId(value));
    return db.runTransaction(async transaction=>{
        const snapshot=await transaction.get(ref);
        const record=snapshot.data() as ScoutRecord|undefined;
        if(!record || record.userId!==uid || record.status==='deleting')throw new ScoutError(404,'This scout is unavailable for your account.');
        if(maintenanceReason(record,now)!=='interrupted')return false;
        transaction.update(ref,{status:'failed',pages:[],enhancedAssets:[],copy:null,textContent:'',
            progress:{step:'error',detail:'This capture was interrupted. Start a new capture or delete this incomplete pack.',progress:-1,timestamp:now}});
        return true;
    });
}

export async function requestAccountDeletion(db:Firestore, uid:string, authTime:unknown, now=Date.now()) {
    if(typeof authTime!=='number' || !Number.isFinite(authTime) || authTime*1000>now+60_000 || now-authTime*1000>300_000) {
        throw new ScoutError(401,'Sign out and sign in again before requesting account deletion.');
    }
    await workStore(db,()=>now).beginAccountDeletion(uid);
}

// Called only by a separately configured operator worker. Each pass removes at
// most one owned pack. A tombstone is retained on any partial failure and fences
// every API read and work reservation before storage cleanup begins.
export async function processAccountDeletion(services:Services, uid:string, now=Date.now()) {
    const {db,auth,bucket}=services,ref=accountStateRef(db,uid);
    let state=(await ref.get()).data();
    if(state?.state==='complete')return {state:'complete' as const};
    if(!state || state.uid!==uid)throw new ScoutError(404,'No account deletion request exists.');
    if(state.state!=='deleting')throw new Error('Invalid account deletion state');
    if(typeof state.disabledAt!=='number') {
        try {await auth.updateUser(uid,{disabled:true});await auth.revokeRefreshTokens(uid);}
        catch(error) {if((error as {code?:string}).code!=='auth/user-not-found')throw error;}
        // Concurrent passes cannot move this fence backwards; a late write only
        // lengthens the wait. No profile is removed before old ID tokens expire.
        await ref.set({disabledAt:now},{merge:true});
        state=(await ref.get()).data()!;
    }
    const remaining=await db.collection(SCOUT_COLLECTION).where('userId','==',uid).limit(1).get();
    if(!remaining.empty) {
        await removeScout(db,bucket,uid,remaining.docs[0].id);
        return {state:'deleting' as const,removedPack:true};
    }
    if(now<state.disabledAt+REVOKED_TOKEN_DRAIN_MS)return {state:'deleting' as const,retryAfter:Math.ceil((state.disabledAt+REVOKED_TOKEN_DRAIN_MS-now)/1000)};
    // Existing Firebase ID tokens may still write their own profile through the
    // inspected client rules until expiry, even after Auth is disabled/deleted.
    // Wait out those tokens, then delete profile before finalizing Auth.
    await db.collection('users').doc(uid).delete();
    try {await auth.deleteUser(uid);}
    catch(error) {if((error as {code?:string}).code!=='auth/user-not-found')throw error;}
    await ref.set({state:'complete',completedAt:new Date(now).toISOString(),uid:null},{merge:true});
    return {state:'complete' as const};
}
