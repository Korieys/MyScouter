import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import sharp from 'sharp';
import type {Bucket} from '@google-cloud/storage';
import {ScoutError,storedAssetPath} from './scout-access';
import {WORKER_LIMITS} from './capture-worker-contract';
export async function workerPng(buffer:Buffer) {
 if(!buffer.length||buffer.length>WORKER_LIMITS.assetBytes)throw new ScoutError(413,'This screenshot exceeds the isolated worker limit of 3 MiB. Try a shorter page.');
 try{
 const meta=await sharp(buffer,{limitInputPixels:1440*12000}).metadata();
 if(meta.format!=='png'||!meta.width||!meta.height||meta.width>1440||meta.height>12000||meta.pages&&meta.pages!==1)throw Error('Invalid PNG');
 // Decode before persisting; metadata alone does not establish a usable image.
 await sharp(buffer,{limitInputPixels:1440*12000}).raw().toBuffer();
 return {bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),width:meta.width,height:meta.height};
 }catch{throw new ScoutError(422,'The worker returned an invalid PNG.');}
}
export async function persistWorkerAsset(bucket:Bucket,id:string,name:string,buffer:Buffer,sha256:string,signal=AbortSignal.timeout(WORKER_LIMITS.uploadMs)) {
 const file=bucket.file(storedAssetPath(id,name));
 const stream=file.createWriteStream({resumable:false,timeout:WORKER_LIMITS.uploadMs,predefinedAcl:'private',preconditionOpts:{ifGenerationMatch:0},
  metadata:{contentType:'image/png',cacheControl:'private, no-store',metadata:{workerSha256:sha256}}});
 try{await pipeline(Readable.from(buffer),stream,{signal});}
 catch(error){
  if((error as {code?:number}).code!==412)throw error;
  const [meta]=await file.getMetadata();
  if(Number(meta.size)!==buffer.length||meta.metadata?.workerSha256!==sha256)throw new ScoutError(409,'An existing worker asset cannot be replaced.');
 }finally{stream.destroy();}
}
