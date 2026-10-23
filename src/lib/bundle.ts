import archiver from 'archiver';
import { assetName } from './scout-access';
export async function buildBundle(names: string[], load: (name: string, signal: AbortSignal) => Promise<Buffer>): Promise<Buffer> {
    if (!names.length || names.length > 150) throw new Error('Invalid asset count');
    const validNames = [...new Set(names.map(assetName))];
    const files: {name: string; data: Buffer}[] = [];
    let total = 0;
    const signal = AbortSignal.timeout(45000);
    for (let start = 0; start < validNames.length; start += 4) {
        signal.throwIfAborted();
        files.push(...await Promise.all(validNames.slice(start, start + 4).map(async name => {
            const data = await load(name, signal);
            signal.throwIfAborted();
            if (!data.length) throw new Error('An asset is empty');
            total += data.length;
            if (total > 128 * 1024 * 1024) throw new Error('Asset pack exceeds the download limit');
            return {name, data};
        })));
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
