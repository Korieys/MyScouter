import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export async function inspectWorkerZip(zip){
 const end=zip.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));assert.ok(end>=0);
 const count=zip.readUInt16LE(end+10);let offset=zip.readUInt32LE(end+16);const entries=[];
 for(let i=0;i<count;i++){
  assert.equal(zip.readUInt32LE(offset),0x02014b50);
  const method=zip.readUInt16LE(offset+10),crc=zip.readUInt32LE(offset+16),compressed=zip.readUInt32LE(offset+20),size=zip.readUInt32LE(offset+24),nameLength=zip.readUInt16LE(offset+28),extra=zip.readUInt16LE(offset+30),comment=zip.readUInt16LE(offset+32),local=zip.readUInt32LE(offset+42);
  const name=zip.subarray(offset+46,offset+46+nameLength).toString();assert.match(name,/\.png$/);
  assert.equal(zip.readUInt32LE(local),0x04034b50);const dataOffset=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28),data=zip.subarray(dataOffset,dataOffset+compressed);
  assert.ok(method===0||method===8);const png=method===8?inflateRawSync(data):data;
  assert.equal(png.length,size);assert.equal(crc32(png),crc);const image=sharp(png),meta=await image.metadata();assert.equal(meta.format,'png');await image.raw().toBuffer();
  entries.push({name,bytes:size,width:meta.width,height:meta.height,sha256:createHash('sha256').update(png).digest('hex')});
  offset+=46+nameLength+extra+comment;
 }
 assert.equal(entries.length,count);assert.equal(new Set(entries.map(e=>e.name)).size,count);
 return {crcVerified:true,allPngsDecoded:true,entries};
}
