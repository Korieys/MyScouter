import { NextRequest, NextResponse } from "next/server";
import puppeteerDev from "puppeteer";
import puppeteerCore, { type Browser, type Page } from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";
import sharp from "sharp";
import OpenAI from "openai";
import { emitProgress, resolveJobId } from "@/lib/progress";
import { adminStorage, adminDb } from "@/lib/firebase-admin";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

interface AuthConfig {
    mode: "basic" | "advanced";
    loginUrl: string;
    username: string;
    password: string;
}

interface ScoutRequest {
    url: string;
    brandColor?: string;
    devices?: string[];
    autoDetectColor?: boolean;
    userId?: string;
    jobId?: string;
    auth?: AuthConfig;
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

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    let browser: Browser | null = null;
    const scoutId = `scout-${Date.now()}`;
    let jobId = scoutId;

    try {
        const body: ScoutRequest = await req.json();
        jobId = resolveJobId(body.jobId, scoutId);
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

        emitProgress(jobId, "init", "Preparing scout...", 5);

        emitProgress(jobId, "browser", "Launching scout browser...", 10);

        // Launch browser
        if (process.env.NODE_ENV === "production") {
            const executablePath = await chromium.executablePath(
                "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar"
            );
            browser = await puppeteerCore.launch({
                args: [...chromium.args, "--disable-web-security", "--font-render-hinting=none"],
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

        emitProgress(jobId, "navigate", `Navigating to ${parsedUrl.hostname}...`, 15);

        // ── Authentication Phase ──
        let authSucceeded = false;
        if (body.auth && body.auth.loginUrl && body.auth.username) {
            emitProgress(jobId, "auth", "Authenticating...", 15);
            try {
                if (body.auth.mode === "advanced") {
                    await authenticateAdvanced(page, body.auth, jobId);
                } else {
                    await authenticateBasic(page, body.auth, jobId);
                }
                authSucceeded = true;
                emitProgress(jobId, "auth", "Authentication successful!", 18);
            } catch (authErr) {
                console.error("Auth error:", authErr);
                emitProgress(jobId, "auth", "Authentication failed — continuing as guest.", 18);
            }
        }

        // Navigate to the target URL — after auth the session cookies
        // will carry over so the target URL should load in an authenticated state.
        // Always navigate to the target URL the user actually wants to scout.
        console.log(`[scout] Navigating to target: ${url}`);
        await page.goto(url, { waitUntil: "networkidle2" });

        // Give the page time to settle (SPA redirects, auth checks, etc.)
        await page.evaluate(() => new Promise((r) => setTimeout(r, 3000)));

        // Log where we actually ended up (helps debug auth issues)
        const landingUrl = page.url();
        const landingTitle = await page.title();
        console.log(`[scout] Landed on: ${landingUrl} — "${landingTitle}"`);

        // Dismiss cookie banners
        emitProgress(jobId, "cookies", "Dismissing cookie banners...", 20);
        await dismissCookieBanners(page);

        // Wait for page to settle after cookie dismissal and styles/fonts to load
        await page.evaluateHandle('document.fonts.ready');
        await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

        // Extract text content for copy generation
        emitProgress(jobId, "text", "Reading site content...", 25);
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
            emitProgress(jobId, "color", "Detecting brand color...", 28);
            detectedColor = await detectBrandColor(page, brandColor);
        }

        // Discover navigation links (1 level deep)
        // Use the current page URL as base (may differ from target after auth)
        const currentUrl = page.url();
        emitProgress(jobId, "links", "Discovering pages...", 30);
        const navLinks = await page.evaluate((baseUrl: string) => {
            const links: string[] = [];
            const anchors = document.querySelectorAll("nav a, header a, [role='navigation'] a, aside a, [class*='sidebar'] a, [class*='menu'] a");
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
        }, currentUrl);

        // Capture homepage screenshots
        emitProgress(jobId, "capture", "Capturing homepage...", 35);
        const allPages: PageCapture[] = [];
        const homepageCapture = await capturePageScreenshots(page, currentUrl, pageTitle, devices, scoutId, "home");
        allPages.push(homepageCapture);

        // Scout interior pages
        const totalPages = Math.min(navLinks.length, 5);
        for (let i = 0; i < totalPages; i++) {
            const pct = 40 + Math.round((i / totalPages) * 25);
            emitProgress(jobId, "capture", `Scouting page ${i + 2} of ${totalPages + 1}...`, pct);
            try {
                await page.goto(navLinks[i], { waitUntil: "networkidle2" });
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

        emitProgress(jobId, "saving", "Saving scout results...", 68);

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
            await adminDb.doc(`scouts/${scoutId}`).set(scoutRecord);
        } catch (err) {
            console.error("Firestore save error:", err);
            // Non-fatal — continue even if Firestore save fails
        }

        emitProgress(jobId, "complete", "Scout complete! Enhancing assets...", 70);

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
        emitProgress(jobId, "error", error instanceof Error ? error.message : "Scout failed", -1);
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
    const uploadPromises: Promise<void>[] = [];

    for (const device of devices) {
        const viewport = VIEWPORTS[device as keyof typeof VIEWPORTS];
        if (!viewport) continue;

        await page.setViewport(viewport);
        await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

        // Hero screenshot
        const heroName = `${prefix}-${device}-hero.png`;
        const heroBuffer = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: viewport.width, height: viewport.height } });
        uploadPromises.push(uploadToStorage(heroBuffer as Buffer, scoutId, heroName).then(url => {
            screenshots.push({ path: url, viewport: device, width: viewport.width, height: viewport.height, type: "hero" });
        }));

        // Full page screenshot
        const fullName = `${prefix}-${device}-full.png`;
        const fullBuffer = await page.screenshot({ type: "png", fullPage: true });
        uploadPromises.push(uploadToStorage(fullBuffer as Buffer, scoutId, fullName).then(url => {
            screenshots.push({ path: url, viewport: device, width: viewport.width, height: 0, type: "full" });
        }));

        // Feature screenshots (3 sections)
        const pageHeight = await page.evaluate(() => document.body.scrollHeight);
        const sectionHeight = viewport.height;
        const sections = Math.min(3, Math.floor(pageHeight / sectionHeight));

        for (let s = 1; s <= sections; s++) {
            const yOffset = Math.min(sectionHeight * s, pageHeight - viewport.height);
            const featureName = `${prefix}-${device}-feature-${s}.png`;
            const featureBuffer = await page.screenshot({ type: "png", clip: { x: 0, y: yOffset, width: viewport.width, height: viewport.height } });
            uploadPromises.push(uploadToStorage(featureBuffer as Buffer, scoutId, featureName).then(url => {
                screenshots.push({ path: url, viewport: device, width: viewport.width, height: viewport.height, type: "feature" });
            }));
        }
    }

    await Promise.all(uploadPromises);
    return { url: pageUrl, title, screenshots };
}

// ==================== Basic Authentication ====================

const LOGIN_INPUT_SELECTORS = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[name="user"]',
    'input[name="login"]',
    'input[id="email"]',
    'input[id="username"]',
    'input[id="login"]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
    'input[type="text"]',
];

