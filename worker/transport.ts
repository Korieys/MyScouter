import {WORKER_LIMITS,workerId} from '../src/lib/capture-worker-contract';
import {ScoutError} from '../src/lib/scout-access';
export function assertWorkerEnvironment(env:NodeJS.ProcessEnv=process.env) {
 const forbidden=Object.keys(env).some(k=>/^(FIREBASE_|NEXT_PUBLIC_FIREBASE_|OPENAI_|VERCEL_|AWS_|AZURE_|CAPTURE_WORKER_(ENVELOPE|DISPATCHER|WIF)|GOOGLE_APPLICATION_CREDENTIALS$|GCP_ACCESS_TOKEN$)/.test(k)&&!!env[k]);
 if(forbidden)throw Error('The worker environment contains an API credential.');
}
export function workerTransport(env:NodeJS.ProcessEnv=process.env,send:typeof fetch=fetch) {
 assertWorkerEnvironment(env);
 const id=workerId(env.CAPTURE_WORKER_JOB_ID),capability=env.CAPTURE_WORKER_CAPABILITY||'',url=new URL(env.CAPTURE_WORKER_BROKER_URL||'');
 const local=env.NODE_ENV==='test'&&env.CAPTURE_WORKER_LOCAL==='true'&&url.protocol==='http:'&&['127.0.0.1','localhost','host.docker.internal'].includes(url.hostname);
 if(!/^[A-Za-z0-9_-]{43}$/.test(capability)||(!local&&(url.protocol!=='https:'||url.port))||url.pathname!=='/api/capture-worker'||url.search||url.hash||url.username||url.password)throw Error('Invalid worker endpoint.');
 const deadline=Date.now()+WORKER_LIMITS.durationMs,abort=new AbortController();const timer=setTimeout(()=>abort.abort(),WORKER_LIMITS.durationMs);timer.unref();
 let identity:string|undefined;
 async function token() {
  if(local)return 'fictional-local-worker';
  if(!identity){
   const r=await send('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?format=full&audience='+encodeURIComponent(url.href),{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(5000),redirect:'error'});
   if(!r.ok)throw Error('Worker identity unavailable');identity=await r.text();if(identity.length>8192)throw Error('Invalid worker identity');
  }return identity;
 }
 return {signal:abort.signal,close:()=>{clearTimeout(timer);abort.abort();},
  async call(action:string,body?:unknown,asset?:{name:string;buffer:Buffer;width:number;height:number;sha256:string}) {
   abort.signal.throwIfAborted();if(Date.now()>=deadline)throw Error('Worker expired');
   const suffix=asset?'?name='+encodeURIComponent(asset.name):'';
   const headers:Record<string,string>={Authorization:'Bearer '+await token(),'x-capture-capability':capability,'Content-Type':asset?'image/png':'application/json'};
   if(asset)Object.assign(headers,{'Content-Length':String(asset.buffer.length),'x-capture-width':String(asset.width),'x-capture-height':String(asset.height),'x-capture-sha256':asset.sha256});
   const response=await send(url.href+'/'+id+'/'+action+suffix,{method:'POST',redirect:'error',headers,body:asset?new Uint8Array(asset.buffer):JSON.stringify(body||{}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(asset?25000:20000)])});
   if(!response.ok){const status=response.status;await response.body?.cancel();throw new ScoutError(status===413?422:503,action==='plan'?'AI-assisted sign-in is unavailable. Try Basic sign-in.':status===413?'This screenshot exceeds the isolated worker limit of 3 MiB. Try a shorter page.':'The isolated capture callback failed.');}
   const text=await response.text();if(text.length>150000)throw Error('Worker response too large');return JSON.parse(text);
  },
 };
}
