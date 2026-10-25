import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const image=process.env.WORKER_RUNTIME_IMAGE||'myscouter-capture-worker:local';
const code=`
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {launchCaptureBrowser,prepareCapturePage} from './src/lib/capture-browser.ts';
import sharp from 'sharp';
const timeout=setTimeout(()=>process.exit(2),25000),require=createRequire(import.meta.url);
for(const name of ['firebase-admin','firebase','openai'])assert.throws(()=>require.resolve(name));
for(const file of ['/app/.env.local','/app/src/lib/firebase-admin.ts','/app/src/lib/capture-login-planner.ts','/app/tests/worker/container-fixture.ts','/usr/local/bin/npm','/usr/local/bin/npx'])await assert.rejects(fs.stat(file));
assert.equal(process.getuid(),10001);
await assert.rejects(fs.writeFile('/app/forbidden-write','fictional'));
assert.ok(!Object.keys(process.env).some(k=>/^(FIREBASE_|OPENAI_|VERCEL_)/.test(k)));
const browser=await launchCaptureBrowser('http://127.0.0.1:65500',{width:1440,height:900});
try{
 const version=await browser.version();assert.match(version,/153.0.8010.0/);
 const page=await browser.newPage();await prepareCapturePage(page);
 await page.setContent('<h1>Offline fictional image</h1>');
 const webgl=await page.evaluate(()=>!!document.createElement('canvas').getContext('webgl2'));assert.equal(webgl,true);
 const png=Buffer.from(await page.screenshot({type:'png'}));await sharp(png).raw().toBuffer();
 console.log(JSON.stringify({passed:true,version,node:process.version,user:process.getuid(),apiPackagesAbsent:true,apiFilesAbsent:true,readOnlyRootProven:true,webgl2:webgl,pngBytes:png.length}));
}finally{await browser.close();clearTimeout(timeout);}
`;
const raw=execFileSync('docker',['run','--rm','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=128','--memory=2g','--cpus=2','--tmpfs=/tmp:rw,noexec,nosuid,size=512m','--entrypoint=node',image,'--import','tsx','--input-type=module','-e',code],{encoding:'utf8',timeout:45000,maxBuffer:100000});
const proof=JSON.parse(raw.trim()),detail=JSON.parse(execFileSync('docker',['image','inspect',image],{encoding:'utf8',timeout:10000}))[0];
const report={...proof,scope:'local production image in a restricted offline Docker container; not Google IAM or hosted execution proof',imageId:detail.Id,repoDigests:detail.RepoDigests,architecture:detail.Architecture};
const output=process.env.WORKER_TEST_OUTPUT||path.join(os.tmpdir(),'myscouter-worker-journey');await fs.mkdir(output,{recursive:true});
await fs.writeFile(path.join(output,'worker-image-proof.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
