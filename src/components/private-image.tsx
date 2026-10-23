'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/lib/auth-context';
import { authFetch } from '@/lib/auth-fetch';
export function PrivateImage({scoutId, filename, alt, style}: {scoutId:string; filename:string; alt:string; style?:CSSProperties}) {
    const { user } = useAuth();
    const key = `${user?.uid}:${scoutId}:${filename}`;
    const [image, setImage] = useState<{key:string; url:string} | null>(null);
    const [failedKey, setFailedKey] = useState('');
    useEffect(() => {
        if (!user) return;
        const controller = new AbortController(); let objectUrl = '';
        void (async () => {
            try {
                const response = await authFetch(user, `/api/assets/${encodeURIComponent(scoutId)}/${encodeURIComponent(filename)}`, {signal:controller.signal});
                if (!response.ok) throw new Error('Image unavailable');
                const blob = await response.blob();
                if (controller.signal.aborted) return;
                objectUrl = URL.createObjectURL(blob); setImage({key, url:objectUrl});
            } catch { if (!controller.signal.aborted) setFailedKey(key); }
        })();
        return () => {controller.abort(); if(objectUrl) URL.revokeObjectURL(objectUrl);};
    },[user, scoutId, filename, key]);
    if (!user) return null;
    if (failedKey === key) return <p role="status">Image unavailable. Refresh this pack to try again.</p>;
    if (image?.key !== key) return <div role="status" style={{minHeight:100}}>Loading {alt.toLowerCase()}…</div>;
    // Authenticated blobs cannot be loaded through the public image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image.url} alt={alt} style={style} />;
}
