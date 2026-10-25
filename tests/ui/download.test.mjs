import {test,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {privateBinary} from '../../src/lib/private-binary.ts';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.test/'});
for(const key of ['window','self','document','HTMLElement','Node','MutationObserver','navigator'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true,writable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {render,screen,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const {usePrivateDownload}=await import('../../src/lib/use-private-download.ts');
const originalFetch=globalThis.fetch,originalTimeout=globalThis.setTimeout;
const owner=uid=>({uid,getIdToken:async()=>uid});
const id='scout-11111111-1111-4111-8111-111111111111';
const file=()=>privateBinary(Buffer.from('complete fixture'),{'Content-Type':'application/zip'});
afterEach(()=>{cleanup();globalThis.fetch=originalFetch;mock.restoreAll();});
function DownloadControls({user,scout=id,current=()=>true}){
 const {download,downloading,downloadError}=usePrivateDownload(user,scout,current);
 return React.createElement('div',null,
  React.createElement('button',{disabled:!!downloading,onClick:()=>void download()},'Download ZIP'),
  React.createElement('button',{disabled:!!downloading,onClick:()=>void download('hero.png')},'Save image'),
  downloading&&React.createElement('p',{role:'status'},'Checking download'),
  downloadError&&React.createElement('p',{role:'alert'},downloadError));
}
const view=props=>React.createElement(DownloadControls,props);
function observeSaves(){
 const blobs=[],saves=[],revocations=[],timers=[];
 mock.method(URL,'createObjectURL',blob=>{blobs.push(blob);return `blob:https://example.test/${blobs.length}`});
 mock.method(URL,'revokeObjectURL',url=>revocations.push(url));
 mock.method(dom.window.HTMLAnchorElement.prototype,'click',function(){assert.ok(this.isConnected);saves.push(this.download);});
 mock.method(globalThis,'setTimeout',(fn,ms,...args)=>{if(ms===60_000){timers.push(fn);return 1;}return originalTimeout(fn,ms,...args);});
 return {blobs,saves,revocations,timers};
}

test('duplicate download clicks issue one request and save only a verified file',async()=>{
 const saved=observeSaves();let finish,calls=0;
 globalThis.fetch=async()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
 render(view({user:owner('owner-a')}));fireEvent.click(screen.getByText('Download ZIP'));fireEvent.click(screen.getByText('Download ZIP'));
 await waitFor(()=>assert.ok(finish));assert.equal(calls,1);assert.equal(screen.getByText('Save image').disabled,true);
 await act(async()=>finish(file()));await waitFor(()=>assert.equal(saved.saves.length,1));
 assert.deepEqual(saved.saves,[`myscouter-${id}.zip`]);assert.equal(saved.blobs[0].size,16);assert.equal(screen.getByText('Download ZIP').disabled,false);
 assert.equal(document.querySelectorAll('a').length,0);saved.timers[0]();assert.equal(saved.revocations.length,1);
});

test('an invalid response releases controls and a retry saves the repaired file',async()=>{
 const saved=observeSaves();let calls=0;
 globalThis.fetch=async()=>++calls===1?new Response('truncated',{headers:file().headers}):file();
 render(view({user:owner('owner-a')}));fireEvent.click(screen.getByText('Download ZIP'));
 await screen.findByRole('alert');assert.equal(saved.saves.length,0);assert.equal(screen.getByText('Download ZIP').disabled,false);
 fireEvent.click(screen.getByText('Download ZIP'));await waitFor(()=>assert.equal(saved.saves.length,1));assert.equal(screen.queryByRole('alert'),null);
});

test('refreshing the same account object does not strand an active download',async()=>{
 const saved=observeSaves();let finish,signal;
 globalThis.fetch=async(path,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});};
 const rendered=render(view({user:owner('owner-a')}));fireEvent.click(screen.getByText('Download ZIP'));await waitFor(()=>assert.ok(finish));
 rendered.rerender(view({user:owner('owner-a')}));assert.equal(signal.aborted,false);
 await act(async()=>finish(file()));await waitFor(()=>assert.equal(saved.saves.length,1));assert.equal(screen.getByText('Download ZIP').disabled,false);
});

test('switching accounts cancels the old file and cannot save a late response',async()=>{
 const saved=observeSaves();let finish;const signals=[];
 globalThis.fetch=async(path,options)=>{signals.push(options.signal);if(options.headers.get('authorization')==='Bearer owner-b')return file();return new Promise(resolve=>{finish=resolve;});};
 const rendered=render(view({user:owner('owner-a')}));fireEvent.click(screen.getByText('Download ZIP'));await waitFor(()=>assert.ok(finish));
 rendered.rerender(view({user:owner('owner-b')}));assert.equal(signals[0].aborted,true);assert.equal(screen.getByText('Download ZIP').disabled,false);
 fireEvent.click(screen.getByText('Download ZIP'));await waitFor(()=>assert.equal(saved.saves.length,1));
 await act(async()=>finish(file()));assert.equal(saved.saves.length,1);assert.equal(screen.queryByRole('alert'),null);
});

test('changing packs or unmounting cancels downloads without saving old bytes',async()=>{
 for(const action of ['new-pack','unmount']){
  const saved=observeSaves();let finish,signal;
  globalThis.fetch=async(path,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});};
  const user=owner('same-owner'),rendered=render(view({user}));fireEvent.click(screen.getByText('Download ZIP'));await waitFor(()=>assert.ok(finish));
  if(action==='new-pack')rendered.rerender(view({user,scout:'scout-22222222-2222-4222-8222-222222222222'}));else rendered.unmount();
  assert.equal(signal.aborted,true);await act(async()=>finish(file()));assert.equal(saved.saves.length,0);
  cleanup();mock.restoreAll();
 }
});

test('a changed current session blocks file saving before the account context catches up',async()=>{
 const saved=observeSaves();let finish;
 globalThis.fetch=async()=>new Promise(resolve=>{finish=resolve;});
 let currentUid='owner-a';const user=owner('owner-a');
 render(view({user,current:()=>currentUid===user.uid}));fireEvent.click(screen.getByText('Download ZIP'));await waitFor(()=>assert.ok(finish));
 // Firebase can expose a new currentUser before React receives its context update.
 currentUid='owner-b';await act(async()=>finish(file()));assert.equal(saved.saves.length,0);
 fireEvent.click(screen.getByText('Download ZIP'));assert.equal(saved.saves.length,0);
});
