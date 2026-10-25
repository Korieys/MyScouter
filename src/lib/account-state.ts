import {createHash} from 'node:crypto';
import type {Firestore} from 'firebase-admin/firestore';
import {ScoutError} from './scout-access';

export const ACCOUNT_STATE_COLLECTION = 'privateScoutAccountState';
export function accountStateRef(db:Firestore, uid:string) {
    return db.collection(ACCOUNT_STATE_COLLECTION).doc(createHash('sha256').update(uid).digest('hex'));
}
export async function assertAccountActive(db:Firestore, uid:string) {
    if ((await accountStateRef(db,uid).get()).exists) {
        throw new ScoutError(410,'Account deletion has started. New captures and saved packs are no longer available.');
    }
}
