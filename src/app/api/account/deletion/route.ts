import {getAdmin} from '@/lib/firebase-admin';
import {readInput, errorResponse, ScoutError, verifiedUser} from '@/lib/scout-access';
import {requestAccountDeletion} from '@/lib/scout-maintenance';
export const dynamic='force-dynamic';
export const maxDuration=30;
export async function POST(request:Request) {
    try {
        let authTime:unknown;
        const uid=await verifiedUser(request,async(token,revoked)=>{
            const identity=await getAdmin().auth.verifyIdToken(token,revoked);
            authTime=identity.auth_time;return identity;
        });
        const input=await readInput(request);
        if(input.confirmation!=='DELETE ACCOUNT')throw new ScoutError(400,'Type DELETE ACCOUNT to confirm.');
        // Publishing source does not provision a privileged deletion worker or
        // promise a background job that has not been deployed and monitored.
        if(process.env.ACCOUNT_DELETION_ENABLED!=='true')throw new ScoutError(503,'Account deletion is not enabled in this preview. No deletion request was started.');
        await requestAccountDeletion(getAdmin().db,uid,authTime);
        return Response.json({state:'deleting',message:'Account deletion requested. Access is blocked while the operator worker removes saved packs and closes the account.'},{status:202,headers:{'Cache-Control':'private, no-store'}});
    } catch(error) {return errorResponse(error);}
}
