import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {lookup} from 'node:dns/promises';
import sharp from 'sharp';
import {startCaptureProxy} from '../../src/lib/capture-proxy.ts';
import {launchCaptureBrowser,prepareCapturePage} from '../../src/lib/capture-browser.ts';

// Runs the application's Linux serverless browser, without Firebase, AI or
// customer credentials. Network fixtures stay on this disposable CI machine.
test('serverless capture browser enforces both request and proxy boundaries', {timeout:180000}, async t => {
 assert.equal(process.platform,'linux','Run the production Chromium pack on Linux.');
 assert.equal(process.env.NODE_ENV,'production','The hosted launch path must be selected.');
 let privateHits=0;
 const canary=http.createServer((_req,res)=>{privateHits++;res.end('Private canary reached');});
 await new Promise((resolve,reject)=>{canary.once('error',reject);canary.listen(0,'127.0.0.1',resolve);});
 const privateURL=`http://127.0.0.1:${canary.address().port}/private`;
 const resolutions=[];
 const proxy=await startCaptureProxy(async host=>{
  resolutions.push(host);
  if(host==='blocked-capture.example.com')return [{address:'127.0.0.1',family:4}];
  return lookup(host,{all:true,verbatim:true});
 });
 let browser;
 try {
  browser=await launchCaptureBrowser(proxy.url,{width:1200,height:800});
  const version=await browser.version();
  assert.match(version,/153\./);
  t.diagnostic(`Production capture engine: ${version}`);

  await t.test('public HTTPS page renders and produces a valid PNG through the proxy',async()=>{
   const page=await browser.newPage();
   try {
    await prepareCapturePage(page);
    const response=await page.goto('https://example.com/',{waitUntil:'networkidle2'});
    assert.equal(response.status(),200);
    assert.equal(await page.title(),'Example Domain');
    assert.ok(resolutions.includes('example.com'),'public connection used the checked resolver');
    const png=Buffer.from(await page.screenshot({type:'png'}));
    const decoded=await sharp(png).metadata();
    assert.equal(decoded.format,'png');assert.equal(decoded.width,1200);assert.equal(decoded.height,800);
    assert.ok(png.length>1000);
   } finally {await page.close();}
  });

  await t.test('proxy alone prevents Chromium loopback bypass and private DNS tunnels',async()=>{
   // No application interception here: exercise Chromium's actual proxy route.
   const page=await browser.newPage();
   page.setDefaultNavigationTimeout(15000);
   try {
    const direct=await page.goto(privateURL,{waitUntil:'domcontentloaded'});
    assert.equal(direct.status(),403);
    const dnsHTTP=await page.goto('http://blocked-capture.example.com/private',{waitUntil:'domcontentloaded'});
    assert.equal(dnsHTTP.status(),403);
    await assert.rejects(page.goto('https://blocked-capture.example.com/private',{waitUntil:'domcontentloaded'}),/ERR_TUNNEL_CONNECTION_FAILED/);
    assert.ok(resolutions.includes('blocked-capture.example.com'));
    assert.equal(privateHits,0);
   } finally {await page.close();}
  });

  await t.test('redirect targets are checked by the actual capture request handler',async()=>{
   const page=await browser.newPage();
   try {
    // Only the initial redirect response is synthetic; Chromium follows it and
    // the shared production handler decides the destination's access.
    page.on('request',request=>{
     if(request.url()==='https://redirect-capture.example.com/'&&!request.isInterceptResolutionHandled()) {
      void request.respond({status:302,headers:{location:privateURL}});
     }
    });
    await prepareCapturePage(page);
    await assert.rejects(page.goto('https://redirect-capture.example.com/',{waitUntil:'domcontentloaded'}),/ERR_BLOCKED_BY_CLIENT/);
    assert.equal(privateHits,0);
   } finally {await page.close();}
  });

  await t.test('embedded HTTP and HTTPS resources cannot use private DNS addresses',async()=>{
   const page=await browser.newPage();
   const attempted=new Set(),finished=new Set();
   try {
    await prepareCapturePage(page);
    page.on('request',request=>attempted.add(request.url()));
    page.on('requestfailed',request=>finished.add(request.url()));
    page.on('requestfinished',request=>finished.add(request.url()));
    const urls=['http://blocked-capture.example.com/image.png','https://blocked-capture.example.com/image.png',privateURL];
    await page.setContent(`<html><body>${urls.map(url=>`<img src="${url}">`).join('')}</body></html>`,{waitUntil:'networkidle0'});
    const images=await page.$$eval('img',items=>items.map(img=>({complete:img.complete,width:img.naturalWidth})));
    assert.deepEqual(images,urls.map(()=>({complete:true,width:0})));
    for(const url of urls){assert.ok(attempted.has(url),url);assert.ok(finished.has(url),url);}
    assert.equal(privateHits,0);
   } finally {await page.close();}
  });

  proxy.assertWithinBudget();
 } finally {
  if(browser)await browser.close();
  await proxy.close();
  await new Promise(resolve=>canary.close(resolve));
 }
});
