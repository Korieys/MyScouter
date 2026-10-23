import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildBundle, validateAssets} from './bundle.ts';
const id='scout-1792770000000';
const base=`https://storage.googleapis.com/test-bucket/scouts/${id}/`;
test('accepts and deduplicates only public images in this scout bucket',()=>{
 assert.deepEqual(validateAssets(id,[base+'hero.png',base+'hero.png'],'test-bucket'),[base+'hero.png']);
 for(const url of ['http://localhost/a.png',base+'../secret.png',base+'a.png?token=x',base.replace(id,'scout-1792770000001')+'a.png','https://storage.googleapis.com/other/scouts/'+id+'/a.png']) {
  assert.throws(()=>validateAssets(id,[url],'test-bucket'));
 }
 assert.throws(()=>validateAssets('../x',[base+'a.png'],'test-bucket'));
 assert.throws(()=>validateAssets(id,[],'test-bucket'));
});
test('complete ZIP contains raw and enhanced files with intact contents',async()=>{
 const names=['hero.png','feature.png','hero-enhanced.png','grid.png'];
 const zip=await buildBundle(names.map(n=>base+n),async input=>new Response('fixture:'+String(input).split('/').pop()));
 const end=zip.length-22;
 assert.equal(zip.readUInt32LE(end),0x06054b50);
 assert.equal(zip.readUInt16LE(end+10),names.length);
 let offset=zip.readUInt32LE(end+16);
 const found=[];
 for(let i=0;i<names.length;i++) {
  assert.equal(zip.readUInt32LE(offset),0x02014b50);
  const size=zip.readUInt32LE(offset+20), nameLength=zip.readUInt16LE(offset+28);
  const name=zip.subarray(offset+46,offset+46+nameLength).toString();
  const local=zip.readUInt32LE(offset+42);
  const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
  assert.equal(inflateRawSync(zip.subarray(start,start+size)).toString(),'fixture:'+name);
  found.push(name);
  offset+=46+nameLength+zip.readUInt16LE(offset+30)+zip.readUInt16LE(offset+32);
 }
 assert.deepEqual(found.sort(),names.sort());
});
test('missing or empty files fail rather than returning a partial ZIP',async()=>{
 await assert.rejects(buildBundle([base+'a.png'],async()=>new Response('missing',{status:404})));
 await assert.rejects(buildBundle([base+'a.png'],async()=>new Response('')));
 await assert.rejects(buildBundle([base+'a.png'],async()=>{throw new Error('timeout')}));
});
