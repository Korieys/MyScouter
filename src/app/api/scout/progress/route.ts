import { requireScout } from '@/lib/scout-server';
import { errorResponse } from '@/lib/scout-access';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
    try {
        const { record } = await requireScout(request, new URL(request.url).searchParams.get('jobId'));
        return Response.json({ progress: record.progress ?? null }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) { return errorResponse(error); }
}
