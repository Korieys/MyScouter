import {createRemoteJWKSet,jwtVerify} from 'jose';
import {ScoutError} from './scout-access';
import type {WorkerConfig} from './capture-worker-config';
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{timeoutDuration:5000});
export async function verifyWorkerIdentity(request:Request,config:WorkerConfig,key:Parameters<typeof jwtVerify>[1]=googleKeys) {
 const match=/^Bearer ([^\s,]+)$/.exec(request.headers.get('authorization')||'');
 if(!match||match[1].length>8192)throw new ScoutError(401,'Worker identity required.');
 try {
  const {payload}=await jwtVerify(match[1],key,{issuer:['https://accounts.google.com','accounts.google.com'],audience:config.broker,algorithms:['RS256'],maxTokenAge:'65m'});
  if(payload.sub!==config.subject||payload.email!==config.runtime||payload.email_verified!==true)throw Error('Wrong worker identity');
 }catch{throw new ScoutError(401,'Worker identity unavailable.');}
}
