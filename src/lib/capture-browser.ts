import puppeteerDev from 'puppeteer';
import puppeteerCore, { type Page, type Viewport } from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';
import { captureBrowserArgs } from './capture-proxy';
import { publicUrl } from './public-network';
import type {CaptureLogin, LoginControls} from './capture-login';

export async function launchCaptureBrowser(proxyUrl: string, viewport: Viewport) {
    if (process.env.NODE_ENV === 'production') {
        const executablePath = await chromium.executablePath(
            'https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar'
        );
        return puppeteerCore.launch({
            args: captureBrowserArgs(proxyUrl, chromium.args),
            defaultViewport: viewport, executablePath, headless: 'shell', pipe: true, browser: 'chrome', protocol: 'cdp',
        });
    }
    return puppeteerDev.launch({
        headless: true, pipe: true, defaultViewport: viewport, browser: 'chrome', protocol: 'cdp',
        args: captureBrowserArgs(proxyUrl, [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        ]),
    });
}

export async function prepareCapturePage(page: Page, login?:CaptureLogin):Promise<LoginControls> {
    let allowedPost:string|undefined;
    let loginFinished=false;
    // Native-form mode prevents site scripts from reading the supplied password,
    // opening unguarded windows, or moving it into a different request.
    if (login) await page.setJavaScriptEnabled(false);
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(15000);
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (request.isInterceptResolutionHandled()) return;
        try {
            const target = request.url();
            if (login) {
                const destination=new URL(target);
                if (destination.origin!==new URL(login.url).origin) throw new Error('Sign-in origin boundary');
                const decoded=decodeURIComponent(destination.href);
                if ([login.username,login.password].some(secret=>decoded.includes(secret))) throw new Error('Credentials cannot enter URLs');
            }
            if (!['GET','HEAD'].includes(request.method())) {
                if (!login || loginFinished || request.method()!=='POST' || target!==allowedPost || !request.isNavigationRequest() || request.frame()!==page.mainFrame()) throw new Error('Read-only capture');
                allowedPost=undefined;
            }
            if (!target.startsWith('data:') && !target.startsWith('blob:')) publicUrl(target);
            void request.continue({}, 0).catch(() => {});
        } catch { void request.abort('blockedbyclient', 0).catch(() => {}); }
    });
    return {
        allowPost(url:string) {
            if (!login || loginFinished || publicUrl(url).origin!==new URL(login.url).origin) throw new Error('Invalid login action');
            allowedPost=url;
        },
        finishLogin() {loginFinished=true;allowedPost=undefined;},
    };
}
