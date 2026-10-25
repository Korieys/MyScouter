import {assertWorkerEnvironment} from './transport';
export async function workerPreflight(env:NodeJS.ProcessEnv=process.env,send:typeof fetch=fetch){
 assertWorkerEnvironment(env);
 const project=env.CAPTURE_PREFLIGHT_PROJECT,bucket=env.CAPTURE_PREFLIGHT_BUCKET;
 if(project!=='myscouter-5f16b'||bucket!=='myscouter-5f16b.firebasestorage.app')throw Error('Preflight resource mismatch');
 const metadata='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/';
 const identity=await send(metadata+'email',{headers:{'Metadata-Flavor':'Google'},redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!identity.ok||(await identity.text()).trim()!=='myscouter-preview-capture@'+project+'.iam.gserviceaccount.com')throw Error('Unexpected runtime identity');
 const response=await send(metadata+'token',{headers:{'Metadata-Flavor':'Google'},redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error('Metadata credential unavailable');
 const credential=await response.json();if(typeof credential.access_token!=='string'||credential.access_token.length>8192)throw Error('Invalid metadata credential');
 const headers={Authorization:'Bearer '+credential.access_token,'Content-Type':'application/json'};
 const checks:{check:string;status:number;passed:boolean}[]=[];
 const permissions=['datastore.entities.get','datastore.entities.list','firebaseauth.users.get','firebaseauth.users.delete','firebaseauth.configs.get','secretmanager.versions.access','storage.objects.get','storage.objects.list','storage.objects.create','storage.objects.delete'];
 const iam=await send('https://cloudresourcemanager.googleapis.com/v1/projects/'+project+':testIamPermissions',{method:'POST',headers,body:JSON.stringify({permissions}),redirect:'error',signal:AbortSignal.timeout(10000)});
 const policy=iam.ok?await iam.json():null;
 checks.push({check:'Project permissions: no database/Auth/secret/storage permissions',status:iam.status,passed:iam.ok&&Array.isArray(policy.permissions||[])&&(policy.permissions||[]).length===0});
 const query=['storage.objects.get','storage.objects.list','storage.objects.create','storage.objects.delete'].map(p=>'permissions='+p).join('&');
 const storage=await send('https://storage.googleapis.com/storage/v1/b/'+bucket+'/iam/testPermissions?'+query,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
 const storagePolicy=storage.ok?await storage.json():null;
 checks.push({check:'Bucket permissions: no read/list/create/delete',status:storage.status,passed:storage.status===403||(storage.ok&&(storagePolicy.permissions||[]).length===0)});
 const nonexistent='scout-00000000-0000-4000-8000-000000000000';
 const targets=[
 ['Firestore nonexistent fictional document','https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents/privateScouts/'+nonexistent],
 ['Firebase Auth configuration','https://identitytoolkit.googleapis.com/admin/v2/projects/'+project+'/config'],
 ['Storage nonexistent fictional object','https://storage.googleapis.com/storage/v1/b/'+bucket+'/o/'+encodeURIComponent('private-scouts/'+nonexistent+'/worker-denial-probe.png')+'?alt=media'],
 ];
 for(const [check,url]of targets){const r=await send(url,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});checks.push({check,status:r.status,passed:r.status===403});await r.body?.cancel();}
 // Permission tests and reads only. No user enumeration, object listing, write,
 // delete or notification is attempted, even when a grant is unexpectedly broad.
 if(checks.some(c=>!c.passed))throw Error('Worker IAM preflight failed; do not activate capture.');
 return {passed:true,scope:'Named preview runtime identity and exact Firebase project/bucket; no data mutation',checks};
}
