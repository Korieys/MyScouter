import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {privateBinary} from './private-binary.ts';

test('large private downloads stream exact bytes with bounded chunks and no caching',async()=>{
 const source=randomBytes(6*1024*1024+19);
 const response=privateBinary(source,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="test.zip"'});
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(response.headers.get('content-length'),null);
 assert.equal(response.headers.get('x-download-bytes'),String(source.length));
 assert.equal(response.headers.get('x-download-sha256'),createHash('sha256').update(source).digest('hex'));
 assert.equal(response.headers.get('content-disposition'),'attachment; filename="test.zip"');
 const actual=createHash('sha256');let size=0,count=0;
 for await(const chunk of response.body){assert.ok(chunk.length<=65536);actual.update(chunk);size+=chunk.length;count++;}
 assert.equal(size,source.length);assert.ok(count>90);
 assert.equal(actual.digest('hex'),createHash('sha256').update(source).digest('hex'));
});
