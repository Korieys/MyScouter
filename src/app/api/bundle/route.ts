import { NextRequest, NextResponse } from 'next/server';
import { buildBundle, validateAssets } from '@/lib/bundle';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(req: NextRequest) {
    let scoutId: string;
    let urls: string[];
    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucket) return NextResponse.json({ error: 'Downloads are temporarily unavailable. Please try again later.' }, { status: 503 });
    try {
        const input = await req.json();
        urls = validateAssets(input.scoutId, input.assets, bucket);
        scoutId = input.scoutId;
    } catch {
        return NextResponse.json({ error: 'This asset pack is invalid. Reload the scout and try again.' }, { status: 400 });
    }
    try {
        const zip = await buildBundle(urls);
        return new NextResponse(new Uint8Array(zip), { headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="myscouter-${scoutId}.zip"`,
            'Content-Length': String(zip.length),
            'Cache-Control': 'no-store',
        } });
    } catch {
        return NextResponse.json({ error: 'We could not pack every asset. Please retry the download.' }, { status: 502 });
    }
}
