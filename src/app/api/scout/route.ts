import { NextRequest, NextResponse } from "next/server";
import puppeteerDev from "puppeteer";
import puppeteerCore, { type Browser, type Page } from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";
import sharp from "sharp";
import { emitProgress } from "@/lib/progress";
import { db } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { adminStorage } from "@/lib/firebase-admin";

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

interface ScoutRequest {
    url: string;
    brandColor?: string;
    devices?: string[];
    autoDetectColor?: boolean;
    userId?: string;
}

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

export async function POST(req: NextRequest) {
    let browser: Browser | null = null;
    const scoutId = `scout-${Date.now()}`;

    try {
        const body: ScoutRequest = await req.json();
        const { url, brandColor = "#2D4A22", devices = ["desktop"], autoDetectColor = false, userId = "anonymous" } = body;

        if (!url) {
            return NextResponse.json({ error: "URL is required" }, { status: 400 });
        }

        // Validate URL
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
            if (!["http:", "https:"].includes(parsedUrl.protocol)) {
                throw new Error("Invalid protocol");
            }
        } catch {
            return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
        }

        emitProgress(scoutId, "init", "Preparing scout...", 5);

        emitProgress(scoutId, "browser", "Launching scout browser...", 10);

        // Launch browser
        if (process.env.NODE_ENV === "production") {
            const executablePath = await chromium.executablePath(
                "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar"
            );
            browser = await puppeteerCore.launch({
                args: chromium.args,
                // @ts-ignore
                defaultViewport: chromium.defaultViewport as any,
                executablePath,
                // @ts-ignore
                headless: chromium.headless as any,
            });
        } else {
            browser = await puppeteerDev.launch({
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
            });
        }

        const page = await browser.newPage() as unknown as Page;
        page.setDefaultNavigationTimeout(30000);
        page.setDefaultTimeout(15000);

        emitProgress(scoutId, "navigate", `Navigating to ${parsedUrl.hostname}...`, 15);

        // Navigate to the target URL
        await page.goto(url, { waitUntil: "networkidle0" });

        // Dismiss cookie banners
        emitProgress(scoutId, "cookies", "Dismissing cookie banners...", 20);
        await dismissCookieBanners(page);

        // Wait for page to settle after cookie dismissal and styles/fonts to load
        await page.evaluateHandle('document.fonts.ready');
        await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

        // Extract text content for copy generation
        emitProgress(scoutId, "text", "Reading site content...", 25);
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
            emitProgress(scoutId, "color", "Detecting brand color...", 28);
            detectedColor = await detectBrandColor(page, brandColor);
        }

        // Discover navigation links (1 level deep)
        emitProgress(scoutId, "links", "Discovering pages...", 30);
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
        emitProgress(scoutId, "capture", "Capturing homepage...", 35);
        const allPages: PageCapture[] = [];
        const homepageCapture = await capturePageScreenshots(page, url, pageTitle, devices, scoutId, "home");
        allPages.push(homepageCapture);

        // Scout interior pages
        const totalPages = Math.min(navLinks.length, 5);
        for (let i = 0; i < totalPages; i++) {
            const pct = 40 + Math.round((i / totalPages) * 25);
            emitProgress(scoutId, "capture", `Scouting page ${i + 2} of ${totalPages + 1}...`, pct);
            try {
                await page.goto(navLinks[i], { waitUntil: "networkidle0" });
                await dismissCookieBanners(page);
                await page.evaluateHandle('document.fonts.ready');
                await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));
                const interiorTitle = await page.title();
                const interiorCapture = await capturePageScreenshots(
                    page, navLinks[i], interiorTitle, devices, scoutId, `page-${i + 1}`
                );
                allPages.push(interiorCapture);
            } catch {
                console.log(`Skipped: ${navLinks[i]}`);
            }
        }

        emitProgress(scoutId, "saving", "Saving scout results...", 68);

        // Save to Firestore
        const scoutRecord = {
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
                screenshots: p.screenshots // Save the actual screenshot URLs too
            })),
            textContent,
            status: "complete",
            createdAt: new Date().toISOString(),
            devices,
        };

        try {
            await setDoc(doc(db, "scouts", scoutId), scoutRecord);
        } catch (err) {
            console.error("Firestore save error:", err);
            // Non-fatal — continue even if Firestore save fails
        }

        emitProgress(scoutId, "complete", "Scout complete! Enhancing assets...", 70);

        return NextResponse.json({
            id: scoutId,
            url,
            domain: parsedUrl.hostname,
            brandColor: detectedColor,
            pages: allPages,
            textContent,
        });
    } catch (error) {
        console.error("Scout error:", error);
        emitProgress(scoutId, "error", error instanceof Error ? error.message : "Scout failed", -1);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Scout failed" },
            { status: 500 }
        );
    } finally {
        if (browser) {
            await browser.close();
        }
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

async function uploadToStorage(buffer: Buffer, scoutId: string, filename: string): Promise<string> {
    const file = adminStorage.file(`scouts/${scoutId}/${filename}`);
    await file.save(buffer, {
        metadata: { contentType: "image/png" },
        public: true, // Make file publicly readable
    });

    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${adminStorage.name}/${file.name}`;
    return publicUrl;
}

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
        const heroUrl = await uploadToStorage(heroBuffer as Buffer, scoutId, heroName);
        screenshots.push({ path: heroUrl, viewport: device, width: viewport.width, height: viewport.height, type: "hero" });

        // Full page screenshot
        const fullName = `${prefix}-${device}-full.png`;
        const fullBuffer = await page.screenshot({ type: "png", fullPage: true });
        const fullUrl = await uploadToStorage(fullBuffer as Buffer, scoutId, fullName);
        screenshots.push({ path: fullUrl, viewport: device, width: viewport.width, height: 0, type: "full" });

        // Feature screenshots (3 sections)
        const pageHeight = await page.evaluate(() => document.body.scrollHeight);
        const sectionHeight = viewport.height;
        const sections = Math.min(3, Math.floor(pageHeight / sectionHeight));

        for (let s = 1; s <= sections; s++) {
            const yOffset = Math.min(sectionHeight * s, pageHeight - viewport.height);
            const featureName = `${prefix}-${device}-feature-${s}.png`;
            const featureBuffer = await page.screenshot({ type: "png", clip: { x: 0, y: yOffset, width: viewport.width, height: viewport.height } });
            const featureUrl = await uploadToStorage(featureBuffer as Buffer, scoutId, featureName);
            screenshots.push({ path: featureUrl, viewport: device, width: viewport.width, height: viewport.height, type: "feature" });
        }
    }

    return { url: pageUrl, title, screenshots };
}
