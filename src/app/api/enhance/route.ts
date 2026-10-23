import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { emitProgress } from "@/lib/progress";
import { readAsset, requireScout, requireUser, saveAsset } from '@/lib/scout-server';
import { errorResponse, readInput, ScoutError } from '@/lib/scout-access';
import { getAdmin } from '@/lib/firebase-admin';
import { attemptAsset, workStore } from '@/lib/work-store';
export const maxDuration = 120;


export async function POST(req: NextRequest) {
    let releaseWork: (()=>Promise<void>) | undefined;
    try {
        await requireUser(req);
        const input = await readInput(req);
        const {ref, record, uid} = await requireScout(req, input.scoutId);
        if (!['captured', 'complete'].includes(record.status)) throw new ScoutError(409, 'Wait for this capture to finish.');
        const {id: scoutId, brandColor, pages} = record;
        if (record.enhancedAssets.length) return NextResponse.json({success:true, assets:record.enhancedAssets, scoutId}, {headers:{'Cache-Control':'private, no-store'}});
        const store = workStore(getAdmin().db);
        const reservation = await store.reserve(uid,'enhance',ref);
        if (reservation.cached) return NextResponse.json({success:true,assets:reservation.record.enhancedAssets,scoutId},{headers:{'Cache-Control':'private, no-store'}});
        releaseWork = () => store.release(reservation.lease);
        const {enhanceHero, createLaptopMockup, createBrowserChromeMockup, createPhoneMockup, createTabletMockup, createGridCollage, createSocialImage} = createEnhancer(
            (buffer,id,name) => saveAsset(buffer,id,attemptAsset(name,reservation.lease.token)),
        );

        const enhancedAssets: { path: string, type: string }[] = [];
        let step = 0;
        const totalSteps = pages.flatMap((p) => p.screenshots.filter((s) => s.type === "hero")).length * 2 + 4;

        await emitProgress(scoutId, "enhance", "Enhancing screenshots...", 72);

        // Process each page's screenshots
        for (const page of pages) {
            for (const shot of page.screenshots) {
                if (!shot.path) continue;

                if (shot.type === "hero") {
                    step++;
                    await emitProgress(scoutId, "enhance", `Enhancing hero ${step}...`, 72 + Math.round((step / totalSteps) * 15));

                    // Read only an asset listed in this owner's saved capture.
                    const inputBuffer = await readAsset(record, shot.path);
                    const basename = `hero-${step}`;

                    const enhanced = await enhanceHero(inputBuffer, brandColor, scoutId, basename);
                    enhancedAssets.push({ path: enhanced, type: "mockup" });

                    if (shot.viewport === "desktop") {
                        const laptopMockup = await createLaptopMockup(inputBuffer, scoutId, basename);
                        enhancedAssets.push({ path: laptopMockup, type: "mockup" });

                        // Browser chrome mockup (macOS Safari style)
                        const browserMockup = await createBrowserChromeMockup(inputBuffer, scoutId, basename);
                        enhancedAssets.push({ path: browserMockup, type: "mockup" });
                    }
                    if (shot.viewport === "mobile") {
                        const phoneMockup = await createPhoneMockup(inputBuffer, scoutId, basename);
                        enhancedAssets.push({ path: phoneMockup, type: "mockup" });
                    }
                    if (shot.viewport === "tablet") {
                        const tabletMockup = await createTabletMockup(inputBuffer, scoutId, basename);
                        enhancedAssets.push({ path: tabletMockup, type: "mockup" });
                    }
                }
            }
        }

        // Grid collages
        await emitProgress(scoutId, "collage", "Building grid collages...", 88);

        const featureShots = pages
            .flatMap((p) => p.screenshots)
            .filter((s) => s.type === "feature")
            .slice(0, 3);

        const featureBuffers = await Promise.all(
            featureShots.map(async (s) => {
                return readAsset(record, s.path);
            })
        );
        const validFeatureBuffers = featureBuffers.filter((b) => b !== null).map((b) => b as Buffer);

        if (validFeatureBuffers.length >= 2) {
            const collage3 = await createGridCollage(validFeatureBuffers, 3, brandColor, scoutId, "collage-3");
            enhancedAssets.push({ path: collage3, type: "grid" });
        }

        const allShots = pages.flatMap((p) => p.screenshots).slice(0, 6);
        const allBuffers = await Promise.all(
            allShots.map(async (s) => {
                return readAsset(record, s.path);
            })
        );
        const validAllBuffers = allBuffers.filter((b) => b !== null).map((b) => b as Buffer);

        if (validAllBuffers.length >= 4) {
            const collage6 = await createGridCollage(validAllBuffers, 6, brandColor, scoutId, "collage-6");
            enhancedAssets.push({ path: collage6, type: "grid" });
        }

        // Social images
        await emitProgress(scoutId, "social", "Generating social assets...", 92);

        const heroShot = pages[0]?.screenshots.find((s) => s.type === "hero" && s.viewport === "desktop");
        if (heroShot && heroShot.path) {
            {
                const heroBuffer = await readAsset(record, heroShot.path);
                const twitter = await createSocialImage(heroBuffer, 1200, 675, scoutId, "twitter");
                const linkedin = await createSocialImage(heroBuffer, 1200, 627, scoutId, "linkedin");
                const dribbble = await createSocialImage(heroBuffer, 1600, 1200, scoutId, "dribbble");
                const ph = await createSocialImage(heroBuffer, 1270, 760, scoutId, "producthunt");
                enhancedAssets.push(
                    { path: twitter, type: "social" },
                    { path: linkedin, type: "social" },
                    { path: dribbble, type: "social" },
                    { path: ph, type: "social" }
                );
            }
        }

        await store.complete(reservation.lease,ref,{enhancedAssets: enhancedAssets.map(asset => asset.path), status: 'complete'});
        releaseWork = undefined;
        await emitProgress(scoutId, "done", "All assets ready!", 100).catch(() => {});

        return NextResponse.json({
            success: true,
            assets: enhancedAssets.map(a => a.path),
            assetsMeta: enhancedAssets,
            scoutId,
        }, {headers:{'Cache-Control':'private, no-store'}});
    } catch (error) {
        return errorResponse(error, 'Enhancement could not finish. Your captured images remain in your history.');
    }
    finally { await releaseWork?.().catch(() => {}); }
}

