import {captureWebsite,type CaptureIO} from '../src/lib/capture-engine';
import {parseWorkerInput,WORKER_LIMITS} from '../src/lib/capture-worker-contract';
import {workerTransport} from './transport';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {ScoutError} from '../src/lib/scout-access';
export async function runWorker(env:NodeJS.ProcessEnv=process.env,launch?:CaptureIO['launch']) {
 const transport=workerTransport(env);
 try {
  const input=parseWorkerInput(await transport.call('claim'));
  const result=await captureWebsite(input,{signal:transport.signal,launch,
   progress:async(step,_detail,progress)=>{await transport.call('progress',{step,progress});},
   planner:async fields=>transport.call('plan',{fields}),
   save:async(buffer,_id,name)=>{
    if(buffer.length>WORKER_LIMITS.assetBytes)throw new ScoutError(413,'Worker image budget exceeded');
    const info=await sharp(buffer,{limitInputPixels:1440*12000}).metadata();
    if(!info.width||!info.height)throw Error('Invalid worker image');
    return (await transport.call('asset',undefined,{name,buffer,width:info.width,height:info.height,sha256:createHash('sha256').update(buffer).digest('hex')})).path;
   },
  });
  await transport.call('finish',result);
 }catch(error){
  const e=error as {message?:string;status?:number};const code=e.message?.startsWith('Sign-in could not be verified.')?'unsupported-login':e.message?.startsWith('AI-assisted sign-in')?'planner-unavailable':e.status===413?'oversize-image':transport.signal.aborted?'capture-timeout':'capture-unavailable';
  await transport.call('fail',{code}).catch(()=>{});throw error;
 }finally{transport.close();}
}
