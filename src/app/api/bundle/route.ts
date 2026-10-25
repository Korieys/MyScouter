import { buildBundle } from '@/lib/bundle';
import { readAsset, requireScout, requireUser } from '@/lib/scout-server';
import { errorResponse, readInput, recordedAssets } from '@/lib/scout-access';
import { privateBinary } from '@/lib/private-binary';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
    try {
        await requireUser(request);
        const { scoutId } = await readInput(request);
        const { record } = await requireScout(request, scoutId);
        const zip = await buildBundle(recordedAssets(record), (name, signal) => readAsset(record, name, signal));
        return privateBinary(zip, {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="myscouter-' + record.id + '.zip"',
        });
    } catch (error) { return errorResponse(error, 'We could not pack every asset. Please retry the download.'); }
}
