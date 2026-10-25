import {workerConfig} from '@/lib/capture-worker-config';
import {getAdmin} from '@/lib/firebase-admin';
import {workerStore} from '@/lib/capture-worker-broker';
import {verifyWorkerIdentity} from '@/lib/capture-worker-identity';
import {createWorkerHandler} from '@/lib/capture-worker-handler';
import {workerUploadBucket} from '@/lib/capture-worker-storage';
import {persistWorkerAsset} from '@/lib/capture-worker-upload';
import {chooseLoginFields} from '@/lib/capture-login';
import {errorResponse} from '@/lib/scout-access';
export const maxDuration=30;
export async function POST(request:Request,context:{params:Promise<{id:string;action:string}>}) {
 try{
  const config=workerConfig(),{id,action}=await context.params;
  await verifyWorkerIdentity(request,config);
  const services=getAdmin();
  return await createWorkerHandler({store:workerStore(services.db,config.key,Date.now,config.budget),verify:async()=>{},
   save:(id,name,bytes,sha)=>persistWorkerAsset(workerUploadBucket(),id,name,bytes,sha),planner:chooseLoginFields})(request,id,action);
 }catch(error){return errorResponse(error);}
}
