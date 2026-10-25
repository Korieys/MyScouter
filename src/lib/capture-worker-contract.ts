import {ScoutError, assetName, validScoutId, type CapturedPage} from './scout-access';
import {captureLogin, type CaptureLogin} from './capture-login';
import {publicUrl} from './public-network';
export const WORKER_LIMITS={durationMs:240000,expiresMs:250000,assetBytes:3*1024*1024,totalBytes:96*1024*1024,assets:90,calls:400,uploadMs:10000} as const;
export const VIEWPORTS={desktop:{width:1440,height:900},tablet:{width:768,height:1024},mobile:{width:390,height:844}};
export type CaptureInput={id:string;url:string;brandColor:string;devices:string[];autoDetectColor:boolean;login?:CaptureLogin};
export type CaptureResult={pages:CapturedPage[];textContent:string;brandColor:string};
export const WORKER_PROGRESS:Record<string,{detail:string;min:number;max:number}>={
 init:{detail:'Preparing scout...',min:5,max:5},browser:{detail:'Launching isolated scout browser...',min:10,max:10},
 navigate:{detail:'Navigating to the selected website...',min:15,max:15},login:{detail:'Signing in to the selected website...',min:17,max:17},
 cookies:{detail:'Dismissing cookie banners...',min:20,max:20},text:{detail:'Reading site content...',min:25,max:25},
 color:{detail:'Detecting brand color...',min:28,max:28},links:{detail:'Discovering pages...',min:30,max:30},
 capture:{detail:'Capturing website pages...',min:35,max:65},saving:{detail:'Saving scout results...',min:68,max:68},
};
export function workerId(value:unknown):string {
 if(typeof value!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))throw new ScoutError(404,'Worker job unavailable.');
 return value;
}
export function parseCaptureInput(body:Record<string,unknown>,id:string):CaptureInput {
 const {url,brandColor='#2D4A22',devices=['desktop'],autoDetectColor=false}=body;
 if(typeof url!=='string'||typeof brandColor!=='string'||!/^#[a-f0-9]{6}$/i.test(brandColor)||
 !Array.isArray(devices)||!devices.length||devices.length>3||new Set(devices).size!==devices.length||
 devices.some(d=>!Object.hasOwn(VIEWPORTS,d))||typeof autoDetectColor!=='boolean')throw new ScoutError(400,'Choose a valid website, color and at least one device.');
 const target=publicUrl(url),login=captureLogin(body.login,new URL(url));
 return {id:validScoutId(id),url:target.href,brandColor,devices,autoDetectColor,...(login?{login}:{})};
}
export function parseWorkerInput(value:unknown):CaptureInput {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ScoutError(400,'Invalid worker input.');
 const v=value as CaptureInput;
 if(Object.keys(v).some(k=>!['id','url','brandColor','devices','autoDetectColor','login'].includes(k)))throw new ScoutError(400,'Invalid worker input.');
 return parseCaptureInput({...v,...(v.login?{login:{...v.login,consent:true,aiConsent:true}}:{})},v.id);
}
export function workerAssetName(job:string, raw:string, devices:string[]) {
 workerId(job);assetName(raw);
 const m=/^(home|page-[1-5])-(desktop|tablet|mobile)-(hero|full|feature-[1-3])\.png$/.exec(raw);
 if(!m||!devices.includes(m[2]))throw new ScoutError(400,'Invalid worker asset.');
 return assetName('w-'+job+'-'+raw);
}
export function validateCaptureResult(value:unknown,input:CaptureInput,job:string,uploaded:Record<string,{stored:boolean;width:number;height:number}>):CaptureResult {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ScoutError(422,'Invalid capture result.');
 const v=value as CaptureResult;
 if(Object.keys(v).some(k=>!['pages','textContent','brandColor'].includes(k))||!Array.isArray(v.pages)||v.pages.length<1||v.pages.length>6||
 typeof v.textContent!=='string'||v.textContent.length>50000||typeof v.brandColor!=='string'||!/^#[a-f0-9]{6}$/i.test(v.brandColor))throw new ScoutError(422,'Invalid capture result.');
 const seen=new Set<string>(),origin=new URL(input.url).origin;
 const prefixes=new Set<string>();
 const pages=v.pages.map((p,i)=>{
  if(!p||Object.keys(p).some(k=>!['url','title','screenshots'].includes(k))||typeof p.url!=='string'||publicUrl(p.url).origin!==origin||
  (i===0&&publicUrl(p.url).href!==input.url)||(input.login&&(v.pages.length!==1||p.url!==input.url))||
  typeof p.title!=='string'||p.title.length>512||!Array.isArray(p.screenshots)||!p.screenshots.length||p.screenshots.length>15)throw new ScoutError(422,'Invalid captured page.');
  let prefix:string|undefined;
  const screenshots=p.screenshots.map(s=>{
   if(!s||Object.keys(s).some(k=>!['path','viewport','type','width','height'].includes(k))||typeof s.path!=='string'||!s.path.startsWith('w-'+workerId(job)+'-'))throw new ScoutError(422,'Invalid screenshot.');
   const raw=s.path.slice(39); // "w-" + UUID + "-"
   if(workerAssetName(job,raw,input.devices)!==s.path||seen.has(s.path))throw new ScoutError(422,'Invalid screenshot.');
   const m=/^(home|page-[1-5])-(desktop|tablet|mobile)-(hero|full|feature-[1-3])\.png$/.exec(raw)!;
   const vp=VIEWPORTS[m[2] as keyof typeof VIEWPORTS],actual=uploaded[s.path];
   if((i===0?m[1]!=='home':m[1]==='home')||(prefix!==undefined&&prefix!==m[1])||s.viewport!==m[2]||s.type!==(m[3].startsWith('feature')?'feature':m[3])||
   !actual?.stored||s.width!==vp.width||s.height!==actual.height||s.width!==actual.width||
   !Number.isSafeInteger(s.height)||s.height<1||s.height>12000||(s.type!=='full'&&s.height!==vp.height))throw new ScoutError(422,'Invalid screenshot dimensions.');
   prefix=m[1];seen.add(s.path);return {path:s.path,viewport:s.viewport,width:s.width,height:s.height,type:s.type};
  });
  if(!prefix||prefixes.has(prefix))throw new ScoutError(422,'Invalid page asset scope.');prefixes.add(prefix);
  for(const device of input.devices)for(const kind of ['hero','full'])if(!screenshots.some(s=>s.viewport===device&&s.type===kind))throw new ScoutError(422,'Capture is missing required screenshots.');
  return {url:p.url,title:p.title,screenshots};
 });
 return {pages,textContent:v.textContent,brandColor:v.brandColor};
}
