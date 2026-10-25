import {runWorker} from '../../worker/run';
import {launchCaptureBrowser} from '../../src/lib/capture-browser';
// Only the test image contains this fixture. Production has no fixture switch.
const origin='https://worker-fixture.example.com';
setTimeout(()=>{console.error('fixture_timeout');process.exit(1);},170000);
runWorker(process.env,async(proxy,viewport)=>{
 const browser=await launchCaptureBrowser(proxy,viewport),newPage=browser.newPage.bind(browser);
 browser.newPage=async()=>{
  const page=await newPage();let authenticated=false;
  page.on('request',request=>{
   if(request.isInterceptResolutionHandled()||request.interceptResolutionState().action==='abort')return;
   const u=new URL(request.url());if(u.origin!==origin)return;
   if(request.method()==='POST'){
    if(process.env.FIXTURE_REJECT_LOGIN==='true'){void request.respond({status:401,body:'<input type="password">'},0);return;}
    authenticated=true;void request.respond({status:303,headers:{location:origin+'/account','set-cookie':'fixture-session=fictional; Secure; HttpOnly; Path=/; SameSite=Lax'}},0);return;
   }
   const form='<form method="post" action="/session"><label>Username<input name="username" autocomplete="username"></label><label>Password<input name="password" type="password"></label><button type="submit">Sign in</button></form>';
   const content=u.pathname==='/login'?form:'<nav><a href="/about">About fixture</a></nav><h1>Fictional customer capture</h1><p>Fixture text only '+(authenticated?'fictional-owner@example.test fictional-password-only':'')+'</p>';
   void request.respond({status:200,contentType:'text/html',body:'<!doctype html><style>body{background:#eee7da;color:#253721;font:24px sans-serif;min-height:3300px;padding:24px}</style>'+content},0);
  });return page;
 };return browser;
}).then(()=>process.exit(0)).catch(error=>{const message=String(error?.message||'fixture failed').split('fictional-password-only').join('[redacted]').split('fictional-owner@example.test').join('[redacted]');console.error('fixture_failure '+message.slice(0,500));process.exit(1);});
