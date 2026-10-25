import type {Page} from 'puppeteer-core';
import {ScoutError} from './scout-access';
import {publicUrl} from './public-network';

export type CaptureLogin = {mode:'basic'|'advanced'; url:string; username:string; password:string};
export type LoginField = {id:number; form:number; kind:'username'|'password'|'submit'; label:string};
export type LoginPlan = {username?:number; password?:number; submit:number};
export type LoginControls = {allowPost(url:string):void; finishLogin():void};
const unsupported = () => new ScoutError(422, 'Sign-in could not be verified. Use a same-site form with a username and password. Single sign-on, verification codes, CAPTCHA and script-only forms are not supported. No guest capture was saved.');

export function captureLogin(value:unknown, target:URL): CaptureLogin | undefined {
    if (value === undefined || value === null) return;
    if (typeof value !== 'object' || Array.isArray(value)) throw new ScoutError(400, 'Invalid sign-in settings.');
    const input = value as Record<string,unknown>;
    if (!['basic','advanced'].includes(String(input.mode)) || typeof input.url !== 'string' || input.url.length > 2048 ||
        typeof input.username !== 'string' || !input.username.trim() || input.username.length > 256 ||
        typeof input.password !== 'string' || !input.password || input.password.length > 1024 || input.consent !== true ||
        (input.mode === 'advanced' && input.aiConsent !== true)) throw new ScoutError(400, 'Complete the sign-in fields and consent before scouting.');
    const loginURL = publicUrl(input.url);
    if (target.protocol !== 'https:' || loginURL.origin !== target.origin || loginURL.search || new URL(input.url).hash || target.search || target.hash) {
        throw new ScoutError(400, 'Sign-in and capture must use the same HTTPS website, without query strings or fragments.');
    }
    return {mode:input.mode as CaptureLogin['mode'],url:loginURL.href,username:input.username,password:input.password};
}

export function redactLoginText(text:string, login:CaptureLogin): string {
    return [login.username,login.password].sort((a,b)=>b.length-a.length).reduce((safe,secret)=>safe.split(secret).join('[redacted]'),text);
}

export function validateLoginPlan(value:unknown, fields:LoginField[]): LoginPlan {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw unsupported();
    const plan = value as LoginPlan;
    if (Object.keys(plan).some(key=>!['username','password','submit'].includes(key)) ||
        (!Number.isInteger(plan.username) && !Number.isInteger(plan.password))) throw unsupported();
    const submit = fields.find(field=>field.id===plan.submit && field.kind==='submit');
    if (!submit) throw unsupported();
    for (const kind of ['username','password'] as const) {
        if (plan[kind] !== undefined && !fields.some(field=>field.id===plan[kind] && field.kind===kind && field.form===submit.form)) throw unsupported();
    }
    return plan;
}

export async function chooseLoginFields(fields:LoginField[]):Promise<LoginPlan> {
 return (await import('./capture-login-planner')).chooseLoginFields(fields);
}

// Only bounded field metadata leaves the browser. Input values, page HTML and
// credentials never enter the planner. Native forms remain the only write path.
export async function inspectLoginFields(page:Page, login:CaptureLogin):Promise<LoginField[]> {
    const fields = await page.evaluate((origin:string) => {
        document.querySelectorAll('[data-scout-login-field]').forEach(element=>element.removeAttribute('data-scout-login-field'));
        const result:{id:number;form:number;kind:'username'|'password'|'submit';label:string}[]=[];
        Array.from(document.forms).slice(0,12).forEach((form,formId)=>{
            const action = new URL(form.action,location.href);
            if (form.method.toLowerCase() !== 'post' || action.origin !== origin || action.search || action.hash || (form.target && form.target !== '_self')) return;
            for (const element of Array.from(form.elements).slice(0,40)) {
                if (!(element instanceof HTMLInputElement || element instanceof HTMLButtonElement) || element.disabled ||
                    !(element.offsetWidth || element.offsetHeight) || getComputedStyle(element).visibility==='hidden') continue;
                let kind:'username'|'password'|'submit';
                if (element instanceof HTMLInputElement && !element.readOnly && element.type==='password') kind='password';
                else if (element instanceof HTMLInputElement && !element.readOnly && ['email','text'].includes(element.type) &&
                    (element.autocomplete==='username' || element.type==='email' || /user|email|login/i.test([element.name,element.id,element.placeholder,element.labels?.[0]?.textContent].join(' ')))) kind='username';
                else if (element.type==='submit' && /^(sign\s*in|log\s*in|login|continue|next|submit)$/i.test((element instanceof HTMLInputElement ? element.value : element.textContent || '').trim()) &&
                    !element.hasAttribute('formaction') && !element.hasAttribute('formmethod') && !element.hasAttribute('formtarget')) kind='submit';
                else continue;
                const id=result.length;
                element.setAttribute('data-scout-login-field',String(id));
                const label=element.getAttribute('aria-label') || (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent || element.placeholder || element.name : element.textContent) || kind;
                result.push({id,form:formId,kind,label:label.slice(0,120)});
            }
        });
        return result.slice(0,36);
    },new URL(login.url).origin);
    return fields.map(field=>({...field,label:redactLoginText(field.label,login)}));
}

