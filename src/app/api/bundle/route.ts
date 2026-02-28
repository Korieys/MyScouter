import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export async function POST(req: NextRequest) {
    try {
        const { scoutId } = await req.json();

        if (!scoutId) {
            return NextResponse.json({ error: "No scoutId provided" }, { status: 400 });
        }

        // 1. Fetch the scout data from Firestore to get all asset URLs
        const docRef = doc(db, "scouts", scoutId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            return NextResponse.json({ error: "Scout data not found" }, { status: 404 });
        }

        const scoutData = docSnap.data();
        const urlsToDownload: { url: string; name: string; folder: string }[] = [];

        // 2. Extract URLs from the scoutData pages/screenshots
        // Note: The /api/enhance route needs to also save its assets to the DB for them to be bundled here.
        // For now, we will bundle whatever exists in the `pages[].screenshots` array + `enhancedAssets` if they exist.
        if (scoutData.pages) {
            scoutData.pages.forEach((page: any, pIdx: number) => {
                if (page.screenshots) {
                    page.screenshots.forEach((shot: any, sIdx: number) => {
                        try {
                            const url = new URL(shot.path);
                            const pathname = decodeURIComponent(url.pathname);
                            const filename = pathname.split('/').pop() || `shot-${pIdx}-${sIdx}.png`;

                            let folder = "raw";
                            if (shot.type === "hero") folder = "hero";

                            urlsToDownload.push({
                                url: shot.path,
                                name: filename,
                                folder: folder
                            });
                        } catch (e) {
                            console.error("Invalid URL in screenshots: ", shot.path);
                        }
                    });
                }
            });
        }

        if (scoutData.assets) {
            // Include enhanced assets if they were saved to the DB
            scoutData.assets.forEach((asset: any, aIdx: number) => {
                try {
                    const assetUrl = typeof asset === 'string' ? asset : asset.path;
                    const url = new URL(assetUrl);
                    const pathname = decodeURIComponent(url.pathname);
                    const filename = pathname.split('/').pop() || `enhanced-${aIdx}.png`;

                    let folder = "enhanced";
                    if (asset.type) folder = asset.type; // mockup, grid, social

                    urlsToDownload.push({
                        url: assetUrl,
                        name: filename,
                        folder: folder
                    });
                } catch (e) {
                    console.error("Invalid URL in assets: ", asset);
                }
            });
        }

        if (urlsToDownload.length === 0) {
            return NextResponse.json({ error: "No assets found to bundle" }, { status: 404 });
        }

        // 3. Create a ZIP archive mapped to the memory
        const archive = archiver("zip", { zlib: { level: 9 } });
        const chunks: Buffer[] = [];
        archive.on("data", (chunk: Buffer) => chunks.push(chunk));

        // 4. Download and append each file
        for (const item of urlsToDownload) {
            try {
                const response = await fetch(item.url);
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    archive.append(buffer, { name: `${item.folder}/${item.name}` });
                }
            } catch (err) {
                console.error(`Failed to download ${item.url} for bundling`, err);
            }
        }

        await archive.finalize();

        // 5. Send the ZIP buffer
        const zipBuffer = Buffer.concat(chunks);

        return new NextResponse(zipBuffer, {
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="myscouter-${scoutId}.zip"`,
                "Content-Length": String(zipBuffer.length),
            },
        });
    } catch (error) {
        console.error("Bundle error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Bundling failed" },
            { status: 500 }
        );
    }
}
