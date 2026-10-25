import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {isPublicAddress,publicUrl,resolvePublic} from './public-network.ts';
import {startCaptureProxy,captureBrowserArgs} from './capture-proxy.ts';
test('blocks private, metadata, reserved and IPv6 transition destinations',()=>{
 for(const ip of ['0.0.0.0','10.0.0.1','100.64.0.1','127.1.2.3','169.254.169.254','172.31.1.2','192.168.2.3','198.18.0.1','192.0.2.1','224.0.0.1','::1','::ffff:127.0.0.1','64:ff9b::7f00:1','fe80::1','fc00::1','2001:db8::1','2002:7f00:1::','3fff::1'])assert.equal(isPublicAddress(ip),false,ip);
 for(const ip of ['93.184.216.34','1.1.1.1','2606:4700:4700::1111'])assert.equal(isPublicAddress(ip),true,ip);
 for(const value of ['http://2130706433','http://0x7f000001','http://localhost.','http://host.internal','https://user:pass@example.com','https://example.com:8443','file:///etc/passwd','http://[::ffff:127.0.0.1]'])assert.throws(()=>publicUrl(value),value);
});
test('validates every DNS answer, every new resolution and normalized URLs',async()=>{
 const url=publicUrl('https://example.com/#test');assert.equal(url.href,'https://example.com/');
 const good={address:'93.184.216.34',family:4};
 assert.deepEqual(await resolvePublic(url,async()=>[good]),good);
 for(const result of [[],[good,{address:'127.0.0.1',family:4}],[{address:'::ffff:169.254.169.254',family:6}]])await assert.rejects(resolvePublic(url,async()=>result));
 let round=0; const rebind=async()=>++round===1?[good]:[{address:'10.0.0.1',family:4}];
 await resolvePublic(url,rebind);await assert.rejects(resolvePublic(url,rebind));
});
test('actual proxy refuses unsafe HTTP subresources and CONNECT destinations',async()=>{
 const proxy=await startCaptureProxy(async()=>[{address:'127.0.0.1',family:4}]);
 const p=new URL(proxy.url);
 try {
  for(const path of ['http://127.0.0.1/private','http://example.com/redirect-target','http://169.254.169.254/latest/meta-data/']) {
   const status=await new Promise((resolve,reject)=>{const req=http.get({host:p.hostname,port:p.port,path,agent:false},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
   assert.equal(status,403,path);
  }
  for(const destination of ['127.0.0.1:443','example.com:443','example.com:80','user@example.com:443']) {
   const data=await new Promise((resolve,reject)=>{const socket=net.connect({host:p.hostname,port:Number(p.port)},()=>socket.write(`CONNECT ${destination} HTTP/1.1\r\nHost: ${destination}\r\n\r\n`));socket.once('data',chunk=>{resolve(chunk.toString());socket.destroy();});socket.on('error',reject);});
   assert.match(data,/403 Forbidden/);
  }
 } finally {await proxy.close();}
});
test('browser routes loopback through the checked proxy with no direct fallback',()=>{
 const args=captureBrowserArgs('http://127.0.0.1:9000',['--no-sandbox','--disable-web-security','--ignore-certificate-errors','--proxy-server=direct://','--allow-file-access-from-files']);
 assert.equal(args.includes('--disable-web-security'),false);assert.equal(args.includes('--ignore-certificate-errors'),false);
 assert.equal(args.filter(arg=>arg.startsWith('--proxy-server')).length,1);
 assert.ok(args.includes('--proxy-bypass-list=<-loopback>'));assert.ok(args.includes('--disable-quic'));
 assert.ok(args.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'));
});

test('proxy closes connections at its budget and can be closed twice safely',async()=>{
 const proxy=await startCaptureProxy(undefined,{bytes:1,connections:0,durationMs:10000});
 const p=new URL(proxy.url);
 try {
  await new Promise(resolve=>{const socket=net.connect({host:p.hostname,port:Number(p.port)});socket.on('error',()=>{});socket.on('close',resolve);});
  assert.throws(()=>proxy.assertWithinBudget(),/limit/);
 }finally{await proxy.close();await proxy.close();}
});
