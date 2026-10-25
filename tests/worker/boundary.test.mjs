import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {generateKeyPair,SignJWT} from 'jose';
import {parseCaptureInput,workerAssetName,validateCaptureResult,WORKER_LIMITS} from '../../src/lib/capture-worker-contract.ts';
import {sealWorkerInput,openWorkerInput,capabilityHash} from '../../src/lib/capture-worker-envelope.ts';
import {captureMode,workerConfig,assertWorkerAccount,assertWorkerLoginPolicy} from '../../src/lib/capture-worker-config.ts';
import {verifyWorkerIdentity} from '../../src/lib/capture-worker-identity.ts';
import {dispatchToken,runJobRequest,runIsolatedCapture} from '../../src/lib/capture-worker-dispatch.ts';
import {assertWorkerEnvironment,workerTransport} from '../../worker/transport.ts';
import http from 'node:http';
import {Storage} from '@google-cloud/storage';
import {workerPng,persistWorkerAsset} from '../../src/lib/capture-worker-upload.ts';
import sharp from 'sharp';
import {workerPreflight} from '../../worker/preflight.ts';
import {workerStorageOptions} from '../../src/lib/capture-worker-storage.ts';
const id='11111111-1111-4111-8111-111111111111',scout='scout-'+id,key='ab'.repeat(32);
const input=parseCaptureInput({url:'https://worker-fixture.example.com',devices:['desktop']},scout);
const env={NEXT_PUBLIC_FIREBASE_PROJECT_ID:'myscouter-5f16b',CAPTURE_WORKER_MODE:'cloud-run-jobs',CAPTURE_WORKER_ENABLED:'true',VERCEL_ENV:'preview',CAPTURE_WORKER_PROJECT:'myscouter-5f16b',CAPTURE_WORKER_PROJECT_NUMBER:'778860260835',CAPTURE_WORKER_REGION:'us-central1',CAPTURE_WORKER_JOB:'myscouter-preview-capture',CAPTURE_WORKER_DISPATCHER:'myscouter-preview-dispatch@myscouter-5f16b.iam.gserviceaccount.com',CAPTURE_WORKER_RUNTIME_EMAIL:'myscouter-preview-capture@myscouter-5f16b.iam.gserviceaccount.com',CAPTURE_WORKER_RUNTIME_SUBJECT:'123456789012345678901',CAPTURE_WORKER_BROKER_URL:'https://broker.example.com/api/capture-worker',CAPTURE_WORKER_ENVELOPE_KEY:key,CAPTURE_WORKER_WIF_POOL:'myscouter-preview',CAPTURE_WORKER_WIF_PROVIDER:'vercel-preview',CAPTURE_WORKER_JOB_ETAG:'reviewed-etag',CAPTURE_WORKER_ACCOUNT_HASH:'11'.repeat(32),CAPTURE_WORKER_WINDOW_ID:'isolation-preview-2026-10-25',CAPTURE_WORKER_WINDOW_END:'2026-10-27T00:00:00.000Z'};
const config=workerConfig(env,Date.parse('2026-10-25T00:00:00Z'));
test('worker input revalidates consent at the customer boundary and restricts destinations',()=>{
 assert.throws(()=>parseCaptureInput({url:input.url,login:{mode:'basic',url:input.url,username:'fiction',password:'fiction'}},scout),{status:400});
 assert.throws(()=>parseCaptureInput({url:'http://169.254.169.254/'},scout),{status:400});
 assert.throws(()=>workerAssetName(id,'../other.png',['desktop']),{status:400});
 assert.throws(()=>workerAssetName(id,'home-mobile-hero.png',['desktop']),{status:400});
});
test('job envelope is authenticated, job-bound, encrypted and never stores a bearer capability',()=>{
 const payload={...input,login:{mode:'basic',url:input.url,username:'fictional-user',password:'fictional-password'}},sealed=sealWorkerInput(id,payload,key);
 assert.ok(!JSON.stringify(sealed).includes(payload.login.password));assert.deepEqual(openWorkerInput(id,sealed,key),payload);
 assert.throws(()=>openWorkerInput('22222222-2222-4222-8222-222222222222',sealed,key));
 assert.throws(()=>openWorkerInput(id,{...sealed,tag:'00'.repeat(16)},key));
 const token=randomBytes(32).toString('base64url');assert.notEqual(capabilityHash(token),token);
});
test('isolated activation is explicit, preview-only, fixed-window and fails closed',()=>{
 assert.equal(captureMode({}),'inline');assert.throws(()=>captureMode({...env,VERCEL_ENV:'production'}),{status:503});
 assert.throws(()=>captureMode({...env,CAPTURE_WORKER_ENABLED:'false'}),{status:503});
 assert.throws(()=>workerConfig({...env,CAPTURE_WORKER_ENVELOPE_KEY:''},0),{status:503});
 assert.throws(()=>workerConfig(env,Date.parse('2026-10-27T00:00:00Z')),{status:503});
 assert.equal(config.budget.limit,20);assert.throws(()=>assertWorkerAccount('unapproved-fixture-user',config),{status:403});assert.throws(()=>workerConfig({...env,NEXT_PUBLIC_FIREBASE_PROJECT_ID:'wrong-project'},0),{status:503});
});
test('Google worker identity requires signature, audience, subject, verified email and freshness',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const token=async patch=>new SignJWT({email:config.runtime,email_verified:true,...patch}).setProtectedHeader({alg:'RS256'}).setIssuer('https://accounts.google.com').setSubject(config.subject).setAudience(config.broker).setIssuedAt().setExpirationTime('1h').sign(privateKey);
 const request=token=>new Request('https://broker.example.com',{headers:{Authorization:'Bearer '+token}});
 await verifyWorkerIdentity(request(await token({})),config,publicKey);
 for(const patch of [{email:'other@example.com'},{email_verified:false}])await assert.rejects(verifyWorkerIdentity(request(await token(patch)),config,publicKey),{status:401});
 const wrong=new SignJWT({email:config.runtime,email_verified:true}).setProtectedHeader({alg:'RS256'}).setIssuer('https://accounts.google.com').setSubject(config.subject).setAudience('https://wrong.example.com').setIssuedAt().setExpirationTime('1h');
 await assert.rejects(verifyWorkerIdentity(request(await wrong.sign(privateKey)),config,publicKey),{status:401});
 await assert.rejects(verifyWorkerIdentity(request('malformed'),config,publicKey),{status:401});
});
test('workload federation and impersonation use fixed Google endpoints and short-lived tokens',async()=>{
 const calls=[];const send=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json(url.includes('sts.googleapis')?{access_token:'federated-fixture'}:{accessToken:'dispatcher-fixture'});};
 assert.equal(await dispatchToken(config,'fictional-vercel-assertion',send),'dispatcher-fixture');
 assert.ok(calls[0].body.audience.includes('/projects/778860260835/'));assert.equal(calls[1].body.lifetime,'600s');
 assert.ok(calls.every(c=>!JSON.stringify(c).includes('fictional-password')));
});
test('execution overrides carry only a single-job ticket and fixed broker; no account or cloud secret',()=>{
 const launch=runJobRequest(config,{id,token:'fictional-job-capability'});
 assert.equal(launch.body.etag,'reviewed-etag');assert.equal(launch.body.overrides.taskCount,1);assert.equal(launch.body.overrides.timeout,'240s');
 assert.deepEqual(launch.body.overrides.containerOverrides[0].env.map(e=>e.name),['CAPTURE_WORKER_JOB_ID','CAPTURE_WORKER_CAPABILITY','CAPTURE_WORKER_BROKER_URL']);
});
test('worker refuses inherited API credentials and off-origin/non-TLS broker configuration',()=>{
 for(const name of ['FIREBASE_PRIVATE_KEY','OPENAI_API_KEY','VERCEL_OIDC_TOKEN','GOOGLE_APPLICATION_CREDENTIALS'])assert.throws(()=>assertWorkerEnvironment({[name]:'fictional-canary'}),/API credential/);
 assert.throws(()=>workerTransport({NODE_ENV:'production',CAPTURE_WORKER_JOB_ID:id,CAPTURE_WORKER_CAPABILITY:'a'.repeat(43),CAPTURE_WORKER_BROKER_URL:'http://127.0.0.1/api/capture-worker'}),/endpoint/);
});
test('worker callback redirects fail rather than forwarding a ticket to another host',async()=>{
 const seen=[];const transport=workerTransport({NODE_ENV:'test',CAPTURE_WORKER_LOCAL:'true',CAPTURE_WORKER_JOB_ID:id,CAPTURE_WORKER_CAPABILITY:'a'.repeat(43),CAPTURE_WORKER_BROKER_URL:'http://127.0.0.1:12345/api/capture-worker'},async(url,o)=>{seen.push(o);throw Error('redirect blocked');});
 try{await assert.rejects(transport.call('claim'));assert.equal(seen[0].redirect,'error');}finally{transport.close();}
});
test('result metadata cannot escape the attempt namespace, omit required images or forge image dimensions',()=>{
 const path=kind=>workerAssetName(id,'home-desktop-'+kind+'.png',['desktop']),shots=['hero','full'].map(type=>({path:path(type),viewport:'desktop',width:1440,height:900,type}));
 const uploaded=Object.fromEntries(shots.map(s=>[s.path,{stored:true,width:1440,height:900}]));
 const result={brandColor:'#123456',textContent:'Fictional copy',pages:[{url:input.url,title:'Fixture',screenshots:shots}]};
 assert.deepEqual(validateCaptureResult(result,input,id,uploaded),result);
 assert.throws(()=>validateCaptureResult({...result,userId:'other'},input,id,uploaded),{status:422});
 for(const bad of [{...result,pages:[{...result.pages[0],url:'https://other.example.com/'}]},{...result,pages:[{...result.pages[0],screenshots:[{...shots[0],width:390},shots[1]]}]},{...result,pages:[{...result.pages[0],screenshots:[shots[0]]}]}])assert.throws(()=>validateCaptureResult(bad,input,id,uploaded),{status:422});
});
test('upload verifier fully decodes bounded PNGs and rejects malformed and oversized payloads',async()=>{
 const png=await sharp({create:{width:100,height:100,channels:3,background:'#123456'}}).png().toBuffer();
 assert.equal((await workerPng(png)).width,100);
 await assert.rejects(workerPng(Buffer.from('not-a-png')),{status:422});
 await assert.rejects(workerPng(Buffer.alloc(WORKER_LIMITS.assetBytes+1)),{status:413});
});
test('ambiguous Cloud Run dispatch is never retried and clears the encrypted job',async()=>{
 let runs=0,closed=0;
 const store={create:async()=>({id,token:'a'.repeat(43),expiresAt:Date.now()+10000}),close:async()=>{closed++;return 0;}};
 const send=async(url)=>{if(url.includes('sts.googleapis'))return Response.json({access_token:'fixture'});if(url.includes('iamcredentials'))return Response.json({accessToken:'fixture'});runs++;throw Error('Unknown launch outcome');};
 await assert.rejects(runIsolatedCapture(input,{uid:'fixture',kind:'capture',token:id,until:Date.now()+330000},store,config,new AbortController().signal,{fetch:send,subjectToken:'fictional'}),{status:503});
 assert.equal(runs,1);assert.equal(closed,1);
});
test('sanitized worker failures preserve unsupported-login recovery without exposing error bodies',async()=>{
 let closed=0;const store={create:async()=>({id,token:'a'.repeat(43),expiresAt:Date.now()+10000}),read:async()=>({state:'failed',failure:'unsupported-login'}),close:async()=>{closed++;return 0;}};
 const send=async url=>Response.json(url.includes('sts.googleapis')?{access_token:'fixture'}:url.includes('iamcredentials')?{accessToken:'fixture'}:{name:'operation'});
 await assert.rejects(runIsolatedCapture(input,{uid:'fixture',kind:'capture',token:id,until:Date.now()+330000},store,config,new AbortController().signal,{fetch:send,subjectToken:'fictional'}),e=>e.status===422&&e.message.includes('No guest capture'));
 assert.equal(closed,1);
});

