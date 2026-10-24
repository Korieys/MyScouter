import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'});
for(const key of ['window','self','document','HTMLElement','Node','MutationObserver','navigator'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true,writable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {render,screen,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const {ScoutHistory}=await import('../../src/components/scout-history.tsx');
const originalFetch=globalThis.fetch;
afterEach(()=>{cleanup();globalThis.fetch=originalFetch;});
const user=uid=>({uid,getIdToken:async()=>uid});
const entry=n=>({id:`scout-${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,url:`https://site${n}.example`,domain:`site${n}.example`,status:'complete',createdAt:'2026-10-23T00:00:00.000Z',devices:['desktop'],pages:[]});
const response=(scouts,nextCursor=null)=>Response.json({scouts,nextCursor});
const view=user=>React.createElement(ScoutHistory,{user});

test('loads older packs once per click and preserves rows on a retryable page failure',async()=>{
 const owner=user('owner-a'),calls=[];let resolvePage;
 globalThis.fetch=async path=>{calls.push(path);if(calls.length===1)return response([entry(1)],'page-two');if(calls.length===2)return new Promise(resolve=>{resolvePage=resolve;});return response([entry(2)]);};
 render(view(owner));await screen.findByText('site1.example');
 fireEvent.click(screen.getByRole('button',{name:'Load older scouts'}));
 fireEvent.click(screen.getByRole('button',{name:'Load older scouts'}));
 await waitFor(()=>assert.equal(calls.length,2));
 assert.equal(screen.getByRole('button',{name:'Load older scouts'}).disabled,true);
 await act(async()=>resolvePage(Response.json({error:'Temporary history failure'},{status:503})));
 await screen.findByRole('alert');assert.ok(screen.getByText('site1.example'));
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByText('site2.example');
 assert.deepEqual(calls,['/api/scouts','/api/scouts?cursor=page-two','/api/scouts?cursor=page-two']);
 assert.equal(screen.getAllByRole('article').length,2);assert.equal(screen.queryByRole('button',{name:'Load older scouts'}),null);
 assert.equal(screen.getByRole('link',{name:'View pack for site2.example'}).getAttribute('href'),`/preview/${entry(2).id}`);
});

test('initial errors retry without a reload and refresh failures retry the first page',async()=>{
 let request=0;const calls=[];
 globalThis.fetch=async path=>{calls.push(path);request++;return request===1||request===3?Response.json({error:'Retry this load'},{status:503}):response([entry(request)],request===2?'older':null);};
 render(view(user('owner-a')));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByText('site2.example');
 fireEvent.click(screen.getByRole('button',{name:'Refresh history'}));await screen.findByRole('alert');assert.ok(screen.getByText('site2.example'));
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByText('site4.example');
 assert.equal(screen.queryByText('site2.example'),null);assert.deepEqual(calls,Array(4).fill('/api/scouts'));
});

test('account changes immediately discard old rows and ignore an old account response',async()=>{
 let finishOld;const signals=[];
 globalThis.fetch=async(path,options)=>{
  signals.push(options.signal);
  if(options.headers.get('Authorization')==='Bearer owner-b')return response([entry(9)]);
  if(path.includes('cursor'))return new Promise(resolve=>{finishOld=resolve;});
  return response([entry(1)],'older');
 };
 const rendered=render(view(user('owner-a')));await screen.findByText('site1.example');
 fireEvent.click(screen.getByRole('button',{name:'Load older scouts'}));await waitFor(()=>assert.ok(finishOld));
 rendered.rerender(view(user('owner-b')));assert.equal(screen.queryByText('site1.example'),null);
 await screen.findByText('site9.example');assert.equal(signals[1].aborted,true);
 await act(async()=>finishOld(response([entry(2)])));
 assert.equal(screen.queryByText('site2.example'),null);assert.equal(screen.getAllByRole('article').length,1);
});

test('refresh replaces history and repeated pack IDs cannot create duplicate cards',async()=>{
 let request=0;
 globalThis.fetch=async()=>++request===1?response([entry(1)],'older'):request===2?response([entry(1),entry(2)]):response([entry(3)]);
 render(view(user('owner-a')));await screen.findByText('site1.example');fireEvent.click(screen.getByRole('button',{name:'Load older scouts'}));await screen.findByText('site2.example');
 assert.equal(screen.getAllByRole('article').length,2);
 fireEvent.click(screen.getByRole('button',{name:'Refresh history'}));await screen.findByText('site3.example');assert.equal(screen.getAllByRole('article').length,1);
});

test('empty history has a clear first-capture action and no older-page control',async()=>{
 globalThis.fetch=async()=>response([]);render(view(user('empty-owner')));
 await screen.findByText('No scouts yet');assert.equal(screen.getByRole('link',{name:'Send Your First Scout'}).getAttribute('href'),'/scout');assert.equal(screen.queryByRole('button',{name:'Load older scouts'}),null);
});

test('strict-effect cleanup cannot cancel a replacement load or publish a late result after unmount',async()=>{
 const requests=[];
 globalThis.fetch=async(path,options)=>{
  requests.push(options.signal);
  if(options.signal.aborted)throw Error('cancelled request');
  return response([entry(1)]);
 };
 const rendered=render(React.createElement(React.StrictMode,null,view(user('strict-owner'))));
 await screen.findByText('site1.example');assert.equal(screen.getAllByRole('article').length,1);
 let complete;globalThis.fetch=async(path,options)=>{requests.push(options.signal);return new Promise(resolve=>{complete=resolve;});};
 fireEvent.click(screen.getByRole('button',{name:'Refresh history'}));await waitFor(()=>assert.ok(complete));
 rendered.unmount();assert.equal(requests.at(-1).aborted,true);
 await act(async()=>complete(response([entry(2)])));assert.equal(screen.queryByText('site2.example'),null);
});
