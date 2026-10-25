import {test} from 'node:test';
import assert from 'node:assert/strict';
import {maintenanceReason,INTERRUPTED_AFTER_MS,requestAccountDeletion} from './scout-maintenance.ts';
const now=Date.parse('2026-10-25T12:00:00.000Z');
const record={createdAt:new Date(now-INTERRUPTED_AFTER_MS).toISOString(),status:'capturing'};
test('maintenance uses a writer expiry fence and never invents a retention policy',()=>{
 assert.equal(maintenanceReason(record,now),'interrupted');
 assert.equal(maintenanceReason(record,now-1),null);
 assert.equal(maintenanceReason({...record,status:'complete'},now),null);
 assert.equal(maintenanceReason({...record,status:'complete',createdAt:'2026-01-01T00:00:00Z'},now,30),'retention');
 for(const createdAt of ['bad-date',null,new Date(now+1).toISOString()])assert.equal(maintenanceReason({...record,createdAt},now,30),null);
 for(const retention of [0,-1,366,NaN,1.5])assert.equal(maintenanceReason({...record,status:'complete'},now,retention),null);
});
test('account deletion requires a fresh authentication event before any database call',async()=>{
 for(const time of [undefined,NaN,Infinity,(now-300001)/1000,(now+60001)/1000]) {
  await assert.rejects(requestAccountDeletion({},'fictional-owner',time,now),{status:401});
 }
});
