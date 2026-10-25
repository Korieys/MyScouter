import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {workerId} from './capture-worker-contract';
function key(value:string) {if(!/^[a-f0-9]{64}$/.test(value))throw Error('A 32-byte worker envelope key is required.');return Buffer.from(value,'hex');}
export function sealWorkerInput(job:string,input:unknown,secret:string) {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);cipher.setAAD(Buffer.from(workerId(job)));
 return {iv:iv.toString('hex'),data:Buffer.concat([cipher.update(JSON.stringify(input),'utf8'),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('hex')};
}
export function openWorkerInput(job:string,value:ReturnType<typeof sealWorkerInput>,secret:string) {
 const cipher=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(value.iv,'hex'));cipher.setAAD(Buffer.from(workerId(job)));cipher.setAuthTag(Buffer.from(value.tag,'hex'));
 return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data,'base64')),cipher.final()]).toString('utf8'));
}
export function capabilityHash(value:string) {return createHash('sha256').update(value).digest('hex');}
