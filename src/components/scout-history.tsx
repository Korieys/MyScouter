"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { User } from 'firebase/auth';
import { loadScoutHistory } from '@/lib/scout-history-client';
import type { ScoutHistoryEntry } from '@/lib/scout-history-types';
import {deleteScout} from '@/lib/scout-deletion-client';

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
    const [deleteTarget,setDeleteTarget]=useState<ScoutHistoryEntry|null>(null);
    const [confirmation,setConfirmation]=useState('');
    const [deleting,setDeleting]=useState(false);
    const [deleteError,setDeleteError]=useState('');
    const [deleteAttempted,setDeleteAttempted]=useState(false);
    const [notice,setNotice]=useState('');
    const pendingDelete=useRef<AbortController|null>(null);
    const deleteTrigger=useRef<HTMLButtonElement|null>(null);
    const confirmationInput=useRef<HTMLInputElement|null>(null);
    const refreshButton=useRef<HTMLButtonElement|null>(null);

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
    useEffect(()=>()=>{pendingDelete.current?.abort();},[]);
    useEffect(()=>{
        if(deleteTarget)confirmationInput.current?.focus();
        else if(notice)refreshButton.current?.focus();
        else deleteTrigger.current?.focus();
    },[deleteTarget,notice]);

    const cancelDeletion=()=>{
        if(pendingDelete.current)return;
        setDeleteTarget(null);setConfirmation('');setDeleteError('');
    };
    const remove=async()=>{
        if(!deleteTarget || confirmation!=='DELETE' || pendingDelete.current)return;
        const target=deleteTarget,controller=new AbortController();
        pendingDelete.current=controller;setDeleting(true);setDeleteAttempted(true);setDeleteError('');
        try {
            await deleteScout(user,target.id,controller.signal);
            if(controller.signal.aborted)return;
            setScouts(previous=>previous.filter(row=>row.id!==target.id));
            setDeleteTarget(null);setConfirmation('');setNotice(`The ${target.domain} pack was deleted.`);
        } catch(reason) {
            if(!controller.signal.aborted)setDeleteError(reason instanceof Error?reason.message:'Deletion could not be confirmed. Refresh your history.');
        } finally {
            if(pendingDelete.current===controller)pendingDelete.current=null;
            if(!controller.signal.aborted)setDeleting(false);
        }
    };

    return (
        <section aria-labelledby="history-heading" aria-busy={busy}>
            <div className="history-heading">
                <h1 id="history-heading" className="heading-section">Scout History</h1>
                <button ref={refreshButton} className="btn-outline" disabled={busy || !!deleteTarget} onClick={() => void load(null)}>Refresh history</button>
            </div>
            <p className="history-summary" role="status">
                {busy ? (loaded ? 'Loading your scouts…' : 'Loading your history…') : loaded ? `${scouts.length} scout${scouts.length === 1 ? '' : 's'} shown${nextCursor ? ' · More available' : ''}` : ''}
            </p>
            {notice && <p role="status">{notice}</p>}
            {error && <div role="alert" className="patch-card history-error"><p>{error}</p><button className="btn-outline" onClick={() => void load(retryCursor.current)} disabled={busy || !!deleteTarget}>Retry</button></div>}
            {loaded && scouts.length === 0 && <div className="patch-card history-empty"><p>No scouts yet</p><Link href="/scout" className="btn-campfire">Send Your First Scout</Link></div>}
            <div className="history-list">
                {scouts.map(scout => <article key={scout.id} className="patch-card history-card">
                    <div className="history-details">
                        <h2>{scout.domain}</h2><span className="merit-badge">{scout.status}</span>
                        <p>Scouted {new Date(scout.createdAt).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'})} · {scout.devices.join(', ') || 'Desktop'}{scout.status==='deleting'?' · Deletion needs to finish':` · ${scout.pages.length} page${scout.pages.length===1?'':'s'}`}</p>
                    </div>
                    <div className="history-actions">
                        {scout.status!=='deleting' && <Link className="btn-scout" href={`/preview/${scout.id}`} aria-label={`View pack for ${scout.domain}`}>View Pack</Link>}
                        <Link className="btn-outline" href={`/scout?url=${encodeURIComponent(scout.url)}`} aria-label={`Re-scout ${scout.domain}`}>Re-Scout</Link>
                        <button className="btn-outline" disabled={busy || !!deleteTarget} aria-label={`${scout.status==='deleting'?'Finish deleting':'Delete pack for'} ${scout.domain}`} onClick={event=>{deleteTrigger.current=event.currentTarget;setDeleteTarget(scout);setConfirmation('');setDeleteError('');setDeleteAttempted(scout.status==='deleting');setNotice('');}}>{scout.status==='deleting'?'Finish deleting':'Delete pack'}</button>
                    </div>
                    {deleteTarget?.id===scout.id && <div className="history-delete" role="group" aria-labelledby="delete-heading" onKeyDown={event=>{if(event.key==='Escape')cancelDeletion();}}>
                        <h3 id="delete-heading">Delete this {scout.domain} pack?</h3>
                        <p>This permanently removes its screenshots, mockups, saved website text and AI draft from MyScouter. It cannot be undone. Copies you already downloaded remain on your device.</p>
                        <label htmlFor="delete-confirmation">Type DELETE to confirm</label>
                        <input ref={confirmationInput} id="delete-confirmation" value={confirmation} maxLength={6} autoComplete="off" spellCheck={false} disabled={deleting} onChange={event=>setConfirmation(event.target.value)} />
                        <div className="history-actions"><button className="btn-outline" disabled={deleting} onClick={cancelDeletion}>{deleteAttempted?'Close':'Keep pack'}</button><button className="btn-outline history-delete-final" disabled={deleting || confirmation!=='DELETE'} onClick={()=>void remove()}>{deleting?'Deleting pack…':'Permanently delete pack'}</button></div>
                        {deleteAttempted && <p>Closing this panel does not undo a deletion that has already started.</p>}
                        {deleting && <p role="status">Removing the saved pack. If you leave this page, reopen history to check whether deletion finished.</p>}
                        {deleteError && <div role="alert"><p>{deleteError}</p><button className="btn-outline" onClick={()=>{cancelDeletion();void load(null);}}>Close and refresh history</button></div>}
                    </div>}
                </article>)}
            </div>
            {nextCursor && <button className="btn-outline history-more" disabled={busy || !!deleteTarget} onClick={() => void load(nextCursor)}>Load older scouts</button>}
            {loaded && scouts.length > 0 && !nextCursor && <p className="history-summary">You’ve reached the end of your saved scouts.</p>}
        </section>
    );
}