const PASSWORD_INPUT_SELECTORS = [
    'input[type="password"]',
    'input[name="password"]',
    'input[name="pass"]',
    'input[id="password"]',
    'input[autocomplete="current-password"]',
];

const SUBMIT_SELECTORS = [
    'button[type="submit"]',
    'input[type="submit"]',
];

const SUBMIT_TEXT_PATTERNS = ["log in", "login", "sign in", "signin", "submit", "continue", "next"];

async function authenticateBasic(page: Page, auth: AuthConfig, jobId: string): Promise<void> {
    emitProgress(jobId, "auth", `Navigating to login page...`, 15);
    await page.goto(auth.loginUrl, { waitUntil: "networkidle2" });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

    // Find username/email field
    let usernameField = null;
    for (const sel of LOGIN_INPUT_SELECTORS) {
        usernameField = await page.$(sel);
        if (usernameField) break;
    }
    if (!usernameField) throw new Error("Could not find username/email input");

    // Find password field
    let passwordField = null;
    for (const sel of PASSWORD_INPUT_SELECTORS) {
        passwordField = await page.$(sel);
        if (passwordField) break;
    }

    // Type credentials
    emitProgress(jobId, "auth", "Entering credentials...", 16);
    await usernameField.click({ clickCount: 3 });
    await usernameField.type(auth.username, { delay: 40 });

    if (passwordField && auth.password) {
        // Single-page login — both fields visible
        await passwordField.click({ clickCount: 3 });
        await passwordField.type(auth.password, { delay: 40 });
    }

    // Find submit button
    emitProgress(jobId, "auth", "Submitting login...", 17);
    let submitted = false;

    for (const sel of SUBMIT_SELECTORS) {
        const btn = await page.$(sel);
        if (btn) {
            await btn.click();
            submitted = true;
            break;
        }
    }

    if (!submitted) {
        // Try text-matching for buttons
        submitted = await page.evaluate((patterns: string[]) => {
            const els = Array.from(document.querySelectorAll('button, a[role="button"], input[type="button"]'));
            for (const el of els) {
                const text = (el as HTMLElement).textContent?.trim().toLowerCase() || "";
                if (patterns.some((p) => text.includes(p))) {
                    (el as HTMLElement).click();
                    return true;
                }
            }
            return false;
        }, SUBMIT_TEXT_PATTERNS);
    }

    if (!submitted) {
        // Last resort: press Enter on the password or username field
        await page.keyboard.press("Enter");
    }

    // Wait for navigation after form submission
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => { });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

    // Handle two-step login: if password field wasn't on the first page,
    // look for one now and enter the password
    if (!passwordField && auth.password) {
        let pw2 = null;
        for (const sel of PASSWORD_INPUT_SELECTORS) {
            pw2 = await page.$(sel);
            if (pw2) break;
        }
        if (pw2) {
            await pw2.click({ clickCount: 3 });
            await pw2.type(auth.password, { delay: 40 });
            await page.keyboard.press("Enter");
            await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => { });
            await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));
        }
    }

    // Debug: log where we ended up after auth
    const finalUrl = page.url();
    const pageTitle = await page.title();
    console.log(`[auth-basic] Finished. Current URL: ${finalUrl}, Title: ${pageTitle}`);
}

