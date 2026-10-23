import { getAdmin } from '@/lib/firebase-admin';
import { requireUser, SCOUT_COLLECTION } from '@/lib/scout-server';
import { errorResponse } from '@/lib/scout-access';
export async function GET(request: Request) {
    try {
        const uid = await requireUser(request);
        const snapshot = await getAdmin().db.collection(SCOUT_COLLECTION).where('userId', '==', uid).orderBy('createdAt', 'desc').limit(20).get();
        const scouts = snapshot.docs.map(doc => {
            const { id, url, domain, brandColor, status, createdAt, devices, pages } = doc.data();
            return { id, url, domain, brandColor, status, createdAt, devices, pages: pages.map((page: {url: string; title: string}) => ({url: page.url, title: page.title})) };
        });
        return Response.json({ scouts }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) { return errorResponse(error, 'Your scout history could not load. Please try again.'); }
}
