import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import {maintenanceReason,recoverInterruptedCapture} from './scout-maintenance';
import type {ScoutRecord} from './scout-access';
import { ScoutError, validScoutId } from './scout-access';
import { SCOUT_COLLECTION } from './scout-server';
import type { ScoutHistoryPage } from './scout-history-types';

const PAGE_SIZE = 20;

function decodeCursor(cursor: string | null, uid: string): {createdAt: string; id: string} | null {
    if (cursor === null) return null;
    try {
        if (!cursor || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw Error('Invalid encoding');
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1 || value[1] !== uid) throw Error('Invalid scope');
        const createdAt = value[2];
        if (typeof createdAt !== 'string' || createdAt.length !== 24 || new Date(createdAt).toISOString() !== createdAt) throw Error('Invalid date');
        return {createdAt, id: validScoutId(value[3])};
    } catch { throw new ScoutError(400, 'This history position is invalid. Refresh your history and try again.'); }
}

export async function readScoutHistory(db: Firestore, uid: string, cursor: string | null): Promise<ScoutHistoryPage> {
    // The cursor is an untrusted position, never an ownership or access grant.
    const position = decodeCursor(cursor, uid);
    let query = db.collection(SCOUT_COLLECTION).where('userId', '==', uid)
        .orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (position) query = query.startAfter(position.createdAt, position.id);
    const snapshot = await query.limit(PAGE_SIZE + 1)
        .select('url', 'domain', 'status', 'createdAt', 'devices', 'pages').get();
    const docs = snapshot.docs.slice(0, PAGE_SIZE);
    const recovered=new Set<string>();
    await Promise.all(docs.map(async doc=>{
        const record=doc.data() as ScoutRecord;
        if(maintenanceReason(record,Date.now())==='interrupted' && await recoverInterruptedCapture(db,uid,doc.id))recovered.add(doc.id);
    }));
    const scouts = docs.map(doc => {
        const { url, domain, status, createdAt, devices, pages } = doc.data();
        return { id: doc.id, url, domain, status:recovered.has(doc.id)?'failed':status, createdAt, devices,
            pages: pages.map((page: {url: string; title: string}) => ({url: page.url, title: page.title})) };
    });
    const last = scouts.at(-1);
    const nextCursor = snapshot.docs.length > PAGE_SIZE && last
        ? Buffer.from(JSON.stringify([1, uid, last.createdAt, last.id])).toString('base64url') : null;
    return {scouts, nextCursor};
}
