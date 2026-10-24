import puppeteerDev from 'puppeteer';
import puppeteerCore, { type Page, type Viewport } from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';
import { captureBrowserArgs } from './capture-proxy';
import { publicUrl } from './public-network';

export async function launchCaptureBrowser(proxyUrl: string, viewport: Viewport) {
    if (process.env.NODE_ENV === 'production') {
        const executablePath = await chromium.executablePath(
            'https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar'
        );
        return puppeteerCore.launch({
            args: captureBrowserArgs(proxyUrl, chromium.args),
            defaultViewport: viewport, executablePath, headless: 'shell', pipe: true,
        });
    }
    return puppeteerDev.launch({
        headless: true, pipe: true, defaultViewport: viewport,
        args: captureBrowserArgs(proxyUrl, [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        ]),
    });
}

export async function prepareCapturePage(page: Page) {
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(15000);
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (request.isInterceptResolutionHandled()) return;
        try {
            const target = request.url();
            if (!['GET','HEAD'].includes(request.method())) throw new Error('Read-only capture');
            if (!target.startsWith('data:') && !target.startsWith('blob:')) publicUrl(target);
            void request.continue().catch(() => {});
        } catch { void request.abort('blockedbyclient').catch(() => {}); }
    });
}
