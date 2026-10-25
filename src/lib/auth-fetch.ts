import type { User } from 'firebase/auth';
export async function authFetch(user: User | null, path: string, options: RequestInit = {}) {
    if (!user) throw new Error('Sign in to continue.');
    if (!path.startsWith('/api/') || path.includes('\\') || path.includes('#')) throw new Error('Invalid request path.');
    options.signal?.throwIfAborted();
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
    options.signal?.throwIfAborted();
    return fetch(path, {...options, headers, cache:'no-store', redirect:'error'});
}
export async function jsonResult(response: Response) {
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new Error(result?.error || 'This request could not finish. Please try again.');
    return result;
}
