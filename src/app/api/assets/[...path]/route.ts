import { readAsset, requireScout } from '@/lib/scout-server';
import { errorResponse, ScoutError } from '@/lib/scout-access';
import { privateBinary } from '@/lib/private-binary';
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
    try {
        const { path } = await context.params;
        if (path.length !== 2) throw new ScoutError(404, 'Asset not found.');
        const { record } = await requireScout(request, path[0]);
        const buffer = await readAsset(record, path[1]);
        return privateBinary(buffer, {'Content-Type': 'image/png'});
    } catch (error) { return errorResponse(error); }
}
