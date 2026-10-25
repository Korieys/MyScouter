import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.test'});
for(const key of ['window','self','document','HTMLElement','Node','MutationObserver','navigator'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true,writable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {render,screen,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const {HostedPrivacyChecks}=await import('../../src/components/hosted-privacy-checks.tsx');
const originalFetch=globalThis.fetch;
afterEach(()=>{cleanup();globalThis.fetch=originalFetch;});
const id='scout-11111111-1111-4111-8111-111111111111';
const fixture=async(path,options)=>{
 if(new Headers(options.headers).get('Authorization')!=='Bearer fictional')return Response.json({error:'Sign in'},{status:401});
 if(path.startsWith('/api/scouts?'))return Response.json({error:'Invalid cursor'},{status:400});
 return path==='/api/scouts'?Response.json({scouts:[]}):Response.json({error:'This scout is unavailable for your account.'},{status:404});
};
const view=user=>React.createElement(HostedPrivacyChecks,{user,current:()=>true});
test('duplicate clicks share one run and report sanitized endpoint results',async()=>{
 let finish,tokens=0;const calls=[];
 globalThis.fetch=async(path,options)=>{calls.push(path);return fixture(path,options);};
 const user={uid:'fixture-owner',getIdToken:()=>{tokens++;return tokens===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve('fictional');}};
 render(view(user));fireEvent.change(screen.getByLabelText('First-account fictional pack IDs (up to three)'),{target:{value:id}});
 fireEvent.click(screen.getByRole('button',{name:'Run privacy checks'}));fireEvent.click(screen.getByRole('button',{name:'Checking access…'}));
 assert.equal(tokens,1);assert.equal(screen.getByRole('button',{name:'Checking access…'}).disabled,true);
 await act(async()=>finish('fictional'));await screen.findByText('All checks passed');
 assert.equal(calls.filter(path=>path==='/api/scouts').length,2);
 assert.ok(screen.getByRole('button',{name:'Save verification report'}));
});
test('canceling and unmounting do not allow late token requests to reach the server',async()=>{
 let finish,calls=0;
 globalThis.fetch=()=>{calls++;throw Error('Unexpected fetch');};
 const rendered=render(view({uid:'fixture-owner',getIdToken:()=>new Promise(resolve=>{finish=resolve;})}));
 fireEvent.change(screen.getByLabelText('First-account fictional pack IDs (up to three)'),{target:{value:id}});
 fireEvent.click(screen.getByRole('button',{name:'Run privacy checks'}));fireEvent.click(screen.getByRole('button',{name:'Cancel checks'}));
 await screen.findByRole('alert');assert.equal(screen.getByRole('button',{name:'Run privacy checks'}).disabled,false);
 rendered.unmount();await act(async()=>finish('fictional'));await waitFor(()=>assert.equal(calls,0));
});
