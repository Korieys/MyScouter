import { getAdmin } from './firebase-admin';
import {assertAccountActive} from './account-state';
import { assertOwner, assetName, recordedAssets, ScoutError, storedAssetPath, validScoutId, validProgressId, verifiedUser, type ScoutRecord } from './scout-access';
export const SCOUT_COLLECTION = 'privateScouts';
export function createScoutAccess(services: typeof getAdmin) {
 const requestIdentities = new WeakMap<Request, Promise<string>>();
 async function requireUser(request: Request) {
    const cached=requestIdentities.get(request); if(cached)return cached;
    const identity=verifiedUser(request, (token, revoked) => {
        let configured:ReturnType<typeof getAdmin>;
        try {configured=services();} catch {throw new ScoutError(503,'Account services are temporarily unavailable. Please try again later.');}
        return configured.auth.verifyIdToken(token, revoked);
    }).then(async uid=>{await assertAccountActive(services().db,uid);return uid;});
    requestIdentities.set(request,identity); return identity;
 }
 async function requireScout(request: Request, id: unknown) {
    const uid = await requireUser(request);
    const ref = services().db.collection(SCOUT_COLLECTION).doc(validScoutId(id));
    const record = assertOwner((await ref.get()).data() as ScoutRecord | undefined, uid);
    return { uid, ref, record };
 }
 async function requireProgress(request: Request, id: unknown) {
    const uid = await requireUser(request);
    const result = await services().db.collection(SCOUT_COLLECTION)
        .where('userId', '==', uid).where('progressJobId', '==', validProgressId(id)).limit(1).get();
    return assertOwner(result.docs[0]?.data() as ScoutRecord | undefined, uid);
 }
 return {requireUser, requireScout, requireProgress};
}
export const {requireUser, requireScout, requireProgress} = createScoutAccess(getAdmin);
export async function saveAsset(buffer: Buffer, id: string, filename: string): Promise<string> {
    if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new ScoutError(422, 'This screenshot exceeds the asset size limit.');
    await getAdmin().bucket.file(storedAssetPath(id, filename)).save(buffer, {
        resumable: false, predefinedAcl: 'private', metadata: { contentType: 'image/png', cacheControl: 'private, no-store' },
    });
    return assetName(filename);
}
export async function readAsset(record: ScoutRecord, filename: string, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted();
    if (!recordedAssets(record).includes(assetName(filename))) throw new ScoutError(404, 'This asset is unavailable.');
    const stream = getAdmin().bucket.file(storedAssetPath(record.id, filename)).createReadStream();
    const timer = setTimeout(() => stream.destroy(new Error('Asset read timeout')), 15000);
    const abort = () => stream.destroy(new Error('Asset read cancelled'));
    signal?.addEventListener('abort', abort, {once:true});
    const chunks: Buffer[] = []; let size = 0;
    try {
        for await (const chunk of stream) {
            size += chunk.length;
            if (size > 20 * 1024 * 1024) throw new ScoutError(422, 'This asset exceeds the download size limit.');
            chunks.push(chunk);
        }
        if (!size) throw new Error('Empty asset');
        return Buffer.concat(chunks);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); stream.destroy(); }
}
