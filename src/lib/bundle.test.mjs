import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {buildBundle} from './bundle.ts';
test('complete ZIP contains raw and enhanced files with intact contents',async()=>{
 const names=['hero.png','feature.png','hero-enhanced.png','grid.png'];
 const zip=await buildBundle(names,async name=>Buffer.from('fixture:'+name));
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
 await assert.rejects(buildBundle(['a.png'],async()=>{throw new Error('missing')}));
 await assert.rejects(buildBundle(['a.png'],async()=>Buffer.alloc(0)));
 await assert.rejects(buildBundle(['a.png'],async()=>{throw new Error('timeout')}));
});

test('invalid paths and empty packs never invoke storage',async()=>{let called=0;const load=async()=>{called++;return Buffer.from('x');};for(const names of [[],['../a.png'],['https://example.com/a.png'],Array(151).fill('a.png')])await assert.rejects(buildBundle(names,load));assert.equal(called,0);});
