import type { User } from 'firebase/auth';
import { authFetch, jsonResult } from './auth-fetch';

const INCOMPLETE = 'The download was incomplete or damaged. Please retry.';

export async function loadPrivateDownload(user: User, scoutId: string, filename: string | undefined, signal: AbortSignal): Promise<Blob> {
    const deadline = AbortSignal.timeout(60_000);
    const combined = AbortSignal.any([signal, deadline]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
        onAbort = () => {
            void reader?.cancel().catch(() => {});
            reject(new Error(deadline.aborted ? 'The download took too long. Please retry.' : 'Download cancelled.'));
        };
        combined.addEventListener('abort', onAbort, {once:true});
        if (combined.aborted) onAbort();
    });
    const load = async () => {
        combined.throwIfAborted();
        const response = filename
            ? await authFetch(user, `/api/assets/${encodeURIComponent(scoutId)}/${encodeURIComponent(filename)}`, {signal:combined})
            : await authFetch(user, '/api/bundle', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scoutId}), signal:combined});
        combined.throwIfAborted();
        if (!response.ok) { await jsonResult(response); throw new Error('Download failed. Please retry.'); }
        const type = filename ? 'image/png' : 'application/zip';
        const sizeText = response.headers.get('x-download-bytes') || '';
        const size = Number(sizeText);
        const expectedHash = response.headers.get('x-download-sha256') || '';
        // ZIP framing adds a small overhead to the server's 128 MiB asset cap.
        const maxSize = (filename ? 20 : 129) * 1024 * 1024;
        if (response.headers.get('content-type')?.split(';')[0].trim() !== type || !response.body ||
            !/^[1-9][0-9]*$/.test(sizeText) || !Number.isSafeInteger(size) || size > maxSize || !/^[a-f0-9]{64}$/.test(expectedHash)) {
            void response.body?.cancel().catch(() => {});
            throw new Error(INCOMPLETE);
        }
        reader = response.body.getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let received = 0;
        try {
            while (true) {
                const {done,value} = await reader.read();
                combined.throwIfAborted();
                if (done) break;
                received += value.length;
                if (received > size || received > maxSize) throw new Error(INCOMPLETE);
                chunks.push(new Uint8Array(value));
            }
            if (received !== size) throw new Error(INCOMPLETE);
            const blob = new Blob(chunks, {type});
            chunks.length = 0;
            const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
            combined.throwIfAborted();
            const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,'0')).join('');
            if (hash !== expectedHash) throw new Error(INCOMPLETE);
            return blob;
        } finally {
            void reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    };
    try { return await Promise.race([load(), aborted]); }
    catch (error) {
        if (combined.aborted) throw new Error(deadline.aborted ? 'The download took too long. Please retry.' : 'Download cancelled.');
        throw error;
    }
    finally { combined.removeEventListener('abort', onAbort); }
}

export function savePrivateDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    try {
        anchor.href = url; anchor.download = filename;
        document.body.appendChild(anchor); anchor.click();
    } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url),60_000);
    }
}
