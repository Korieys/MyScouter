import {setTimeout as settle} from 'node:timers/promises';
import type {Browser,Page} from 'puppeteer-core';
import sharp from 'sharp';
import {ScoutError,type Screenshot,type CapturedPage as PageCapture} from './scout-access';
import {publicUrl} from './public-network';
import {startCaptureProxy} from './capture-proxy';
import {launchCaptureBrowser,prepareCapturePage} from './capture-browser';
import {redactLoginText,signInForCapture,type LoginField,type LoginPlan} from './capture-login';
import {VIEWPORTS,type CaptureInput,type CaptureResult} from './capture-worker-contract';
export type CaptureIO={save:(buffer:Buffer,id:string,name:string)=>Promise<string>;progress:(step:string,detail:string,progress:number)=>Promise<void>;planner?:(fields:LoginField[])=>Promise<LoginPlan>;signal?:AbortSignal;launch?:typeof launchCaptureBrowser};
const COOKIE_SELECTORS = [
    '[class*="cookie"] button',
    '[class*="consent"] button',
    '[id*="cookie"] button',
    '[id*="consent"] button',
    '[class*="Cookie"] button',
    '[class*="gdpr"] button',
    'button[aria-label*="accept"]',
    'button[aria-label*="Accept"]',
    'button[aria-label*="agree"]',
    'button[aria-label*="cookie"]',
    '[class*="banner"] button[class*="accept"]',
    '[class*="banner"] button[class*="close"]',
    '[class*="modal"] button[class*="accept"]',
    '#onetrust-accept-btn-handler',
    '.cc-accept',
    '.cc-dismiss',
    '[data-testid="cookie-accept"]',
    'button:has-text("Accept")',
    'button:has-text("Got it")',
    'button:has-text("I agree")',
    'button:has-text("OK")',
];
export async function captureWebsite(input:CaptureInput,io:CaptureIO):Promise<CaptureResult>{
 const {id:scoutId,url,brandColor,devices,autoDetectColor,login}=input,parsedUrl=publicUrl(url);
 let browser:Browser|null=null,proxy:Awaited<ReturnType<typeof startCaptureProxy>>|null=null,expired=false;
 const stop=()=>{expired=true;void browser?.close().catch(()=>{});void proxy?.close();};
 const timer=setTimeout(stop,240000);timer.unref();io.signal?.addEventListener('abort',stop,{once:true});
 const checkDeadline=()=>{io.signal?.throwIfAborted();if(expired)throw new ScoutError(422,'This website took too long to capture. Try a smaller page.');proxy?.assertWithinBudget();};
 const emitProgress=async(_id:string,step:string,detail:string,progress:number)=>{checkDeadline();await io.progress(step,detail,progress);};
 const save:CaptureIO['save']=async(buffer,id,name)=>{checkDeadline();return io.save(buffer,id,name);};
 try{
        await emitProgress(scoutId, "browser", "Launching scout browser...", 10);

        // Launch browser
        proxy = await startCaptureProxy();
        browser = await (io.launch||launchCaptureBrowser)(proxy.url, VIEWPORTS.desktop);

        checkDeadline();
        const page = await browser.newPage() as unknown as Page;
        const loginControls = await prepareCapturePage(page, login);

        await emitProgress(scoutId, "navigate", `Navigating to ${parsedUrl.hostname}...`, 15);

        // Navigate to the target URL
        if (login) {
            await emitProgress(scoutId, 'login', 'Signing in to the selected website...', 17);
            await signInForCapture(page, login, parsedUrl, loginControls, io.planner);
        } else {
            const navigation = await page.goto(parsedUrl.href, { waitUntil: "networkidle2" });
            if (!navigation?.ok()) throw new ScoutError(422, 'This website could not be read. Try another public page.');
        }

        // Dismiss cookie banners
        await emitProgress(scoutId, "cookies", "Dismissing cookie banners...", 20);
        if (!login) await dismissCookieBanners(page);

        // Wait for page to settle after cookie dismissal and styles/fonts to load
        await Promise.race([page.evaluateHandle('document.fonts.ready'),settle(5000)]);
        await settle(2000);

        // Extract text content for copy generation
        await emitProgress(scoutId, "text", "Reading site content...", 25);
        let textContent = await page.evaluate(() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            const texts: string[] = [];
            let node;
            while ((node = walker.nextNode())) {
                const text = node.textContent?.trim();
                if (text && text.length > 3 && text.length < 500) {
                    texts.push(text);
                }
            }
            return texts.slice(0, 100).join("\n");
        });

        let pageTitle = await page.title();
        if (login) {
            textContent = redactLoginText(textContent, login);
            pageTitle = redactLoginText(pageTitle, login);
        }

        // Auto-detect brand color from screenshot
        let detectedColor = brandColor;
        if (autoDetectColor) {
            await emitProgress(scoutId, "color", "Detecting brand color...", 28);
            detectedColor = await detectBrandColor(page, brandColor);
        }

        // Discover navigation links (1 level deep)
        await emitProgress(scoutId, "links", "Discovering pages...", 30);
        // A signed-in scout captures only the requested page: guessing account
        // links can trigger actions even when their HTTP method is GET.
        const navLinks = login ? [] : await page.evaluate((baseUrl: string) => {
            const links: string[] = [];
            const anchors = document.querySelectorAll("nav a, header a, aside a, [role='navigation'] a, [role='menu'] a");
            const seen = new Set<string>();

            anchors.forEach((a) => {
                const href = (a as HTMLAnchorElement).href;
                if (!href) return;
                try {
                    const parsed = new URL(href);
                    const base = new URL(baseUrl);
                    if (
                        parsed.origin === base.origin &&
                        parsed.pathname !== base.pathname &&
                        !parsed.hash &&
                        !seen.has(parsed.pathname)
                    ) {
                        seen.add(parsed.pathname);
                        links.push(parsed.href);
                    }
                } catch {
                    // skip invalid URLs
                }
            });

            return links.slice(0, 6);
        }, url);

        // Capture homepage screenshots
        await emitProgress(scoutId, "capture", "Capturing homepage...", 35);
        const allPages: PageCapture[] = [];
        const homepageCapture = await capturePageScreenshots(page, url, pageTitle, devices, scoutId, "home", save);
        allPages.push(homepageCapture);

        // Scout interior pages
        const totalPages = Math.min(navLinks.length, 5);
        for (let i = 0; i < totalPages; i++) {
            checkDeadline();
            const pct = 40 + Math.round((i / totalPages) * 25);
            await emitProgress(scoutId, "capture", `Scouting page ${i + 2} of ${totalPages + 1}...`, pct);
            try {
                const response = await page.goto(publicUrl(navLinks[i]).href, { waitUntil: "networkidle2" });
                if (!response?.ok()) continue;
                await dismissCookieBanners(page);
                await Promise.race([page.evaluateHandle('document.fonts.ready'),settle(5000)]);
                await settle(2000);
                const interiorTitle = await page.title();
                const interiorCapture = await capturePageScreenshots(
                    page, navLinks[i], interiorTitle, devices, scoutId, `page-${i + 1}`, save
                );
                allPages.push(interiorCapture);
            } catch {
                // One unavailable interior page does not discard a valid homepage.
            }
        }

        checkDeadline();
        await emitProgress(scoutId, "saving", "Saving scout results...", 68);


 return {pages:allPages,textContent:textContent.slice(0,50000),brandColor:detectedColor};
 }finally{clearTimeout(timer);io.signal?.removeEventListener('abort',stop);if(browser){const child=browser.process();let killTimer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([browser.close().catch(()=>{}),new Promise<void>(resolve=>{killTimer=setTimeout(resolve,3000);})]);}finally{clearTimeout(killTimer);if(child?.exitCode===null)try{child.kill('SIGKILL');}catch{}}}await proxy?.close();}
}
// ==================== Cookie Banner Dismissal ====================

