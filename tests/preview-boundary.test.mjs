import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
const root=new URL('../',import.meta.url);
async function run(mode,expected) {
 const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,NODE_ENV:'production',VERCEL_ENV:mode},stdio:['ignore','pipe','pipe']});
 let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk.toString()).slice(-4000);});
 try {
  let ready=false;const deadline=Date.now()+30000;
  while(Date.now()<deadline) {
   if(child.exitCode!==null)throw Error('Next exited: '+output);
   try{const response=await fetch('http://127.0.0.1:'+port+'/',{signal:AbortSignal.timeout(1500)});if(response.ok){ready=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(ready,true,'Production server startup: '+output);
  const response=await fetch('http://127.0.0.1:'+port+'/readiness',{signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,expected,mode+' tester route');
  const fixture=await fetch('http://127.0.0.1:'+port+'/api/readiness/history-fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'seed',confirmation:'CREATE 45 FIXTURES'}),signal:AbortSignal.timeout(15000)});
  assert.equal(fixture.status,mode==='production'?404:401,'No unsigned or production fixture capability');
  const worker=await fetch('http://127.0.0.1:'+port+'/api/capture-worker/11111111-1111-4111-8111-111111111111/claim',{method:'POST',body:'{}',signal:AbortSignal.timeout(15000)});
  assert.equal(worker.status,404,'Worker callbacks stay unavailable without explicit preview activation');
  const html=await response.text();
  if(expected===200)assert.match(html,/Loading test session/);
  else assert.doesNotMatch(html,/First-account fictional pack IDs/);
 } finally {
  if(child.exitCode===null) {
   const exited=once(child,'exit');child.kill('SIGTERM');
   let timer;try{await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,3000);})]);}finally{clearTimeout(timer);}
   if(child.exitCode===null){child.kill('SIGKILL');await exited;}
  }
 }
}
test('production configuration hides the preview privacy tester',{timeout:50000},()=>run('production',404));
test('preview configuration serves the tester without a server authentication bypass',{timeout:50000},()=>run('preview',200));