// ==================== Enhancement Functions ====================

function createEnhancer(uploadToStorage: typeof saveAsset) {

async function enhanceHero(inputBuffer: Buffer, brandColor: string, scoutId: string, basename: string): Promise<string> {
    const image = sharp(inputBuffer);
    const meta = await image.metadata();
    const w = meta.width || 1440;
    const h = meta.height || 900;

    const padding = 60;
    const bgWidth = w + padding * 2;
    const bgHeight = h + padding * 2;
    const rgb = hexToRgb(brandColor);

    const bg = sharp({
        create: { width: bgWidth, height: bgHeight, channels: 4, background: { r: rgb.r, g: rgb.g, b: rgb.b, alpha: 0.08 } },
    }).png();

    const roundedCorners = Buffer.from(
        `<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="12" ry="12" fill="white"/></svg>`
    );

    const roundedImage = await sharp(inputBuffer).composite([{ input: roundedCorners, blend: "dest-in" }]).png().toBuffer();

    const shadow = Buffer.from(
        `<svg width="${bgWidth}" height="${bgHeight}">
      <defs><filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="4" stdDeviation="16" flood-color="#000" flood-opacity="0.12"/></filter></defs>
      <rect x="${padding}" y="${padding}" width="${w}" height="${h}" rx="12" ry="12" fill="white" filter="url(#shadow)"/>
    </svg>`
    );

    const finalBuffer = await bg.composite([{ input: shadow, top: 0, left: 0 }, { input: roundedImage, top: padding, left: padding }]).toBuffer();
    return uploadToStorage(finalBuffer, scoutId, `${basename}-enhanced.png`);
}

async function createBrowserChromeMockup(inputBuffer: Buffer, scoutId: string, basename: string): Promise<string> {
    const image = sharp(inputBuffer);
    const meta = await image.metadata();
    const w = meta.width || 1440;
    const h = meta.height || 900;

    const chromeHeight = 40;
    const padding = 2;
    const frameW = w + padding * 2;
    const frameH = h + chromeHeight + padding * 2;

    const chrome = Buffer.from(
        `<svg width="${frameW}" height="${frameH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${frameW}" height="${frameH}" rx="10" ry="10" fill="#E5E7EB"/>
      <!-- Title bar -->
      <rect x="0" y="0" width="${frameW}" height="${chromeHeight}" rx="10" ry="10" fill="#F3F4F6"/>
      <rect x="0" y="20" width="${frameW}" height="20" fill="#F3F4F6"/>
      <!-- Traffic lights -->
      <circle cx="20" cy="20" r="6" fill="#FF5F56"/>
      <circle cx="40" cy="20" r="6" fill="#FFBD2E"/>
      <circle cx="60" cy="20" r="6" fill="#27C93F"/>
      <!-- URL bar -->
      <rect x="80" y="10" width="${frameW - 160}" height="20" rx="4" ry="4" fill="#E5E7EB"/>
      <!-- Screen -->
      <rect x="${padding}" y="${chromeHeight}" width="${w}" height="${h}" fill="#000"/>
    </svg>`
    );

    const resized = await sharp(inputBuffer).resize(w, h).png().toBuffer();
    const finalBuffer = await sharp(chrome).composite([{ input: resized, top: chromeHeight, left: padding }]).png().toBuffer();
    return uploadToStorage(finalBuffer, scoutId, `${basename}-browser.png`);
}

async function createLaptopMockup(inputBuffer: Buffer, scoutId: string, basename: string): Promise<string> {
    const image = sharp(inputBuffer);
    const meta = await image.metadata();
    const w = meta.width || 1440;
    const h = meta.height || 900;

    const frameW = w + 80;
    const frameH = h + 120;

    const chrome = Buffer.from(
        `<svg width="${frameW}" height="${frameH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${frameW}" height="${h + 50}" rx="16" ry="16" fill="#E5E7EB"/>
      <rect x="20" y="20" width="${w + 40}" height="${h + 10}" rx="4" ry="4" fill="#1F2937"/>
      <rect x="40" y="30" width="${w}" height="${h}" rx="2" ry="2" fill="#000"/>
      <path d="M0,${h + 50} L${frameW},${h + 50} L${frameW + 40},${frameH} L-40,${frameH} Z" fill="#D1D5DB"/>
      <rect x="${frameW / 2 - 60}" y="${h + 55}" width="120" height="4" rx="2" fill="#9CA3AF"/>
    </svg>`
    );

    const resized = await sharp(inputBuffer).resize(w, h).png().toBuffer();
    const finalBuffer = await sharp(chrome).composite([{ input: resized, top: 30, left: 40 }]).png().toBuffer();
    return uploadToStorage(finalBuffer, scoutId, `${basename}-laptop.png`);
}

async function createPhoneMockup(inputBuffer: Buffer, scoutId: string, basename: string): Promise<string> {
    const screenW = 390, screenH = 844;
    const frameW = screenW + 40, frameH = screenH + 80;

    const chrome = Buffer.from(
        `<svg width="${frameW}" height="${frameH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${frameW}" height="${frameH}" rx="36" ry="36" fill="#1F2937"/>
      <rect x="4" y="4" width="${frameW - 8}" height="${frameH - 8}" rx="34" ry="34" fill="#374151"/>
      <rect x="20" y="40" width="${screenW}" height="${screenH}" rx="4" ry="4" fill="#000"/>
      <rect x="${frameW / 2 - 40}" y="12" width="80" height="20" rx="10" ry="10" fill="#1F2937"/>
    </svg>`
    );

    const resized = await sharp(inputBuffer).resize(screenW, screenH, { fit: "cover" }).png().toBuffer();
    const finalBuffer = await sharp(chrome).composite([{ input: resized, top: 40, left: 20 }]).png().toBuffer();
    return uploadToStorage(finalBuffer, scoutId, `${basename}-phone.png`);
}

async function createTabletMockup(inputBuffer: Buffer, scoutId: string, basename: string): Promise<string> {
    const screenW = 768, screenH = 1024;
    const frameW = screenW + 60, frameH = screenH + 80;

    const chrome = Buffer.from(
        `<svg width="${frameW}" height="${frameH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${frameW}" height="${frameH}" rx="24" ry="24" fill="#374151"/>
      <rect x="30" y="40" width="${screenW}" height="${screenH}" rx="4" ry="4" fill="#000"/>
      <circle cx="${frameW / 2}" cy="20" r="4" fill="#6B7280"/>
    </svg>`
    );

    const resized = await sharp(inputBuffer).resize(screenW, screenH, { fit: "cover" }).png().toBuffer();
    const finalBuffer = await sharp(chrome).composite([{ input: resized, top: 40, left: 30 }]).png().toBuffer();
    return uploadToStorage(finalBuffer, scoutId, `${basename}-tablet.png`);
}

async function createGridCollage(imageBuffers: Buffer[], gridSize: number, brandColor: string, scoutId: string, basename: string): Promise<string> {
    const rgb = hexToRgb(brandColor);

    const cols = gridSize <= 3 ? gridSize : 3;
    const rows = Math.ceil(Math.min(imageBuffers.length, gridSize) / cols);
    const cellW = 480, cellH = 300, gap = 20, padding = 40;

    const totalW = cols * cellW + (cols - 1) * gap + padding * 2;
    const totalH = rows * cellH + (rows - 1) * gap + padding * 2;

    const bg = sharp({
        create: { width: totalW, height: totalH, channels: 4, background: { r: rgb.r, g: rgb.g, b: rgb.b, alpha: 0.05 } },
    }).png();

    const composites = [];
    for (let i = 0; i < Math.min(imageBuffers.length, gridSize); i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);

        const resized = await sharp(imageBuffers[i]).resize(cellW, cellH, { fit: "cover" }).png().toBuffer();
        const mask = Buffer.from(`<svg width="${cellW}" height="${cellH}"><rect x="0" y="0" width="${cellW}" height="${cellH}" rx="12" ry="12" fill="white"/></svg>`);
        const rounded = await sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();

        composites.push({
            input: rounded,
            top: padding + row * (cellH + gap),
            left: padding + col * (cellW + gap),
        });
    }

    const finalBuffer = await bg.composite(composites).toBuffer();
    return uploadToStorage(finalBuffer, scoutId, `${basename}.png`);
}

async function createSocialImage(inputBuffer: Buffer, width: number, height: number, scoutId: string, platform: string): Promise<string> {
    const finalBuffer = await sharp(inputBuffer).resize(width, height, { fit: "cover", position: "top" }).png().toBuffer();
    return uploadToStorage(finalBuffer, scoutId, `${platform}-${width}x${height}.png`);
}

function hexToRgb(hex: string) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
        : { r: 45, g: 74, b: 34 };
}

return {enhanceHero,createLaptopMockup,createBrowserChromeMockup,createPhoneMockup,createTabletMockup,createGridCollage,createSocialImage};
}
