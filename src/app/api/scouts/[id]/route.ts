import { requireScout, requireUser } from '@/lib/scout-server';
import { errorResponse, publicScout } from '@/lib/scout-access';
import {getAdmin} from '@/lib/firebase-admin';
import {removeScout} from '@/lib/scout-deletion';
export const maxDuration=60;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await context.params;
        const { record } = await requireScout(request, id);
        return Response.json(publicScout(record), { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) { return errorResponse(error); }
}

export async function DELETE(request:Request, context:{params:Promise<{id:string}>}) {
    try {
        const uid=await requireUser(request);
        const {id}=await context.params;
        const {db,bucket}=getAdmin();
        await removeScout(db,bucket,uid,id);
        return Response.json({deleted:true},{headers:{'Cache-Control':'private, no-store'}});
    } catch(error){return errorResponse(error,'Deletion could not be confirmed. Refresh your history before retrying.');}
}
