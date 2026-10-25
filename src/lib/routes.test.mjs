import {test} from 'node:test';
import assert from 'node:assert/strict';
import {POST as scout} from '../app/api/scout/route.ts';
import {POST as deleteAccount} from '../app/api/account/deletion/route.ts';
import {POST as enhance} from '../app/api/enhance/route.ts';
import {POST as copy} from '../app/api/copy/route.ts';
import {POST as bundle} from '../app/api/bundle/route.ts';
import {GET as history} from '../app/api/scouts/route.ts';
import {GET as detail} from '../app/api/scouts/[id]/route.ts';
import {GET as progress} from '../app/api/scout/progress/route.ts';
import {GET as asset} from '../app/api/assets/[...path]/route.ts';
const id='scout-11111111-1111-4111-8111-111111111111';
test('all data and expensive-work endpoints reject unsigned requests without credentials',async()=>{
 for(const handler of [scout,enhance,copy,bundle,deleteAccount]) {
  const response=await handler(new Request('https://app.example/api',{method:'POST',body:JSON.stringify({userId:'forged',scoutId:id,pages:[],assets:[]})}));
  assert.equal(response.status,401,handler.name);assert.equal((await response.json()).error,'Sign in to continue.');
 }
 for(const [handler,path,params] of [[history,'/api/scouts',{}],[detail,'/api/scouts/'+id,{id}],[progress,'/api/scout/progress?jobId='+id,{}],[asset,'/api/assets/'+id+'/a.png',{path:[id,'a.png']}]]) {
  const response=await handler(new Request('https://app.example'+path),{params:Promise.resolve(params)});
  assert.equal(response.status,401,path);
 }
});