test('worker storage uses the API identity with no automatic retries or unbounded upload deadline',()=>{const options=workerStorageOptions({NEXT_PUBLIC_FIREBASE_PROJECT_ID:'demo-myscouter-readiness',FIREBASE_CLIENT_EMAIL:'fictional@demo.invalid',FIREBASE_PRIVATE_KEY:'fictional-fixture-key'});assert.equal(options.retryOptions.autoRetry,false);assert.equal(options.retryOptions.maxRetries,0);assert.equal(options.retryOptions.totalTimeout,10);});

test('cloud IAM preflight is read-only, checks exact resources and rejects unexpected privilege',async()=>{const env={CAPTURE_PREFLIGHT_PROJECT:'myscouter-5f16b',CAPTURE_PREFLIGHT_BUCKET:'myscouter-5f16b.firebasestorage.app'},calls=[];let broad=false;const send=async(url,options)=>{calls.push({url,method:options.method||'GET'});if(url.endsWith('/email'))return new Response('myscouter-preview-capture@myscouter-5f16b.iam.gserviceaccount.com');if(url.endsWith('/token'))return Response.json({access_token:'fictional-preflight-token'});if(url.includes('testIamPermissions'))return Response.json({permissions:broad?['datastore.entities.get']:[]});if(url.includes('testPermissions'))return Response.json({permissions:[]});return new Response(null,{status:403});};assert.equal((await workerPreflight(env,send)).passed,true);assert.ok(calls.every(c=>c.method==='GET'||c.url.endsWith(':testIamPermissions')));broad=true;await assert.rejects(workerPreflight(env,send),/preflight failed/);});

