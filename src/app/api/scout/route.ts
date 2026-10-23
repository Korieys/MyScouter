import { NextRequest, NextResponse } from "next/server";
import puppeteerDev from "puppeteer";
import puppeteerCore, { type Browser, type Page } from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";
import sharp from "sharp";
import { emitProgress } from "@/lib/progress";
import { randomUUID } from 'node:crypto';
import { getAdmin } from '@/lib/firebase-admin';
import { requireUser, saveAsset, SCOUT_COLLECTION } from '@/lib/scout-server';
import { errorResponse, publicScout, readInput, ScoutError, type ScoutRecord } from '@/lib/scout-access';
import { publicUrl, resolvePublic } from '@/lib/public-network';
import { captureBrowserArgs, startCaptureProxy } from '@/lib/capture-proxy';

// Viewport configs
const VIEWPORTS = {
    desktop: { width: 1440, height: 900 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 390, height: 844 },
};

// Common cookie banner selectors
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


interface Screenshot {
    path: string;
    viewport: string;
    width: number;
    height: number;
    type: "hero" | "full" | "feature";
}

interface PageCapture {
    url: string;
    title: string;
    screenshots: Screenshot[];
}

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    let browser: Browser | null = null;
    let proxy: Awaited<ReturnType<typeof startCaptureProxy>> | null = null;
    const scoutId = `scout-${randomUUID()}`;
    let recordCreated = false;
    let expired = false;
    const deadline = setTimeout(() => {
        expired = true;
        void browser?.close().catch(() => {});
        void proxy?.close();
    }, 240000);
    deadline.unref();
    const checkDeadline = () => {
        if (expired) throw new ScoutError(422, 'This website took too long to capture. Try a smaller page.');
        proxy?.assertWithinBudget();
    };

    try {
        const userId = await requireUser(req);
        const body = await readInput(req);
        const { url, brandColor = '#2D4A22', devices = ['desktop'], autoDetectColor = false } = body;
        if (typeof url !== 'string' || url.length > 2048 || typeof brandColor !== 'string' || !/^#[a-f0-9]{6}$/i.test(brandColor) ||
            !Array.isArray(devices) || !devices.length || devices.length > 3 || new Set(devices).size !== devices.length || devices.some(device => !['desktop','tablet','mobile'].includes(device)) || typeof autoDetectColor !== 'boolean') {
            throw new ScoutError(400, 'Choose a valid website, color and at least one device.');
        }

        if (!url) {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        const parsedUrl = publicUrl(url);
        await resolvePublic(parsedUrl);

        await getAdmin().db.collection(SCOUT_COLLECTION).doc(scoutId).create({
            id: scoutId, userId, url, domain: parsedUrl.hostname, brandColor, devices,
            status: 'capturing', pages: [], enhancedAssets: [], copy: null, textContent: '', createdAt: new Date().toISOString(),
        });
        recordCreated = true;
        await emitProgress(scoutId, "init", "Preparing scout...", 5);

        await emitProgress(scoutId, "browser", "Launching scout browser...", 10);

        // Launch browser
        proxy = await startCaptureProxy();
        if (process.env.NODE_ENV === "production") {
            const executablePath = await chromium.executablePath(
                "https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar"
            );
            browser = await puppeteerCore.launch({
                args: captureBrowserArgs(proxy.url, chromium.args),
                defaultViewport: VIEWPORTS.desktop,
                executablePath,
                headless: 'shell',
                pipe: true,
            });
        } else {
            browser = await puppeteerDev.launch({
                headless: true,
                pipe: true,
                args: captureBrowserArgs(proxy.url, [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ]),
            });
        }

        checkDeadline();
        const page = await browser.newPage() as unknown as Page;
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
            } catch {void request.abort('blockedbyclient').catch(() => {});}
        });

        await emitProgress(scoutId, "navigate", `Navigating to ${parsedUrl.hostname}...`, 15);

        // Navigate to the target URL
        const navigation = await page.goto(parsedUrl.href, { waitUntil: "networkidle2" });
        if (!navigation?.ok()) throw new ScoutError(422, 'This website could not be read. Try another public page.');

        // Dismiss cookie banners
        await emitProgress(scoutId, "cookies", "Dismissing cookie banners...", 20);
        await dismissCookieBanners(page);

        // Wait for page to settle after cookie dismissal and styles/fonts to load
        await page.evaluateHandle('document.fonts.ready');
        await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

        // Extract text content for copy generation
        await emitProgress(scoutId, "text", "Reading site content...", 25);
        const textContent = await page.evaluate(() => {
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

        const pageTitle = await page.title();

        // Auto-detect brand color from screenshot
        let detectedColor = brandColor;
        if (autoDetectColor) {
            await emitProgress(scoutId, "color", "Detecting brand color...", 28);
            detectedColor = await detectBrandColor(page, brandColor);
        }

        // Discover navigation links (1 level deep)
        await emitProgress(scoutId, "links", "Discovering pages...", 30);
        const navLinks = await page.evaluate((baseUrl: string) => {
            const links: string[] = [];
            const anchors = document.querySelectorAll("nav a, header a, [role='navigation'] a");
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
        const homepageCapture = await capturePageScreenshots(page, url, pageTitle, devices, scoutId, "home");
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
                await page.evaluateHandle('document.fonts.ready');
                await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));
                const interiorTitle = await page.title();
                const interiorCapture = await capturePageScreenshots(
                    page, navLinks[i], interiorTitle, devices, scoutId, `page-${i + 1}`
                );
                allPages.push(interiorCapture);
            } catch {
                // One unavailable interior page does not discard a valid homepage.
            }
        }

        checkDeadline();
        await emitProgress(scoutId, "saving", "Saving scout results...", 68);

        // Save to Firestore
        const scoutRecord: ScoutRecord = {
            id: scoutId,
            userId,
            url,
            domain: parsedUrl.hostname,
            brandColor: detectedColor,
            pages: allPages.map((p) => ({
                url: p.url,
                title: p.title,
                screenshotCount: p.screenshots.length,
                viewports: [...new Set(p.screenshots.map((s) => s.viewport))],
                screenshots: p.screenshots
            })),
            textContent,
            status: "captured",
            enhancedAssets: [],
            copy: null,
            createdAt: new Date().toISOString(),
            devices,
        };

        await getAdmin().db.collection(SCOUT_COLLECTION).doc(scoutId).set(scoutRecord, {merge:true});
        await emitProgress(scoutId, 'complete', 'Capture saved. Preparing assets...', 70);
        return NextResponse.json(publicScout(scoutRecord), {headers:{'Cache-Control':'private, no-store'}});
    } catch (error) {
        if (recordCreated) {
            await getAdmin().db.collection(SCOUT_COLLECTION).doc(scoutId).update({status:'failed'}).catch(() => {});
            await emitProgress(scoutId, 'error', 'The capture could not finish. Please try again.', -1).catch(() => {});
        }
        return errorResponse(error, 'The website could not be captured. Check its address and try again.');
    } finally {
        clearTimeout(deadline);
        if (browser) {
            await browser.close().catch(() => {});
        }
        await proxy?.close();
    }
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
                    await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
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