// ==================== Advanced (AI-Assisted) Authentication ====================

async function authenticateAdvanced(page: Page, auth: AuthConfig, jobId: string): Promise<void> {
    emitProgress(jobId, "auth", `Navigating to login page...`, 15);
    await page.goto(auth.loginUrl, { waitUntil: "networkidle2" });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

    // Allow up to 3 rounds of AI-driven interaction (for multi-step logins)
    for (let round = 0; round < 3; round++) {
        emitProgress(jobId, "auth", `AI analyzing login form (step ${round + 1})...`, 15 + round);

        // Extract a minimised interactive DOM map
        const domMap = await page.evaluate(() => {
            const elements: { tag: string; type?: string; name?: string; id?: string; placeholder?: string; text?: string; ariaLabel?: string; selector: string; visible: boolean }[] = [];
            const interactiveSelectors = 'input, button, a, select, textarea, [role="button"], [type="submit"]';
            document.querySelectorAll(interactiveSelectors).forEach((el, idx) => {
                const htmlEl = el as HTMLElement;
                const rect = htmlEl.getBoundingClientRect();
                const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(htmlEl).display !== 'none' && getComputedStyle(htmlEl).visibility !== 'hidden';
                elements.push({
                    tag: el.tagName.toLowerCase(),
                    type: el.getAttribute('type') || undefined,
                    name: el.getAttribute('name') || undefined,
                    id: el.getAttribute('id') || undefined,
                    placeholder: el.getAttribute('placeholder') || undefined,
                    text: htmlEl.textContent?.trim().slice(0, 80) || undefined,
                    ariaLabel: el.getAttribute('aria-label') || undefined,
                    selector: `[data-scout-idx="${idx}"]`,
                    visible,
                });
                htmlEl.setAttribute('data-scout-idx', String(idx));
            });
            return elements.filter((e) => e.visible);
        });

        const pageUrl = page.url();

        // Ask OpenAI to decide what to do
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0,
            max_tokens: 600,
            messages: [
                {
                    role: "system",
                    content: `You are a browser automation specialist. You are given a list of interactive DOM elements on a login page. Your job is to output a JSON array of actions to log in.

Available action types:
- { "action": "type", "selector": "...", "value": "..." }  — click the field and type a value
- { "action": "click", "selector": "..." }                  — click a button or link
- { "action": "press", "key": "Enter" }                      — press a keyboard key
- { "action": "done" }                                       — login is complete or there are no more actions needed

Rules:
1. Use the exact "selector" values from the DOM map provided.
2. Fill in the username/email field with the provided username.
3. Fill in the password field with the provided password if it is visible. If you don't see a password field, fill in what is available and click the submit/continue/next button.
4. Always end with a submit action (click or press Enter).
5. Respond ONLY with a valid JSON array. No explanation.`,
                },
                {
                    role: "user",
                    content: `Current page URL: ${pageUrl}
Username to enter: ${auth.username}
Password to enter: ${auth.password || "(none)"}

Interactive DOM elements:
${JSON.stringify(domMap, null, 2)}`,
                },
            ],
        });

        const raw = completion.choices[0]?.message?.content || "[]";
        let actions: { action: string; selector?: string; value?: string; key?: string }[];
        try {
            const jsonMatch = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
            actions = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
        } catch {
            // Don't log the raw reply: it can echo the user's password.
            console.error(`AI returned unparseable actions (${raw.length} chars)`);
            break;
        }

        // Execute each action
        for (const act of actions) {
            try {
                if (act.action === "done") break;
                if (act.action === "type" && act.selector && act.value) {
                    const el = await page.$(act.selector);
                    if (el) {
                        await el.click({ clickCount: 3 });
                        await el.type(act.value, { delay: 35 });
                    }
                } else if (act.action === "click" && act.selector) {
                    const el = await page.$(act.selector);
                    if (el) await el.click();
                } else if (act.action === "press" && act.key) {
                    await page.keyboard.press(act.key as any);
                }
            } catch (e) {
                // Redact typed values so credentials never reach the server logs.
                console.warn("Action failed:", { ...act, value: act.value ? "[redacted]" : undefined }, e);
            }
        }

        // Wait for potential navigation
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }).catch(() => { });
        await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

        // Check if we're still on the login page
        const currentUrl = page.url();
        const stillOnLogin = currentUrl === auth.loginUrl || currentUrl === auth.loginUrl + "/";

        // Check if a password field appeared (multi-step)
        const hasNewPasswordField = await page.$('input[type="password"]');
        if (!stillOnLogin && !hasNewPasswordField) {
            // We've navigated away from login — success!
            break;
        }
        // Otherwise, loop to handle the next step
    }
}
