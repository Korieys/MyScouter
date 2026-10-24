"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { User } from 'firebase/auth';
import { loadScoutHistory } from '@/lib/scout-history-client';
import type { ScoutHistoryEntry } from '@/lib/scout-history-types';

export function ScoutHistory({user}: {user: User}) {
    // Remounting on identity change discards the old account's rows and cursor immediately.
    return <AccountHistory key={user.uid} user={user} />;
}

function AccountHistory({user}: {user: User}) {
    const [scouts, setScouts] = useState<ScoutHistoryEntry[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const pending = useRef<AbortController | null>(null);
    const retryCursor = useRef<string | null>(null);

    const load = useCallback(async (cursor: string | null) => {
        if (pending.current) return;
        const controller = new AbortController();
        pending.current = controller; retryCursor.current = cursor;
        setBusy(true); setError('');
        try {
            const page = await loadScoutHistory(user, cursor, controller.signal);
            if (controller.signal.aborted) return;
            setScouts(previous => cursor ? [...new Map([...previous, ...page.scouts].map(scout => [scout.id, scout])).values()] : page.scouts);
            setNextCursor(page.nextCursor); setLoaded(true);
        } catch (reason) {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Your scout history could not load. Please try again.');
        } finally {
            if (pending.current === controller) {
                pending.current = null;
                if (!controller.signal.aborted) setBusy(false);
            }
        }
    }, [user]);

    useEffect(() => {
        void load(null);
        return () => { pending.current?.abort(); pending.current = null; };
    }, [load]);

    return (
        <section aria-labelledby="history-heading" aria-busy={busy}>
            <div className="history-heading">
                <h1 id="history-heading" className="heading-section">Scout History</h1>
                <button className="btn-outline" disabled={busy} onClick={() => void load(null)}>Refresh history</button>
            </div>
            <p className="history-summary" role="status">
                {busy ? (loaded ? 'Loading your scouts…' : 'Loading your history…') : loaded ? `${scouts.length} scout${scouts.length === 1 ? '' : 's'} shown${nextCursor ? ' · More available' : ''}` : ''}
            </p>
            {error && <div role="alert" className="patch-card history-error"><p>{error}</p><button className="btn-outline" onClick={() => void load(retryCursor.current)} disabled={busy}>Retry</button></div>}
            {loaded && scouts.length === 0 && <div className="patch-card history-empty"><p>No scouts yet</p><Link href="/scout" className="btn-campfire">Send Your First Scout</Link></div>}
            <div className="history-list">
                {scouts.map(scout => <article key={scout.id} className="patch-card history-card">
                    <div className="history-details">
                        <h2>{scout.domain}</h2><span className="merit-badge">{scout.status}</span>
                        <p>Scouted {new Date(scout.createdAt).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'})} · {scout.devices.join(', ') || 'Desktop'} · {scout.pages.length} page{scout.pages.length === 1 ? '' : 's'}</p>
                    </div>
                    <div className="history-actions"><Link className="btn-scout" href={`/preview/${scout.id}`} aria-label={`View pack for ${scout.domain}`}>View Pack</Link><Link className="btn-outline" href={`/scout?url=${encodeURIComponent(scout.url)}`} aria-label={`Re-scout ${scout.domain}`}>Re-Scout</Link></div>
                </article>)}
            </div>
            {nextCursor && <button className="btn-outline history-more" disabled={busy} onClick={() => void load(nextCursor)}>Load older scouts</button>}
            {loaded && scouts.length > 0 && !nextCursor && <p className="history-summary">You’ve reached the end of your saved scouts.</p>}
        </section>
    );
}