async function dismissCookieBanners(page: Page) {
    for (const selector of COOKIE_SELECTORS) {
        try {
            // Use :has-text pseudo-selector pattern
            if (selector.includes(":has-text(")) {
                const text = selector.match(/:has-text\("(.+)"\)/)?.[1];
                if (text) {
                    const clicked = await page.evaluate((searchText) => {
                        const buttons = Array.from(document.querySelectorAll("button, a, [role='button']"));
                        const btn = buttons.find((b) => {
                            const t = b.textContent?.trim().toLowerCase() || "";
                            return t === searchText.toLowerCase() || t.includes(searchText.toLowerCase());
                        });
                        if (btn) {
                            (btn as HTMLElement).click();
                            return true;
                        }
                        return false;
                    }, text);
                    if (clicked) return;
                }
            } else {
                const el = await page.$(selector);
                if (el) {
                    await el.click();
                    await settle(500);
                    return;
                }
            }
        } catch {
            // Continue trying other selectors
        }
    }
}

// ==================== Auto Brand Color Detection ====================

async function detectBrandColor(page: Page, fallback: string): Promise<string> {
    try {
        // Take a small screenshot and analyze dominant colors
        const screenshot = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1440, height: 200 } });
        const { dominant } = await sharp(screenshot).stats();
        const { r, g, b } = dominant;

        // Skip if the color is too close to white, black, or gray
        const isGray = Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && Math.abs(r - b) < 30;
        const isTooWhite = r > 230 && g > 230 && b > 230;
        const isTooBlack = r < 25 && g < 25 && b < 25;

        if (isGray || isTooWhite || isTooBlack) {
            return fallback;
        }

        return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    } catch {
        return fallback;
    }
}

