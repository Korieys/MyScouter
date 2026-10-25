import assert from 'node:assert/strict';
import http from 'node:http';
import {Readable} from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {workerStore} from '../../src/lib/capture-worker-broker.ts';
import {createWorkerHandler} from '../../src/lib/capture-worker-handler.ts';
import {persistWorkerAsset} from '../../src/lib/capture-worker-upload.ts';
import {parseCaptureInput} from '../../src/lib/capture-worker-contract.ts';
import {workStore} from '../../src/lib/work-store.ts';
import {readScoutHistory} from '../../src/lib/scout-history.ts';
import {recordedAssets} from '../../src/lib/scout-access.ts';
import {inspectWorkerZip} from './zip-proof.mjs';
import {buildBundle} from '../../src/lib/bundle.ts';
const project='demo-myscouter-readiness';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8187'||process.env.FIREBASE_STORAGE_EMULATOR_HOST!=='127.0.0.1:9197')throw Error('Use only the disposable loopback demo emulators.');
const app=initializeApp({projectId:project,storageBucket:project+'.appspot.com'},'worker-container-journey'),db=getFirestore(app),bucket=getStorage(app).bucket();
const key='cd'.repeat(32),store=workerStore(db,key,Date.now,{id:'container-'+randomUUID(),limit:20,until:Date.now()+3600000}),callbacks=[],cases=[];
const handler=createWorkerHandler({store,verify:async r=>{assert.equal(r.headers.get('authorization'),'Bearer fictional-local-worker');},
 save:(id,name,bytes,sha)=>persistWorkerAsset(bucket,id,name,bytes,sha),
 planner:async fields=>{const text=JSON.stringify(fields);assert.ok(!text.includes('fictional-password-only'));assert.ok(fields.every(f=>f.label===f.kind));return {username:fields.find(f=>f.kind==='username')?.id,password:fields.find(f=>f.kind==='password')?.id,submit:fields.find(f=>f.kind==='submit').id};}});
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://localhost'),m=/^\/api\/capture-worker\/([^/]+)\/(claim|progress|asset|plan|finish|fail)$/.exec(u.pathname);
  if(!m){res.writeHead(404);res.end();return;}
  const body=Readable.toWeb(req),request=new Request('http://localhost'+req.url,{method:'POST',headers:req.headers,body,duplex:'half'});
  const response=await handler(request,m[1],m[2]);callbacks.push({id:m[1],action:m[2],status:response.status,time:Date.now()});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Fictional test broker error');}
});
await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
const brokerHost=process.platform==='linux'?'host.docker.internal':'host.docker.internal';
const brokerURL='http://'+brokerHost+':'+server.address().port+'/api/capture-worker';
const output=process.env.WORKER_TEST_OUTPUT||path.join(os.tmpdir(),'myscouter-worker-journey');
await fs.mkdir(output,{recursive:true});
const docker=(args)=>execFileSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:1000000});
const image=process.env.WORKER_TEST_IMAGE||'myscouter-capture-worker-test:local';
try{
 for(const mode of ['public','basic','advanced','rejected-login']){
  const uid='fixture-'+randomUUID(),scout='scout-'+randomUUID(),createdAt=new Date().toISOString(),ref=db.collection('privateScouts').doc(scout);
  const login=mode==='public'?undefined:{mode:mode==='advanced'?'advanced':'basic',url:'https://worker-fixture.example.com/login',username:'fictional-owner@example.test',password:'fictional-password-only',consent:true,aiConsent:true};
  const input=parseCaptureInput({url:login?'https://worker-fixture.example.com/account':'https://worker-fixture.example.com/',devices:login?['desktop']:['desktop','tablet','mobile'],login},scout);
  await ref.create({id:scout,userId:uid,url:input.url,domain:'worker-fixture.example.com',brandColor:'#123456',devices:input.devices,createdAt,status:'capturing',pages:[],enhancedAssets:[],copy:null,textContent:''});
  const usage=workStore(db),reservation=await usage.reserve(uid,'capture'),job=await store.create(input,reservation.lease),start=Date.now();
  const envFile=path.join(output,'worker-env-'+job.id+'.txt'),container='myscouter-worker-qa-'+job.id;
  await fs.writeFile(envFile,['NODE_ENV=test','CAPTURE_WORKER_LOCAL=true','CAPTURE_WORKER_JOB_ID='+job.id,'CAPTURE_WORKER_CAPABILITY='+job.token,'CAPTURE_WORKER_BROKER_URL='+brokerURL,'FIXTURE_REJECT_LOGIN='+(mode==='rejected-login')].join('\n'));
  let security;
  try{
   const args=['create','--name',container,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=128','--memory=2g','--cpus=2','--tmpfs=/tmp:rw,noexec,nosuid,size=512m','--env-file',envFile];
   if(process.platform==='linux')args.push('--add-host=host.docker.internal:host-gateway');
   args.push(image);docker(args);
   const detail=JSON.parse(docker(['inspect',container]))[0],h=detail.HostConfig;
   security={user:detail.Config.User,readOnlyRoot:h.ReadonlyRootfs,capDrop:h.CapDrop,memory:h.Memory,nanoCpus:h.NanoCpus,pids:h.PidsLimit,securityOpt:h.SecurityOpt};
   assert.equal(security.user,'10001:10001');assert.equal(security.readOnlyRoot,true);assert.equal(security.memory,2147483648);assert.ok(security.capDrop.includes('ALL'));
   const proc=spawn('docker',['start','--attach',container],{stdio:['ignore','pipe','pipe']});let log='';
   for(const stream of [proc.stdout,proc.stderr])stream.on('data',d=>{log+=d.toString();});
   const timer=setTimeout(()=>{try{docker(['kill',container]);}catch{}},180000);
   const code=await new Promise(resolve=>proc.on('close',resolve));clearTimeout(timer);
   assert.ok(!log.includes('fictional-password-only'));assert.ok(!log.includes('fictional-owner@example.test'));
   const j=await store.read(job.id);
   if(mode==='rejected-login'){
    assert.equal(code,1);assert.equal(j.state,'failed');assert.equal(j.failure,'unsupported-login');assert.equal(Object.keys(j.assets).length,0);
    await ref.update({status:'failed'});await usage.release(reservation.lease);
    cases.push({mode,passed:true,safeFailure:j.failure,images:0,durationMs:Date.now()-start,security});continue;
   }
   assert.equal(code,0,'Worker failed: '+log+' state '+j?.state+' callbacks '+JSON.stringify(callbacks.filter(c=>c.id===job.id)));
   assert.equal(j.state,'ready');assert.equal(j.envelope,null);assert.equal(j.capability,null);
   assert.ok(!j.result.textContent.includes('fictional-password-only'));assert.ok(!j.result.textContent.includes('fictional-owner@example.test'));
   await usage.complete(reservation.lease,ref,{...j.result,status:'captured'});await store.close(job.id,true);
   const record=(await ref.get()).data(),names=recordedAssets(record),own=await readScoutHistory(db,uid,null),foreign=await readScoutHistory(db,'other-'+uid,null);
   assert.ok(own.scouts.some(s=>s.id===scout));assert.equal(foreign.scouts.length,0);
   const bundle=await buildBundle(names,async name=>(await bucket.file('private-scouts/'+scout+'/'+name).download())[0]);
   const checkedZip=await inspectWorkerZip(bundle);assert.equal(checkedZip.entries.length,names.length);
   const filename=path.join(output,'worker-'+mode+'.zip');await fs.writeFile(filename,bundle);
   const steps=callbacks.filter(c=>c.id===job.id);assert.ok(steps.every(c=>c.status===200));
   assert.ok(steps.findIndex(c=>c.action==='progress')<steps.findIndex(c=>c.action==='asset'));
   cases.push({mode,passed:true,images:names.length,pages:record.pages.length,bytes:bundle.length,sha256:createHash('sha256').update(bundle).digest('hex'),file:filename,zipProof:checkedZip,durationMs:Date.now()-start,security});
   console.log(JSON.stringify({mode,passed:true,images:names.length,pages:record.pages.length}));
  }finally{try{docker(['rm','-f',container]);}catch{}await fs.unlink(envFile).catch(()=>{});}
 }
 const report={scope:'local Docker native Chromium 153 with real API broker functions and disposable Firestore/Storage emulators; fictional site responses and worker identity fixture',googleIamOrHostedWorkerProven:false,cases,callbacks:callbacks.map(c=>({action:c.action,status:c.status,time:c.time}))};
 await fs.writeFile(path.join(output,'worker-container-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:true,cases:cases.length,images:cases.reduce((n,c)=>n+c.images,0),report:path.join(output,'worker-container-results.json')}));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.terminate();await deleteApp(app);}
