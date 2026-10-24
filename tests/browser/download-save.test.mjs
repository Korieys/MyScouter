import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Readable} from 'node:stream';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,mkdtemp,readdir,rm,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import ts from 'typescript';
import sharp from 'sharp';
import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import {buildBundle} from '../../src/lib/bundle.ts';
import {privateBinary} from '../../src/lib/private-binary.ts';

const id='scout-11111111-1111-4111-8111-111111111111';
const digest=data=>createHash('sha256').update(data).digest('hex');
async function fileDigest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function waitForSavedFile(folder,name,bytes){
 const file=path.join(folder,name),until=Date.now()+20000;
 while(Date.now()<until){
  try{if((await stat(file)).size===bytes)return file;}catch(error){if(error.code!=='ENOENT')throw error;}
  await delay(100);
 }
 throw Error(`Browser did not finish saving ${name}`);
}

// A disposable Linux browser, local synthetic HTTP server and actual download
// directory. No user browser, Firebase session, live object or credential is used.
// The browser imports the production download reader/saver, not a reimplementation.
test('Chromium saves verified private downloads and recovers after failures',{timeout:240000},async t=>{
 assert.equal(process.platform,'linux','Run the pinned Chromium fixture on Linux.');
 const folder=await mkdtemp(path.join(tmpdir(),'myscouter-download-'));
 const sources=new Map();
 for(const [url,file] of [['/private-download.js','private-download.ts'],['/auth-fetch','auth-fetch.ts']]){
  const source=await readFile(new URL(`../../src/lib/${file}`,import.meta.url),'utf8');
  sources.set(url,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
 }
 const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic download verification</title>
 <button id="zip" disabled>Download ZIP</button><button id="image" disabled>Save image</button><button id="cancel">Cancel</button><output id="status">Starting</output>
 <script type="module">
 import {loadPrivateDownload,savePrivateDownload} from '/private-download.js';
 const owner={uid:'synthetic-owner',getIdToken:async()=>'synthetic-token'};
 let pending;const status=document.querySelector('#status');
 async function download(filename){
  if(pending)return;pending=new AbortController();status.textContent='Loading';
  try{const blob=await loadPrivateDownload(owner,'${id}',filename,pending.signal);savePrivateDownload(blob,filename||'pack.zip');status.textContent='Saved';}
  catch(error){status.textContent=error.message;}finally{pending=null;}
 }
 document.querySelector('#zip').onclick=()=>download();document.querySelector('#image').onclick=()=>download('mobile.png');
 document.querySelector('#cancel').onclick=()=>pending?.abort();
 document.querySelector('#zip').disabled=false;document.querySelector('#image').disabled=false;status.textContent='Ready';
 </script>`;
 let activeZip,mode='good',requests=0,abortedResponses=0;
 const smallZip=await buildBundle(['synthetic.png'],async()=>randomBytes(1024*1024));
 const png=await sharp({create:{width:1200,height:800,channels:3,background:'#6c43c0'}}).png().toBuffer();
 const serverErrors=[];
 const server=http.createServer((req,res)=>{
  void(async()=>{
   if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
   if(sources.has(req.url)){res.setHeader('Content-Type','text/javascript');res.end(sources.get(req.url));return;}
   const isZip=req.url==='/api/bundle'&&req.method==='POST';
   const isImage=req.url===`/api/assets/${id}/mobile.png`&&req.method==='GET';
   if(!isZip&&!isImage){res.writeHead(404);res.end();return;}
   assert.equal(req.headers.authorization,'Bearer synthetic-token');
   if(isZip){let body='';for await(const chunk of req)body+=chunk;assert.deepEqual(JSON.parse(body),{scoutId:id});}
   requests++;
   const bytes=isImage?png:activeZip;
   const response=privateBinary(bytes,{'Content-Type':isImage?'image/png':'application/zip'});
   res.writeHead(200,Object.fromEntries(response.headers));
   if(mode==='stall'){
    res.write(bytes.subarray(0,1024));
    res.once('close',()=>{abortedResponses++;});
    return;
   }
   if(mode==='truncated'){res.end(bytes.subarray(0,bytes.length-17));return;}
   if(mode==='corrupt'){
    res.write(Buffer.from([bytes[0]^1]));res.end(bytes.subarray(1));return;
   }
   const stream=Readable.fromWeb(response.body);
   stream.on('error',error=>res.destroy(error));res.on('close',()=>stream.destroy());stream.pipe(res);
  })().catch(error=>{serverErrors.push(error);res.destroy(error);});
 });
 let browser;
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const executablePath=await chromium.executablePath('https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar');
  browser=await puppeteer.launch({executablePath,args:chromium.args,headless:'shell',pipe:true,downloadBehavior:{policy:'allow',downloadPath:folder}});
  assert.match(await browser.version(),/153\./);t.diagnostic(`Download engine: ${await browser.version()}`);
  const page=await browser.newPage();
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='Ready');
  const statusIs=text=>page.waitForFunction(text=>document.querySelector('#status').textContent===text,{timeout:70000},text);
  const startZip=()=>page.click('#zip');

  await t.test('maximum 128 MiB input pack is saved byte-for-byte by the native download manager',async()=>{
   activeZip=await buildBundle(Array.from({length:8},(_,n)=>`synthetic-${n}.png`),async()=>randomBytes(16*1024*1024));
   assert.ok(activeZip.length>128*1024*1024);assert.ok(activeZip.length<129*1024*1024);
   const expected=digest(activeZip),start=Date.now();
   await startZip();await statusIs('Saved');
   const saved=await waitForSavedFile(folder,'pack.zip',activeZip.length);
   assert.equal(await fileDigest(saved),expected);
   assert.equal(requests,1);assert.deepEqual(await readdir(folder),['pack.zip']);
   t.diagnostic(`Native ZIP saved: ${activeZip.length} bytes, SHA-256 ${expected}, ${Date.now()-start} ms`);
   // Files are disposable fixtures in a fresh test-owned temp directory.
   await rm(saved);activeZip=smallZip;
  });

  await t.test('truncated and corrupted responses never save a file; a retry succeeds',async()=>{
   activeZip=smallZip;
   for(const failure of ['truncated','corrupt']){
    mode=failure;await startZip();await statusIs('The download was incomplete or damaged. Please retry.');
    assert.deepEqual(await readdir(folder),[]);
   }
   mode='good';await startZip();await statusIs('Saved');
   const saved=await waitForSavedFile(folder,'pack.zip',smallZip.length);
   assert.equal(await fileDigest(saved),digest(smallZip));await rm(saved);
  });

  await t.test('cancelling a stalled stream closes the response and a fresh attempt saves',async()=>{
   mode='stall';const before=requests;
   await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/bundle')),startZip()]);
   assert.equal(requests,before+1);await page.click('#cancel');await statusIs('Download cancelled.');
   const until=Date.now()+5000;while(abortedResponses===0&&Date.now()<until)await delay(50);
   assert.equal(abortedResponses,1);assert.deepEqual(await readdir(folder),[]);
   mode='good';await startZip();await statusIs('Saved');
   const saved=await waitForSavedFile(folder,'pack.zip',smallZip.length);
   assert.equal(await fileDigest(saved),digest(smallZip));await rm(saved);
  });

  await t.test('PNG save works in an emulated narrow touch viewport',async()=>{
   await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1});
   await page.click('#image');await statusIs('Saved');
   const saved=await waitForSavedFile(folder,'mobile.png',png.length);
   assert.equal(await fileDigest(saved),digest(png));
   const decoded=await sharp(saved).metadata();assert.equal(decoded.width,1200);assert.equal(decoded.height,800);assert.equal(decoded.format,'png');
   assert.deepEqual(await readdir(folder),['mobile.png']);
  });
  assert.deepEqual(serverErrors,[]);assert.deepEqual(pageErrors,[]);
 }finally{
  if(browser)await browser.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  // Resolve and constrain the recursive cleanup to this test-created directory.
  assert.equal(path.dirname(path.resolve(folder)),path.resolve(tmpdir()));assert.match(path.basename(folder),/^myscouter-download-/);
  await rm(folder,{recursive:true,force:true});
 }
});
