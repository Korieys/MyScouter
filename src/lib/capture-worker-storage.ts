import {Storage,type StorageOptions} from '@google-cloud/storage';
import {ScoutError} from './scout-access';
export function workerStorageOptions(env:NodeJS.ProcessEnv=process.env):StorageOptions {
 const projectId=env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,client_email=env.FIREBASE_CLIENT_EMAIL,private_key=env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g,'\n');
 if(!projectId||!client_email||!private_key)throw new ScoutError(503,'Worker storage is unavailable.');
 return {projectId,credentials:{client_email,private_key},retryOptions:{autoRetry:false,maxRetries:0,totalTimeout:10,retryDelayMultiplier:1,maxRetryDelay:1}};
}
let cached:ReturnType<Storage['bucket']>|undefined;
export function workerUploadBucket(){
 if(!process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)throw new ScoutError(503,'Worker storage is unavailable.');
 return cached??=new Storage(workerStorageOptions()).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
}