// ==================== Screenshot Capture ====================



async function capturePageScreenshots(
    page: Page,
    pageUrl: string,
    title: string,
    devices: string[],
    scoutId: string,
    prefix: string,
    save: CaptureIO['save']
): Promise<PageCapture> {
    const screenshots: Screenshot[] = [];

    for (const device of devices) {
        const viewport = VIEWPORTS[device as keyof typeof VIEWPORTS];
        if (!viewport) continue;

        await page.setViewport(viewport);
        await settle(1500);

        // Hero screenshot
        const heroName = `${prefix}-${device}-hero.png`;
        const heroBuffer = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: viewport.width, height: viewport.height } });
        const heroPath = await save(heroBuffer as Buffer, scoutId, heroName);
        screenshots.push({ path: heroPath, viewport: device, width: viewport.width, height: viewport.height, type: "hero" });

        // Bound very long pages before image allocation, not only after encoding.
        const pageHeight = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
        const captureHeight = Math.min(12000, Math.max(viewport.height, pageHeight));
        const fullName = `${prefix}-${device}-full.png`;
        const fullBuffer = await page.screenshot({ type: "png", clip:{x:0,y:0,width:viewport.width,height:captureHeight}, captureBeyondViewport:true });
        const fullPath = await save(fullBuffer as Buffer, scoutId, fullName);
        screenshots.push({ path: fullPath, viewport: device, width: viewport.width, height: captureHeight, type: "full" });

        // Feature screenshots (3 sections)
        const sectionHeight = viewport.height;
        const sections = Math.min(3, Math.floor(pageHeight / sectionHeight));

        for (let s = 1; s <= sections; s++) {
            const yOffset = Math.min(sectionHeight * s, pageHeight - viewport.height);
            const featureName = `${prefix}-${device}-feature-${s}.png`;
            const featureBuffer = await page.screenshot({ type: "png", clip: { x: 0, y: yOffset, width: viewport.width, height: viewport.height } });
            const featurePath = await save(featureBuffer as Buffer, scoutId, featureName);
            screenshots.push({ path: featurePath, viewport: device, width: viewport.width, height: viewport.height, type: "feature" });
        }
    }

    return { url: pageUrl, title, screenshots };
}
