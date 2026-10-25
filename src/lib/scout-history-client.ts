import type { User } from 'firebase/auth';
import { authFetch, jsonResult } from './auth-fetch';
import type { ScoutHistoryPage } from './scout-history-types';

function parsePage(value: unknown): ScoutHistoryPage {
    const page = value as ScoutHistoryPage;
    if (!page || !Array.isArray(page.scouts) || page.scouts.length > 20 ||
        !(page.nextCursor === null || (typeof page.nextCursor === 'string' && page.nextCursor.length > 0 && page.nextCursor.length <= 1024)) ||
        !page.scouts.every(scout => scout && /^scout-[a-f0-9-]{36}$/.test(scout.id) &&
            typeof scout.url === 'string' && typeof scout.domain === 'string' && typeof scout.status === 'string' &&
            typeof scout.createdAt === 'string' && Number.isFinite(Date.parse(scout.createdAt)) &&
            Array.isArray(scout.devices) && scout.devices.every(item => typeof item === 'string') &&
            Array.isArray(scout.pages) && scout.pages.every(item => item && typeof item.url === 'string' && typeof item.title === 'string'))) {
        throw new Error('Your scout history could not load. Please try again.');
    }
    return page;
}

export async function loadScoutHistory(user: User, cursor: string | null, signal: AbortSignal): Promise<ScoutHistoryPage> {
    const deadline = AbortSignal.timeout(20_000);
    const combined = AbortSignal.any([signal, deadline]);
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error(deadline.aborted ? 'Your history took too long to load. Please try again.' : 'History loading was cancelled.'));
        combined.addEventListener('abort', onAbort, {once:true});
        if (combined.aborted) onAbort();
    });
    try {
        const path = '/api/scouts' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');
        return await Promise.race([authFetch(user, path, {signal:combined}).then(jsonResult).then(parsePage), aborted]);
    } finally { combined.removeEventListener('abort', onAbort); }
}
