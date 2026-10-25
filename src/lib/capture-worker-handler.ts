import {readInput,errorResponse,ScoutError} from './scout-access';
import {WORKER_LIMITS,workerId} from './capture-worker-contract';
import {workerPng} from './capture-worker-upload';
import type {WorkerStore} from './capture-worker-broker';
import type {LoginField,LoginPlan} from './capture-login';
export function createWorkerHandler(services:{store:WorkerStore;verify:(r:Request)=>Promise<void>;save:(id:string,name:string,bytes:Buffer,sha:string)=>Promise<void>;planner:(f:LoginField[])=>Promise<LoginPlan>}) {
 return async(request:Request,id:string,action:string)=>{
  try{
   workerId(id);await services.verify(request);
   const token=request.headers.get('x-capture-capability')||'';
   if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new ScoutError(401,'Worker capability required.');
   const store=services.store;
   if(action==='claim'){const input=await store.claim(id,token);return Response.json(input,{headers:{'Cache-Control':'private, no-store'}});}
   if(action==='asset'){
    const raw=new URL(request.url).searchParams.get('name')||'';
    const length=Number(request.headers.get('content-length'));
    if(request.headers.get('content-type')!=='image/png'||!Number.isSafeInteger(length)||length<1||length>WORKER_LIMITS.assetBytes)throw new ScoutError(413,'Invalid worker upload size.');
    const expected={bytes:length,sha256:request.headers.get('x-capture-sha256')||'',width:Number(request.headers.get('x-capture-width')),height:Number(request.headers.get('x-capture-height'))};
    // Acquire the per-job upload fence before reading or decoding untrusted bytes.
    const slot=await store.beginUpload(id,token,raw,expected);
    if(!slot.stored){
     const reader=request.body?.getReader();if(!reader){await store.releaseUpload(id,slot.lock);throw new ScoutError(400,'Missing image.');}
     const chunks:Uint8Array[]=[];let size=0;let timeout:ReturnType<typeof setTimeout>|undefined;
     const expired=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new ScoutError(408,'Upload body timed out.')),10000);});
     try{
      for(;;){const {done,value}=await Promise.race([reader.read(),expired]);if(done)break;size+=value.length;if(size>length||size>WORKER_LIMITS.assetBytes)throw new ScoutError(413,'Worker upload too large.');chunks.push(value);}
      if(size!==length)throw new ScoutError(400,'Incomplete worker upload.');
      const buffer=Buffer.concat(chunks),meta=await workerPng(buffer);
      if(meta.sha256!==expected.sha256||meta.width!==expected.width||meta.height!==expected.height)throw new ScoutError(422,'Worker PNG metadata mismatch.');
      const job=await store.read(id);if(!job)throw new ScoutError(404,'Worker job unavailable.');
      await services.save(job.scoutId,slot.name,buffer,meta.sha256);
      await store.finishUpload(id,token,slot.name,slot.lock);
     }finally{clearTimeout(timeout);await reader.cancel().catch(()=>{});reader.releaseLock();await store.releaseUpload(id,slot.lock);}
    }else{await request.body?.cancel().catch(()=>{});}
    return Response.json({path:slot.name},{headers:{'Cache-Control':'private, no-store'}});
   }
   const body=await readInput(request,150000);
   if(action==='fail'){await store.fail(id,token,body.code);return Response.json({ok:true});}
   if(action==='progress'){await store.progress(id,token,body.step,body.progress);return Response.json({ok:true});}
   if(action==='plan')return Response.json(await store.plan(id,token,body.fields,services.planner));
   if(action==='finish'){await store.finish(id,token,body);return Response.json({ok:true});}
   throw new ScoutError(404,'Worker action unavailable.');
  }catch(error){return errorResponse(error,'The worker callback could not finish.');}
 };
}
