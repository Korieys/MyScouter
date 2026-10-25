import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {FieldPath} from 'firebase-admin/firestore';
import {getAdmin} from '../src/lib/firebase-admin';
import {ACCOUNT_STATE_COLLECTION} from '../src/lib/account-state';
import {maintenanceReason,processAccountDeletion,recoverInterruptedCapture} from '../src/lib/scout-maintenance';
import {removeScout} from '../src/lib/scout-deletion';
import {LIMIT_COLLECTION} from '../src/lib/work-store';
import {WORK_LIMITS} from '../src/lib/work-policy';
import {validScoutId,type ScoutRecord} from '../src/lib/scout-access';

// Read-only unless BOTH an exact reviewed plan digest and a separately enabled
// apply environment are supplied. Never schedule this against live data merely
// because the implementation is published to a draft PR.
const args=process.argv.slice(2);
const option=(name:string)=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
const allowed=new Set(['--retention-days','--after','--apply-plan','--sha256']);
for(let i=0;i<args.length;i+=2)if(!allowed.has(args[i]) || !args[i+1] || args[i+1].startsWith('--'))throw new Error('Expected --retention-days N, --after scout-UUID, or --apply-plan FILE --sha256 DIGEST.');
const retentionText=option('--retention-days');
const retentionDays=retentionText===undefined?undefined:Number(retentionText);
if(retentionDays!==undefined && (!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>365))throw new Error('Retention must be an explicitly approved whole number of days from 1 to 365.');
const services=getAdmin(),{db}=services,now=Date.now();
const apply=option('--apply-plan');
try {
 if(apply) {
    if(process.env.MAINTENANCE_APPLY_ENABLED!=='true')throw new Error('Apply is disabled. Review the exact plan and approve the live operation first.');
    const bytes=await readFile(apply),digest=createHash('sha256').update(bytes).digest('hex');
    if(option('--sha256')!==digest)throw new Error('The reviewed plan digest does not match.');
    const plan=JSON.parse(bytes.toString('utf8'));
    if(plan.version!==1 || plan.projectId!==process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || typeof plan.createdAt!=='number' || plan.createdAt>now || now-plan.createdAt>3600000 || !Array.isArray(plan.actions) || plan.actions.length>20)throw new Error('Wrong project, expired or invalid plan.');
    const results=[];
    for(const item of plan.actions) {
        if(typeof item.uid!=='string' || !Number.isFinite(item.updateMs))throw new Error('Invalid planned owner/version.');
        if(item.action==='account') {
            const state=await db.collection(ACCOUNT_STATE_COLLECTION).doc(item.id).get();
            if(state.data()?.uid!==item.uid || state.data()?.state!=='deleting' || state.updateTime?.toMillis()!==item.updateMs)throw new Error('Account request changed; review a fresh plan.');
            results.push({id:item.id,...await processAccountDeletion(services,item.uid)});
        } else {
            validScoutId(item.id);
            const snapshot=await db.collection('privateScouts').doc(item.id).get(),record=snapshot.data() as ScoutRecord|undefined;
            if(!record || record.userId!==item.uid || snapshot.updateTime?.toMillis()!==item.updateMs || maintenanceReason(record,now,plan.retentionDays)!==item.action)throw new Error('Pack changed; review a fresh plan.');
            if(item.action==='interrupted')results.push({id:item.id,recovered:await recoverInterruptedCapture(db,item.uid,item.id,now)});
            else if(item.action==='retention'||item.action==='deleting'){await removeScout(db,services.bucket,item.uid,item.id,item.updateMs);results.push({id:item.id,deleted:true});}
            else throw new Error('Unknown cleanup action.');
        }
    }
    console.log(JSON.stringify({projectId:plan.projectId,applied:true,results},null,2));
 } else {
    if(option('--sha256'))throw new Error('--sha256 requires --apply-plan.');
    let query=db.collection('privateScouts').orderBy(FieldPath.documentId());
    const after=option('--after');if(after)query=query.startAfter(validScoutId(after));
    const snapshot=await query.limit(100).get();
    const actions=[];let last:string|undefined;
    for(const doc of snapshot.docs) {
        last=doc.id;const record=doc.data() as ScoutRecord,reason=maintenanceReason(record,now,retentionDays);
        if(reason)actions.push({id:doc.id,uid:record.userId,action:reason,updateMs:doc.updateTime.toMillis()});
        if(actions.length===20)break;
    }
    const accountJobs=await db.collection(ACCOUNT_STATE_COLLECTION).where('state','==','deleting').limit(20-actions.length||1).get();
    for(const doc of accountJobs.docs)if(actions.length<20)actions.push({id:doc.id,uid:doc.data().uid,action:'account',updateMs:doc.updateTime.toMillis()});
    const capacity=[];
    for(const kind of ['capture','enhance','copy'] as const) {
        const usage=(await db.collection(LIMIT_COLLECTION).doc('global-'+kind).get()).data();
        const attempts=usage?.day===new Date(now).toISOString().slice(0,10)?usage.attempts:0;
        const active=Array.isArray(usage?.active)?usage.active.filter((item:{until:number})=>item.until>now).length:0;
        capacity.push({kind,attempts,active,dailyLimit:WORK_LIMITS[kind].globalDaily,concurrentLimit:WORK_LIMITS[kind].globalConcurrent,
            alert:attempts>=WORK_LIMITS[kind].globalDaily*.8?'daily-capacity':active>=WORK_LIMITS[kind].globalConcurrent?'concurrency':null});
    }
    console.log(JSON.stringify({version:1,projectId:process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,createdAt:now,dryRun:true,retentionDays,
        nextCursor:snapshot.size===100||last!==snapshot.docs.at(-1)?.id?last:null,actions,capacity,
        alerts:[...(actions.some(item=>item.action==='interrupted')?['interrupted-capture']:[]),...(!accountJobs.empty?['pending-account-deletion']:[])],
        note:'A reviewed plan is not permission to delete. No live records, objects, identity or access were changed.'},null,2));
 }
} finally {await db.terminate();}
