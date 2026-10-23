import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertOwner, assetName, validScoutId, verifiedUser, readInput, recordedAssets, storedAssetPath, errorResponse, publicScout, ScoutError} from './scout-access.ts';
import {validateCopy} from './scout-copy.ts';
const id='scout-11111111-1111-4111-8111-111111111111';
const record={id,userId:'owner-a',pages:[{screenshots:[{path:'home-desktop-hero.png'}]}],enhancedAssets:['hero-1-enhanced.png']};
test('verified session, not caller identity, selects the owner and checks revocation', async()=>{
 const request=new Request('https://app.example/api/scout',{method:'POST',headers:{Authorization:'Bearer fictional-token'},body:JSON.stringify({userId:'attacker-b'})});
 const seen=[];
 assert.equal(await verifiedUser(request,async(token,revoked)=>{seen.push([token,revoked]);return{uid:'owner-a'};}),'owner-a');
 assert.deepEqual(seen,[['fictional-token',true]]);
});
test('missing, malformed, oversized, revoked and unavailable sessions fail closed',async()=>{
 for(const value of ['', 'Basic a','Bearer a b','Bearer a,Bearer b','Bearer '+ 'x'.repeat(8200)]) {
  let calls=0;
  await assert.rejects(verifiedUser(new Request('https://app.example',{headers:{Authorization:value}}),async()=>{calls++;return{uid:'a'};}),{status:401});
  assert.equal(calls,0);
 }
 const req=new Request('https://app.example',{headers:{Authorization:'Bearer fake'}});
 await assert.rejects(verifiedUser(req,async()=>{throw new Error('secret provider detail');}),{status:401});
 await assert.rejects(verifiedUser(req,async()=>{throw new ScoutError(503,'Unavailable');}),{status:503});
});
test('another owner and absent records have the same unavailable response',()=>{
 assert.equal(assertOwner(record,'owner-a'),record);
 for(const candidate of [record,undefined])assert.throws(()=>assertOwner(candidate,'attacker-b'),{status:404,message:'This scout is unavailable for your account.'});
 assert.equal(publicScout(record).userId,undefined);
});
test('asset references cannot become URLs, another scout, or a filesystem traversal',()=>{
 assert.deepEqual(recordedAssets(record),['home-desktop-hero.png','hero-1-enhanced.png']);
 assert.equal(storedAssetPath(id,'home-desktop-hero.png'),`private-scouts/${id}/home-desktop-hero.png`);
 for(const name of ['../a.png','a/b.png','a\\b.png','https://example.com/a.png','a.png?token=x','%2e%2e.png','a..png','/a.png'])assert.throws(()=>assetName(name));
 for(const value of ['scout-1792770000000','../x',id+'/../another',id.replace('4111','1111')])assert.throws(()=>validScoutId(value));
});
test('malformed and oversized JSON cannot reach a service',async()=>{
 for(const body of ['null','[]','broken','"hello"'])await assert.rejects(readInput(new Request('https://app.example',{method:'POST',body})),{status:400});
 await assert.rejects(readInput(new Request('https://app.example',{method:'POST',body:JSON.stringify({x:'x'.repeat(9000)})})),{status:413});
 assert.deepEqual(await readInput(new Request('https://app.example',{method:'POST',body:'{"scoutId":"x"}'})),{scoutId:'x'});
});
test('provider diagnostics stay private and incomplete AI copy is rejected',async()=>{
 const response=errorResponse(new Error('secret private key and provider URL'));
 assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(JSON.stringify(await response.json()).includes('secret'),false);
 for(const value of [null,{}, {pitch:'x',tagline:'y',twitter:'z',blurbs:['']}, {pitch:'x',tagline:'y',twitter:'z',blurbs:['a'],extra:true, }]) {
  if(value?.extra)assert.deepEqual(validateCopy(value),{pitch:'x',tagline:'y',twitter:'z',blurbs:['a']});
  else assert.throws(()=>validateCopy(value),{status:502});
 }
});
