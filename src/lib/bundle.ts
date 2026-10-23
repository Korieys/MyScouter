import archiver from 'archiver';

export function validateAssets(scoutId: unknown, assets: unknown, bucket: string): string[] {
    if (typeof scoutId !== 'string' || !/^scout-\d{13}$/.test(scoutId)) throw new Error('Invalid scout ID');
    if (!Array.isArray(assets) || !assets.length || assets.length > 150) throw new Error('Invalid asset list');
    const prefix = `/${bucket}/scouts/${scoutId}/`;
    return [...new Set(assets.map((value: unknown) => {
        if (typeof value !== 'string') throw new Error('Invalid asset URL');
        const url = new URL(value);
        const pathname = decodeURIComponent(url.pathname);
        const filename = pathname.slice(prefix.length);
        if (url.origin !== 'https://storage.googleapis.com' || url.username || url.password ||
            url.search || url.hash || !pathname.startsWith(prefix) ||
            !/^[a-zA-Z0-9_.-]+\.png$/.test(filename) || filename.includes('..')) {
            throw new Error('Asset does not belong to this scout');
        }
        return url.href;
    }))];
}

export async function buildBundle(urls: string[], fetchAsset: typeof fetch = fetch): Promise<Buffer> {
    const files: { name: string; data: Buffer }[] = [];
    let total = 0;
    const signal = AbortSignal.timeout(45000);
    for (let start = 0; start < urls.length; start += 4) {
        const batch = await Promise.all(urls.slice(start, start + 4).map(async url => {
            const response = await fetchAsset(url, { signal, redirect: 'error' });
            if (!response.ok || !response.body) throw new Error('An asset could not be downloaded');
            const chunks: Buffer[] = [];
            const reader = response.body.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    total += value.length;
                    if (total > 128 * 1024 * 1024) throw new Error('Asset pack exceeds the download limit');
                    chunks.push(Buffer.from(value));
                }
            } finally {
                await reader.cancel();
                reader.releaseLock();
            }
            const data = Buffer.concat(chunks);
            if (!data.length) throw new Error('An asset is empty');
            return { name: decodeURIComponent(new URL(url).pathname.split('/').pop()!), data };
        }));
        files.push(...batch);
    }
    const archive = archiver('zip', { zlib: { level: 1 } });
    const chunks: Buffer[] = [];
    const complete = new Promise<Buffer>((resolve, reject) => {
        archive.on('data', chunk => chunks.push(chunk));
        archive.once('error', reject);
        archive.once('end', () => resolve(Buffer.concat(chunks)));
    });
    for (const file of files) archive.append(file.data, { name: file.name });
    void archive.finalize().catch(error => archive.emit('error', error));
    return complete;
}
