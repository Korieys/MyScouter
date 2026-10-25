import {getAdmin} from '@/lib/firebase-admin';
import {requireUser} from '@/lib/scout-server';
import {errorResponse,readInput,ScoutError} from '@/lib/scout-access';
import {HISTORY_FIXTURE,applyHistoryFixture,assertFixtureOwner,historyFixtureStatus} from '@/lib/history-fixture';
export const dynamic='force-dynamic';
export const maxDuration=30;
async function access(request:Request) {
 if(process.env.VERCEL_ENV!=='preview')throw new ScoutError(404,'Unavailable.');
 const uid=await requireUser(request);assertFixtureOwner(uid);
 if(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!==HISTORY_FIXTURE.projectId)throw new ScoutError(503,'Fixture project mismatch.');
 if(Date.now()>=Date.parse(HISTORY_FIXTURE.expiresAt))throw new ScoutError(410,'The approved fixture window has expired.');
 return uid;
}
export async function GET(request:Request) {
 try {const uid=await access(request);return Response.json({enabled:process.env.READINESS_HISTORY_FIXTURES_ENABLED==='true',state:await historyFixtureStatus(getAdmin().db,uid),count:45,group:HISTORY_FIXTURE.group,expiresAt:HISTORY_FIXTURE.expiresAt},{headers:{'Cache-Control':'private, no-store'}});}
 catch(error){return errorResponse(error);}
}
export async function POST(request:Request) {
 try {
  const uid=await access(request);
  if(process.env.READINESS_HISTORY_FIXTURES_ENABLED!=='true')throw new ScoutError(503,'The fixture window is disabled. No records were changed.');
  const input=await readInput(request),action=input.action;
  if(action!=='seed'&&action!=='remove')throw new ScoutError(400,'Invalid fixture action.');
  if(input.confirmation!==(action==='seed'?'CREATE 45 FIXTURES':'REMOVE 45 FIXTURES'))throw new ScoutError(400,'Enter the exact fixture confirmation.');
  return Response.json(await applyHistoryFixture(getAdmin().db,uid,action),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return errorResponse(error);}
}
