import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {getAdmin} from '../src/lib/firebase-admin';
import {planWorkerCleanup,applyWorkerCleanup,type WorkerCleanupPlan} from '../src/lib/capture-worker-cleanup';
const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
async function main(){
 const {db,bucket}=getAdmin(),project=process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID||'',file=value('--apply-plan');
 if(!file){console.log(JSON.stringify(await planWorkerCleanup(db,bucket,project,value('--window')||'isolation-preview-2026-10-25'),null,2));return;}
 if(process.env.CAPTURE_WORKER_MAINTENANCE_ENABLED!=='true')throw Error('Worker cleanup apply is disabled.');
 const raw=await fs.readFile(file),digest=createHash('sha256').update(raw).digest('hex');
 if(value('--sha256')!==digest)throw Error('The reviewed plan digest does not match.');
 const plan=JSON.parse(raw.toString('utf8')) as WorkerCleanupPlan;
 console.log(JSON.stringify(await applyWorkerCleanup(db,bucket,project,plan)));
}
main().catch(()=>{console.error('Worker maintenance did not finish. Review the current plan and configuration.');process.exitCode=1;});
