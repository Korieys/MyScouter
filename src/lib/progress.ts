import { getAdmin } from './firebase-admin';
import { SCOUT_COLLECTION } from './scout-server';
import { validScoutId } from './scout-access';
export async function emitProgress(jobId: string, step: string, detail: string, progress: number) {
    await getAdmin().db.collection(SCOUT_COLLECTION).doc(validScoutId(jobId)).update({
        progress: { step, detail, progress, timestamp: Date.now() },
    });
}
