import sharp from "sharp";
import type { saveAsset } from "./scout-server";


export function createEnhancer(uploadToStorage: typeof saveAsset) {

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