test('the hosted worker window refuses credential capture until policy activation and explicit extra consent',()=>{assert.doesNotThrow(()=>assertWorkerLoginPolicy({},{}));assert.throws(()=>assertWorkerLoginPolicy({login:{}},{login:{consent:true}},{}),{status:503});assert.throws(()=>assertWorkerLoginPolicy({login:{}},{login:{consent:true}},{CAPTURE_WORKER_LOGIN_ENABLED:'true'}),{status:503});assert.doesNotThrow(()=>assertWorkerLoginPolicy({login:{}},{login:{temporaryStorageConsent:true}},{CAPTURE_WORKER_LOGIN_ENABLED:'true'}));});

test('real worker storage transport makes one failed write and aborts a stalled upload',async()=>{let requests=0,stall=false;const sockets=new Set();const server=http.createServer((req,res)=>{requests++;req.resume();if(!stall){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:503,message:'Fictional storage unavailable'}}));}});server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const options=workerStorageOptions({NEXT_PUBLIC_FIREBASE_PROJECT_ID:'demo-myscouter-readiness',FIREBASE_CLIENT_EMAIL:'fixture@demo.invalid',FIREBASE_PRIVATE_KEY:'fictional-fixture-key'});const bucket=new Storage({...options,apiEndpoint:'http://127.0.0.1:'+server.address().port,useAuthWithCustomEndpoint:false}).bucket('demo-worker-fixture');const png=await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer();await assert.rejects(persistWorkerAsset(bucket,scout,'fixture.png',png,'00'.repeat(32)));assert.equal(requests,1);stall=true;const before=Date.now();await assert.rejects(persistWorkerAsset(bucket,scout,'stalled.png',png,'00'.repeat(32),AbortSignal.timeout(100)));assert.ok(Date.now()-before<5000);assert.ok(requests<=2);}finally{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}});