export async function assertCapturedLoginPage(page:Page, target:URL) {
    const current = new URL(page.url());
    const blocked = await page.evaluate(() => Array.from(document.querySelectorAll('input[type=password],input[autocomplete=one-time-code],iframe[src*="captcha"],[class*="captcha"]'))
        .some(element=>!!((element as HTMLElement).offsetWidth || (element as HTMLElement).offsetHeight)));
    if (current.origin !== target.origin || current.pathname !== target.pathname || current.search || blocked) throw unsupported();
}

export async function signInForCapture(page:Page, login:CaptureLogin, target:URL, controls:LoginControls,
    planner:(fields:LoginField[])=>Promise<LoginPlan> = chooseLoginFields) {
    try {
        const start = await page.goto(login.url,{waitUntil:'domcontentloaded'});
        if (!start?.ok() || new URL(page.url()).origin !== target.origin) throw unsupported();
        const before = JSON.stringify(await page.browserContext().cookies());
        let passwordSent = false;
        for (let step=0;step<2 && !passwordSent;step++) {
            const fields=await inspectLoginFields(page,login);
            let plan:LoginPlan;
            if (login.mode==='advanced') plan=validateLoginPlan(await planner(fields),fields);
            else {
                const field=fields.find(item=>item.kind==='password') || fields.find(item=>item.kind==='username');
                const candidates=fields.filter(item=>item.form===field?.form);
                const submit=candidates.find(item=>item.kind==='submit');
                plan=validateLoginPlan({username:candidates.find(item=>item.kind==='username')?.id,password:candidates.find(item=>item.kind==='password')?.id,submit:submit?.id},fields);
            }
            // Recheck the actual form after planning and typing; never execute AI actions.
            const action = await page.evaluate((selected:LoginPlan) => {
                const submit=document.querySelector(`[data-scout-login-field="${selected.submit}"]`) as HTMLButtonElement | HTMLInputElement | null;
                if (!submit?.form || submit.type!=='submit' || submit.disabled || submit.hasAttribute('formaction') || submit.hasAttribute('formmethod') || submit.hasAttribute('formtarget')) return null;
                const form=submit.form;
                if (form.method.toLowerCase()!=='post' || (form.target && form.target!=='_self')) return null;
                for (const kind of ['username','password'] as const) {
                    if (selected[kind]===undefined) continue;
                    const input=document.querySelector(`[data-scout-login-field="${selected[kind]}"]`) as HTMLInputElement | null;
                    if (!input || input.form!==form || input.disabled || input.readOnly || (kind==='password' ? input.type!=='password' : !['email','text'].includes(input.type))) return null;
                }
                return form.action;
            },plan);
            if (!action || new URL(action).origin!==target.origin || new URL(action).search || new URL(action).hash) throw unsupported();
            for (const kind of ['username','password'] as const) {
                if (plan[kind]===undefined) continue;
                const selector=`[data-scout-login-field="${plan[kind]}"]`;
                await page.$eval(selector,element=>{(element as HTMLInputElement).value='';});
                await page.type(selector,login[kind]);
            }
            controls.allowPost(action);
            // Interception permits exactly one main-frame POST to the checked
            // action. JS fetches, popups and alternate destinations stay blocked.
            const [response]=await Promise.all([
                page.waitForNavigation({waitUntil:'domcontentloaded',timeout:15000}),
                page.click(`[data-scout-login-field="${plan.submit}"]`),
            ]);
            if (!response?.ok() || new URL(page.url()).origin!==target.origin) throw unsupported();
            passwordSent=plan.password!==undefined;
        }
        controls.finishLogin();
        if (!passwordSent || before===JSON.stringify(await page.browserContext().cookies())) throw unsupported();
        const response=await page.goto(target.href,{waitUntil:'networkidle2'});
        if (!response?.ok()) throw unsupported();
        await assertCapturedLoginPage(page,target);
        await page.evaluate(({username,password})=>{
            const secrets=[username,password].sort((a,b)=>b.length-a.length);
            const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
            let node;
            while((node=walker.nextNode()))node.textContent=secrets.reduce((text,secret)=>text.split(secret).join('[redacted]'),node.textContent || '');
            document.querySelectorAll('input,textarea').forEach(element=>{
                const input=element as HTMLInputElement;
                if(input.type==='password' || secrets.some(secret=>input.value.includes(secret))){input.value='';input.removeAttribute('value');}
            });
        },{username:login.username,password:login.password});
    } catch (error) {
        // Provider/DOM errors can include page content or request values.
        if (error instanceof ScoutError && error.status===503) throw error;
        throw unsupported();
    } finally {controls.finishLogin();}
}
