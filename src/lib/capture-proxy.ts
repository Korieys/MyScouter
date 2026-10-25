import http from 'node:http';
import net from 'node:net';
import { publicUrl, resolvePublic, type Resolver } from './public-network';

// This proxy is scoped to one browser process. Every connection is resolved and
// checked here, then made to that numeric address rather than resolving it again.
export async function startCaptureProxy(resolve?:Resolver, limits = {bytes:256 * 1024 * 1024, connections:1500, durationMs:240000}) {
    const sockets=new Set<net.Socket>();
    let closed=false;
    let exceeded=false, received=0, connections=0;
    const stop=() => {closed=true; for(const socket of sockets)socket.destroy();};
    const exceed=() => {exceeded=true;stop();};
    const track=(socket:net.Socket) => {sockets.add(socket);socket.on('close',() => sockets.delete(socket));socket.on('error',() => {});return socket;};
    const trackUpstream=(socket:net.Socket) => {
        track(socket);
        socket.on('data',chunk => {received+=chunk.length;if(received>limits.bytes)exceed();});
        return socket;
    };
    const server=http.createServer(async (request,response) => {
        try {
            const url=publicUrl(request.url || '');
            if(url.protocol!=='http:' || !['GET','HEAD'].includes(request.method || '')) throw new Error('Unsupported request');
            const address=await resolvePublic(url,resolve);
            if(closed || request.destroyed) throw new Error('Capture ended');
            const headers:http.OutgoingHttpHeaders={...request.headers, host:url.host};
            for(const name of ['proxy-authorization','proxy-connection','connection','upgrade']) delete headers[name];
            const upstream=http.request(url,{method:request.method,headers,agent:false,
                lookup:(_host,options,callback) => options.all ? callback(null,[address]) : callback(null,address.address,address.family),
            }, result => {
                response.writeHead(result.statusCode || 502,result.headers); result.pipe(response);
                result.on('error',() => response.destroy());
            });
            upstream.on('socket',socket => trackUpstream(socket));
            upstream.setTimeout(20000,() => upstream.destroy(new Error('Upstream timeout')));
            upstream.on('error',() => {if(!response.headersSent)response.writeHead(502);response.end();});
            response.on('close',() => upstream.destroy());
            upstream.end();
        } catch {response.writeHead(403,{'Content-Type':'text/plain'});response.end('This destination is unavailable to the capture worker.');}
    });
    server.on('connection',socket => {
        track(socket);
        if(closed || ++connections>limits.connections){exceed();return;}
        socket.setTimeout(45000,() => socket.destroy());
    });
    server.on('upgrade',(_request,socket) => socket.destroy());
    server.on('connect',async (request,client,head) => {
        try {
            const authority=request.url || '';
            if(!/^[a-zA-Z0-9.[\]:-]+:443$/.test(authority)) throw new Error('Invalid tunnel');
            const url=publicUrl('https://'+authority);
            const address=await resolvePublic(url,resolve);
            if(closed || client.destroyed) throw new Error('Capture ended');
            const remote=trackUpstream(net.connect({host:address.address,port:443,family:address.family}));
            remote.setTimeout(20000,() => remote.destroy());
            remote.once('connect',() => {
                client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if(head.length)remote.write(head);
                remote.pipe(client);client.pipe(remote);
            });
            remote.once('error',() => client.destroy());
            remote.once('close',() => client.destroy());
            client.once('close',() => remote.destroy());
        } catch {if(!client.destroyed)client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
    });
    await new Promise<void>((accept,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
    const address=server.address() as net.AddressInfo;
    const timer=setTimeout(exceed,limits.durationMs);timer.unref();
    let closing:Promise<void> | undefined;
    return {url:`http://127.0.0.1:${address.port}`,
        assertWithinBudget:() => {if(exceeded)throw new Error('Capture network limit reached');},
        close:() => {
            clearTimeout(timer);stop();
            return closing ??= new Promise<void>(resolve => server.close(() => resolve()));
        },
    };
}

export function captureBrowserArgs(proxyUrl:string, base:string[] = []) {
    const retained=base.filter(arg => !/^--(proxy-|no-proxy|disable-web-security|ignore-certificate-errors|allow-file-access|allow-running-insecure-content|host-resolver-rules)/.test(arg));
    return [...retained,`--proxy-server=${proxyUrl}`,'--proxy-bypass-list=<-loopback>',
        '--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        '--disable-background-networking','--disable-extensions','--disable-sync',
    ];
}
