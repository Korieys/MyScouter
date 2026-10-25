import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { ScoutError } from './scout-access';
const blocked = new BlockList();
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]] as const) blocked.addSubnet(ip,prefix,'ipv4');
const publicV6 = new BlockList(); publicV6.addSubnet('2000::',3,'ipv6');
for (const [ip,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) blocked.addSubnet(ip,prefix,'ipv6');
export function isPublicAddress(address:string) {
    const family=isIP(address);
    return family===4 ? !blocked.check(address,'ipv4') : family===6 && publicV6.check(address,'ipv6') && !blocked.check(address,'ipv6');
}
export function publicUrl(value:string) {
    let url:URL;
    try {url=new URL(value);} catch {throw new ScoutError(400,'Enter a valid public website address.');}
    const host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
    if(value.length>2048 || !['http:','https:'].includes(url.protocol) || url.username || url.password || url.port ||
        (!host.includes('.') && !isIP(host)) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || (isIP(host) && !isPublicAddress(host))) {
        throw new ScoutError(400,'Use a public HTTP or HTTPS website on its standard port.');
    }
    url.hash=''; return url;
}
export type Resolver = (host:string) => Promise<{address:string;family:number}[]>;
export async function resolvePublic(url:URL, resolve:Resolver = host => lookup(host,{all:true,verbatim:true})) {
    const host=url.hostname.replace(/^\[|\]$/g,'');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const addresses=await Promise.race([
            isIP(host) ? Promise.resolve([{address:host,family:isIP(host)}]) : resolve(host),
            new Promise<never>((_,reject) => {timeout=setTimeout(() => reject(new Error('DNS timeout')),5000);}),
        ]);
        if(!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new ScoutError(400,'That website resolves to a restricted network address.');
        return addresses[0];
    } finally {if(timeout)clearTimeout(timeout);}
}
