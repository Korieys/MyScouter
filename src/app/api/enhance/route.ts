import { NextRequest, NextResponse } from "next/server";
import { createEnhancer } from "@/lib/scout-enhancer";
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
        await emitProgress(scoutId, "assets", "Assets saved. Preparing field notes...", 94).catch(() => {});

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