const uploadToStorage = saveAsset;

async function capturePageScreenshots(
    page: Page,
    pageUrl: string,
    title: string,
    devices: string[],
    scoutId: string,
    prefix: string
): Promise<PageCapture> {
    const screenshots: Screenshot[] = [];

    for (const device of devices) {
        const viewport = VIEWPORTS[device as keyof typeof VIEWPORTS];
        if (!viewport) continue;

        await page.setViewport(viewport);
        await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

        // Hero screenshot
        const heroName = `${prefix}-${device}-hero.png`;
        const heroBuffer = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: viewport.width, height: viewport.height } });
        const heroPath = await uploadToStorage(heroBuffer as Buffer, scoutId, heroName);
        screenshots.push({ path: heroPath, viewport: device, width: viewport.width, height: viewport.height, type: "hero" });

        // Bound very long pages before image allocation, not only after encoding.
        const pageHeight = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
        const captureHeight = Math.min(12000, Math.max(viewport.height, pageHeight));
        const fullName = `${prefix}-${device}-full.png`;
        const fullBuffer = await page.screenshot({ type: "png", clip:{x:0,y:0,width:viewport.width,height:captureHeight}, captureBeyondViewport:true });
        const fullPath = await uploadToStorage(fullBuffer as Buffer, scoutId, fullName);
        screenshots.push({ path: fullPath, viewport: device, width: viewport.width, height: captureHeight, type: "full" });

        // Feature screenshots (3 sections)
        const sectionHeight = viewport.height;
        const sections = Math.min(3, Math.floor(pageHeight / sectionHeight));

        for (let s = 1; s <= sections; s++) {
            const yOffset = Math.min(sectionHeight * s, pageHeight - viewport.height);
            const featureName = `${prefix}-${device}-feature-${s}.png`;
            const featureBuffer = await page.screenshot({ type: "png", clip: { x: 0, y: yOffset, width: viewport.width, height: viewport.height } });
            const featurePath = await uploadToStorage(featureBuffer as Buffer, scoutId, featureName);
            screenshots.push({ path: featurePath, viewport: device, width: viewport.width, height: viewport.height, type: "feature" });
        }
    }

    return { url: pageUrl, title, screenshots };
}
