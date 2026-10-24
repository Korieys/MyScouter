import { getAdmin } from '@/lib/firebase-admin';
import { requireUser } from '@/lib/scout-server';
import { errorResponse } from '@/lib/scout-access';
import { readScoutHistory } from '@/lib/scout-history';
export async function GET(request: Request) {
    try {
        const uid = await requireUser(request);
        const cursor = new URL(request.url).searchParams.get('cursor');
        const result = await readScoutHistory(getAdmin().db, uid, cursor);
        return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) { return errorResponse(error, 'Your scout history could not load. Please try again.'); }
}
