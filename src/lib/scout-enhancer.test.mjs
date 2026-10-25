import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createEnhancer} from './scout-enhancer.ts';

test('native image pipeline produces decodable mockups, collages and all social sizes',async()=>{
 const saved=new Map();
 const renderer=createEnhancer(async(buffer,id,name)=>{
  assert.equal(id,'synthetic-pack'); assert.ok(Buffer.isBuffer(buffer));
  assert.ok(!saved.has(name),'unique output filenames'); saved.set(name,buffer); return name;
 });
 const input=await sharp({create:{width:400,height:240,channels:3,background:'#2060a0'}}).png().toBuffer();
 const cases=[
  [()=>renderer.enhanceHero(input,'#123456','synthetic-pack','hero'),520,360,260,180],
  [()=>renderer.createLaptopMockup(input,'synthetic-pack','desktop'),480,360,240,150],
  [()=>renderer.createBrowserChromeMockup(input,'synthetic-pack','desktop'),404,284,202,160],
  [()=>renderer.createPhoneMockup(input,'synthetic-pack','mobile'),430,924,215,462],
  [()=>renderer.createTabletMockup(input,'synthetic-pack','tablet'),828,1104,414,552],
  [()=>renderer.createGridCollage([input,input,input],3,'#123456','synthetic-pack','three'),1560,380,280,190],
  [()=>renderer.createGridCollage([input,input,input,input,input,input],6,'#123456','synthetic-pack','six'),1560,700,280,510],
  ...[[1200,675,'twitter'],[1200,627,'linkedin'],[1600,1200,'dribbble'],[1270,760,'producthunt']].map(([w,h,name])=>[()=>renderer.createSocialImage(input,w,h,'synthetic-pack',name),w,h,100,100]),
 ];
 for(const [render,width,height,left,top] of cases){
  const name=await render(),buffer=saved.get(name),meta=await sharp(buffer).metadata();
  assert.equal(meta.format,'png',name);assert.equal(meta.width,width,name);assert.equal(meta.height,height,name);
  const pixel=await sharp(buffer).extract({left,top,width:1,height:1}).removeAlpha().raw().toBuffer();
  assert.deepEqual([...pixel],[32,96,160],name+' preserves screenshot pixels');
 }
 assert.equal(saved.size,11);
});

test('invalid image input fails before storage receives an output',async()=>{
 let writes=0;
 const renderer=createEnhancer(async()=>{writes++;return 'unexpected.png';});
 await assert.rejects(renderer.enhanceHero(Buffer.from('invalid image'),'#123456','synthetic-pack','bad'));
 await assert.rejects(renderer.createSocialImage(Buffer.from('invalid image'),1200,675,'synthetic-pack','bad'));
 assert.equal(writes,0);
});
