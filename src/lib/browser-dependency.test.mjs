import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

test('browser dependency rejects oversized collections before validating their elements',async()=>{
 for(const parent of ['puppeteer','puppeteer-core']) {
  const fromParent=createRequire(import.meta.resolve(parent));
  const entry=fromParent.resolve('chromium-bidi'),fromBidi=createRequire(entry);
  const {z}=fromBidi('zod');
  const {parseObject}=await import(new URL('./protocol-parser/protocol-parser.js',pathToFileURL(entry)));
  let visits=0;
  const element=z.preprocess(value=>{visits++;return value;},z.string());
  const schema=z.object({values:z.array(element).max(1)});
  assert.deepEqual(parseObject({values:['allowed']},schema).values,['allowed']);
  assert.throws(()=>parseObject({values:[0]},schema),error=>error.constructor.name==='InvalidArgumentException'&&error.message.includes('values'));
  visits=0;
  assert.deepEqual(schema.safeParse({values:[0,0,0]}).error.issues.map(issue=>issue.code),['too_big']);
  assert.equal(visits,0,parent);
  for(const [schema,input] of [[z.set(z.string()).max(1),new Set([0,1])],[z.map(z.string(),z.string()).max(1),new Map([[0,0],[1,1]])]]) {
   assert.deepEqual(schema.safeParse(input).error.issues.map(issue=>issue.code),['too_big']);
  }
 }
 const bridge=await import('puppeteer-core/internal/bidi/bidi.js');
 assert.equal(typeof bridge.connectBidiOverCdp,'function');
});
