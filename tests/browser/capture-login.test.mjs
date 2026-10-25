import {test} from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import core from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';
import {prepareCapturePage} from '../../src/lib/capture-browser.ts';
import {signInForCapture,inspectLoginFields} from '../../src/lib/capture-login.ts';

const origin='https://login-fixture.example.com';
const login={mode:'basic',url:origin+'/login',username:'fictional-owner@example.test',password:'fictional-password-only'};
const form=(extra='',action='/session',method='post')=>`<!doctype html><form method="${method}" action="${action}"><label>Username<input name="username" autocomplete="username"></label><label>Password<input name="password" type="password"></label><button type="submit">Sign in</button>${extra}</form>`;

test('real browser verifies bounded native login using only synthetic responses and credentials',{timeout:180000},async t=>{
 const browser=process.platform==='linux'?await core.launch({executablePath:await chromium.executablePath('https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar'),args:chromium.args,headless:'shell',pipe:true}):await puppeteer.launch({channel:'chrome',headless:true,pipe:true});
 const fixture=async(html,options={})=>{
  const context=await browser.createBrowserContext(),page=await context.newPage();
  const credentials={...login,mode:options.advanced?'advanced':'basic'};
  const controls=await prepareCapturePage(page,credentials),posts=[],blocked=[];
  let authenticated=false;
  page.on('requestfailed',request=>blocked.push(request.url()));
  page.on('request',request=>{
   if(request.isInterceptResolutionHandled())return;
   // Cooperative response cannot override the shared application's abort.
   if(request.interceptResolutionState().action==='abort')return;
   const url=new URL(request.url());
   if(url.origin!==origin){void request.abort('blockedbyclient',0);return;}
   if(request.method()==='POST') {
    posts.push({path:url.pathname,body:new URLSearchParams(request.postData())});
    if(options.reject){void request.respond({status:401,body:form()},0);return;}
    if(options.multi && url.pathname==='/username') {void request.respond({status:200,contentType:'text/html',body:'<form method="post" action="/session"><input name="password" type="password"><button type="submit">Continue</button></form>'},0);return;}
    authenticated=true;
    void request.respond({status:303,headers:{location:origin+'/account','set-cookie':'fixture-session=synthetic; Path=/; Secure; HttpOnly; SameSite=Lax'}},0);return;
   }
   const content=url.pathname==='/login'?html:authenticated?`<h1>Fictional customer page</h1><p>${login.username} ${login.password}</p><form method="post" action="/delete"><button>Delete</button></form>`:form();
   void request.respond({status:200,contentType:'text/html',body:content},0);
  });
  return {page,controls,credentials,posts,blocked,close:()=>context.close()};
 };
 try {
  await t.test('basic login posts credentials once, redacts captured content, then blocks writes and outside origins',async()=>{
   const f=await fixture(form('<script>window.stolePassword=true;window.open("https://outside.example.com/")</script>'));
   try {
    await f.page.goto(login.url);
    assert.deepEqual((await inspectLoginFields(f.page,f.credentials)).map(field=>field.kind),['username','password','submit']);
    await signInForCapture(f.page,f.credentials,new URL(origin+'/account'),f.controls);
    assert.equal(f.posts.length,1);assert.equal(f.posts[0].body.get('username'),login.username);assert.equal(f.posts[0].body.get('password'),login.password);
    const text=await f.page.$eval('body',element=>element.innerText);assert.ok(text.includes('Fictional customer page'));assert.ok(!text.includes(login.password));assert.ok(!text.includes(login.username));
    assert.equal(await f.page.evaluate(()=>window.stolePassword),undefined);
    await f.page.evaluate(()=>{const form=document.createElement('form');form.method='post';form.action='/delete';document.body.append(form);form.submit();});
    await f.page.waitForRequest(request=>request.url().endsWith('/delete'),{timeout:1000}).catch(()=>{});
    assert.equal(f.posts.length,1);
    await assert.rejects(f.page.goto('https://outside.example.com/'),/ERR_BLOCKED_BY_CLIENT/);
   } finally {await f.close();}
  });
  await t.test('AI receives redacted field metadata and can only select checked IDs',async()=>{
   const f=await fixture(form().replace('Username',`Username ${login.username} ${login.password}`),{advanced:true});
   let supplied;
   try {
    await signInForCapture(f.page,f.credentials,new URL(origin+'/account'),f.controls,async fields=>{
     supplied=JSON.stringify(fields);return {username:fields.find(x=>x.kind==='username').id,password:fields.find(x=>x.kind==='password').id,submit:fields.find(x=>x.kind==='submit').id};
    });
    assert.ok(!supplied.includes(login.username));assert.ok(!supplied.includes(login.password));assert.equal(f.posts.length,1);
   } finally {await f.close();}
  });
  await t.test('username then password forms complete within the two-step limit',async()=>{
   const f=await fixture('<form method="post" action="/username"><input name="username" autocomplete="username"><button type="submit">Next</button></form>',{multi:true});
   try {await signInForCapture(f.page,f.credentials,new URL(origin+'/account'),f.controls);assert.equal(f.posts.length,2);assert.equal(f.posts[0].body.get('password'),null);assert.equal(f.posts[1].body.get('password'),login.password);}
   finally {await f.close();}
  });
  await t.test('failed passwords never fall back to a guest capture',async()=>{
   const f=await fixture(form(),{reject:true});
   try {await assert.rejects(signInForCapture(f.page,f.credentials,new URL(origin+'/account'),f.controls),error=>error.status===422&&!error.message.includes(login.password));assert.equal(f.posts.length,1);}
   finally {await f.close();}
  });
  await t.test('GET, outside-origin and overridden-action forms cannot receive credentials',async()=>{
   for(const html of [form('','/session','get'),form('','https://outside.example.com/session'),form().replace('type="submit"','type="submit" formaction="/other"')]) {
    const f=await fixture(html);
    try {await assert.rejects(signInForCapture(f.page,f.credentials,new URL(origin+'/account'),f.controls),{status:422});assert.equal(f.posts.length,0);}
    finally {await f.close();}
   }
  });
  await t.test('untrusted AI output cannot add actions, choose outside fields or trigger a POST',async()=>{
   const f=await fixture(form(),{advanced:true});
   try {await assert.rejects(signInForCapture(f.page,f.credentials,new URL(origin+'/account'),f.controls,async()=>({password:1,submit:2,action:'delete'})),{status:422});assert.equal(f.posts.length,0);}
   finally {await f.close();}
  });
 } finally {await browser.close();}
});
