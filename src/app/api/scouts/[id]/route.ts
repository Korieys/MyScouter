import { requireScout } from '@/lib/scout-server';
import { errorResponse, publicScout } from '@/lib/scout-access';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await context.params;
        const { record } = await requireScout(request, id);
        return Response.json(publicScout(record), { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) { return errorResponse(error); }
}
