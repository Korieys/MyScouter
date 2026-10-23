export class ScoutError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
}
export interface Screenshot { path: string; viewport: string; width: number; height: number; type: 'hero' | 'full' | 'feature' }
export interface CapturedPage { url: string; title: string; screenshots: Screenshot[] }
export interface ScoutCopy { pitch: string; blurbs: string[]; twitter: string; tagline: string }
export interface ScoutRecord {
    id: string; userId: string; url: string; domain: string; brandColor: string;
    pages: CapturedPage[]; textContent: string; devices: string[];
    enhancedAssets: string[]; copy: ScoutCopy | null; createdAt: string;
    status: 'capturing' | 'captured' | 'complete' | 'failed';
    progress?: { step: string; detail: string; progress: number; timestamp: number };
}
export function validScoutId(value: unknown): string {
    if (typeof value !== 'string' || !/^scout-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) throw new ScoutError(404, 'This scout is unavailable. Sign in to its owner account or create a new scout.');
    return value;
}
export async function verifiedUser(request: Request, verify: (token: string, revoked: boolean) => Promise<{ uid: string }>) {
    const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get('authorization') || '');
    if (!match || match[1].length > 8192) throw new ScoutError(401, 'Sign in to continue.');
    try {
        const identity = await verify(match[1], true);
        if (!identity.uid) throw new Error('Missing identity');
        return identity.uid;
    } catch (error) {
        if (error instanceof ScoutError && error.status === 503) throw error;
        throw new ScoutError(401, 'Your session has expired. Please sign in again.');
    }
}
export function assertOwner(record: ScoutRecord | undefined, uid: string): ScoutRecord {
    if (!record || record.userId !== uid) throw new ScoutError(404, 'This scout is unavailable for your account.');
    return record;
}
export function assetName(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.png$/.test(value)) throw new ScoutError(400, 'Invalid asset.');
    return value;
}
export function recordedAssets(record: ScoutRecord): string[] {
    return [...new Set([...record.pages.flatMap(page => page.screenshots.map(shot => shot.path)), ...record.enhancedAssets])].map(assetName);
}
export function storedAssetPath(scoutId: string, filename: string) {
    return `private-scouts/${validScoutId(scoutId)}/${assetName(filename)}`;
}
export function publicScout(record: ScoutRecord) {
    const {id,url,domain,brandColor,pages,textContent,devices,enhancedAssets,copy,createdAt,status,progress}=record;
    return {id,url,domain,brandColor,pages,textContent,devices,enhancedAssets,copy,createdAt,status,progress};
}
export function errorResponse(error: unknown, fallback = 'This request could not be completed. Please try again.') {
    return Response.json({ error: error instanceof ScoutError ? error.message : fallback }, {
        status: error instanceof ScoutError ? error.status : 503, headers: { 'Cache-Control': 'private, no-store' },
    });
}
export async function readInput(request: Request, maxBytes = 8192): Promise<Record<string, unknown>> {
    const reader = request.body?.getReader();
    if (!reader) throw new ScoutError(400, 'A request body is required.');
    let size = 0; const chunks: Uint8Array[] = [];
    try {
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.length; if (size > maxBytes) throw new ScoutError(413, 'The request is too large.');
            chunks.push(value);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid object');
        return data;
    } catch (error) {
        if (error instanceof ScoutError) throw error;
        throw new ScoutError(400, 'Invalid request.');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
