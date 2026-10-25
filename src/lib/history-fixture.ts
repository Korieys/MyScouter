import {createHash} from 'node:crypto';
import type {Firestore} from 'firebase-admin/firestore';
import {ScoutError,validScoutId,type ScoutRecord} from './scout-access';
import plan from '../../history-fixture-manifest.json';
export const HISTORY_FIXTURE=plan;
export type FixturePlan=typeof plan;
const COLLECTION='privateScouts',MARKERS='privateScoutReadiness';
export function assertFixtureOwner(uid:string,fixture:FixturePlan=plan) {
 if(createHash('sha256').update(uid).digest('hex')!==fixture.ownerScopeHash)throw new ScoutError(403,'This fixture is not approved for this account.');
}
export function fixtureRecords(uid:string,fixture:FixturePlan=plan) {
 assertFixtureOwner(uid,fixture);
 if(fixture.scoutIds.length!==45||new Set(fixture.scoutIds).size!==45||!Number.isFinite(Date.parse(fixture.createdAt)))throw new Error('Invalid fixture manifest');
 return fixture.scoutIds.map((value,index)=>{
  const id=validScoutId(value),domain='paging-fixture-'+String(index+1).padStart(2,'0')+'.example.invalid';
  const record:ScoutRecord&{readinessFixtureGroup:string}={id,userId:uid,url:'https://'+domain,domain,brandColor:'#2D4A22',pages:[],textContent:'',devices:['desktop'],enhancedAssets:[],copy:null,
   createdAt:new Date(Date.parse(fixture.createdAt)+index*60_000).toISOString(),status:'failed',readinessFixtureGroup:fixture.group,
   progress:{step:'error',detail:'Fictional paging fixture. No capture was performed.',progress:-1,timestamp:Date.parse(fixture.createdAt)}};
  return record;
 });
}
function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
 return value;
}
export async function applyHistoryFixture(db:Firestore,uid:string,action:'seed'|'remove',fixture:FixturePlan=plan) {
 const records=fixtureRecords(uid,fixture),marker=db.collection(MARKERS).doc(fixture.group),refs=records.map(record=>db.collection(COLLECTION).doc(record.id));
 return db.runTransaction(async transaction=>{
  const snapshots=await transaction.getAll(marker,...refs),state=snapshots[0].data();
  if(state&&state.ownerScopeHash!==fixture.ownerScopeHash)throw new ScoutError(409,'Fixture ownership changed. Stop and review.');
  const same=(index:number)=>JSON.stringify(canonical(snapshots[index+1].data()))===JSON.stringify(canonical(records[index]));
  if(action==='seed') {
   if(state?.state==='removed')throw new ScoutError(410,'This fixture window has already been cleaned up.');
   if(state?.state==='seeded') {
    if(!records.every((_record,index)=>same(index)))throw new ScoutError(409,'Fixture records changed. Stop and review.');
    return {state:'seeded',count:45,created:false};
   }
   if(state||snapshots.slice(1).some(snapshot=>snapshot.exists))throw new ScoutError(409,'A planned ID already exists. No fixture was created.');
   for(let index=0;index<records.length;index++)transaction.create(refs[index],records[index]);
   transaction.create(marker,{state:'seeded',ownerScopeHash:fixture.ownerScopeHash,group:fixture.group});
   return {state:'seeded',count:45,created:true};
  }
  if(state?.state==='removed')return {state:'removed',count:0,removed:0};
  if(state?.state!=='seeded')throw new ScoutError(409,'No matching seeded fixture exists.');
  if(snapshots.slice(1).some((snapshot,index)=>snapshot.exists&&!same(index)))throw new ScoutError(409,'A fixture record changed. No record was removed.');
  let removed=0;for(let index=0;index<refs.length;index++)if(snapshots[index+1].exists){transaction.delete(refs[index]);removed++;}
  transaction.set(marker,{state:'removed',ownerScopeHash:fixture.ownerScopeHash,group:fixture.group});
  return {state:'removed',count:0,removed};
 });
}
export async function historyFixtureStatus(db:Firestore,uid:string) {
 assertFixtureOwner(uid);
 return (await db.collection(MARKERS).doc(plan.group).get()).data()?.state||'not_started';
}
