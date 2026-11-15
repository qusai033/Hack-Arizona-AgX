import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAuditLog,filterRecords,auditCSV,alertText} from '../frontend/audit.js';
import {simulateWeather} from '../frontend/weather.js';
import {createEvent} from '../frontend/events.js';

const store=new Map();
const storage={get length(){return store.size;},key:i=>[...store.keys()][i],getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
test('audit snapshots are copied, append-only through API, and reload from storage',()=>{
  store.clear();
  let id=0;
  const log=createAuditLog(storage,{id:()=>String(++id),clock:()=>new Date('2026-11-15T18:00:23Z')});
  const original=simulateWeather('trap');
  const entry=log.append(original,{source:'demo',event:'scenario selected'});
  entry.snapshot.readings.ground_5ft.temp_f=170;
  original.orchard_block='Changed';
  log.append(simulateWeather('clear'),{source:'demo'});
  const rows=createAuditLog(storage).list();
  assert.equal(rows.length,2);
  assert.equal(rows[0].snapshot.readings.ground_5ft.temp_f,64);
  assert.equal(rows[0].recorded_at,'2026-11-15T18:00:23.000Z');
  assert.equal(filterRecords(rows,'hidden').length,1);
  assert.equal(filterRecords(rows,'inversion').length,1);
  assert.equal(filterRecords(rows,'stop').length,1);
  assert.throws(()=>createAuditLog(storage,{id:()=> '1'}).append(original),/Duplicate/);
});
test('CSV carries evidence and escapes spreadsheet formulas and quotes',()=>{
  const snapshot=simulateWeather('trap');
  snapshot.orchard_block='=Example("x")';
  const row=createAuditLog(null,{id:()=> 'check'}).append(snapshot);
  const csv=auditCSV([row],'America/Phoenix');
  assert.ok(csv.includes('"\'=Example(""x"")"'));
  assert.match(csv,/INVERSION_DETECTED/);
  assert.match(csv,/America\/Phoenix/);
  assert.ok(csv.includes('"true"'));
  assert.ok(csv.includes('"Snapshot JSON"'));
  assert.match(csv,/\r\n$/);
});
test('post-spray alert uses treatment rule and observation telemetry',()=>{
  const row={snapshot:simulateWeather('afternoon',135)};
  const alert=alertText(row);
  assert.match(alert.title,/POST-SPRAY VOLATILITY ALERT/);
  assert.match(alert.body,/\+3\.80/);
});

test('explicit event identity is idempotent in memory and after storage reload',()=>{
  store.clear();
  const action=createEvent('MANUAL_SNAPSHOT_RECORDED',{}, {
    id:()=> 'stable-event', now:()=> '2026-11-15T18:00:23.000Z'
  });
  const snapshot=simulateWeather('trap');
  const log=createAuditLog(storage);
  const first=log.append(snapshot,{action,source:'demo'});
  assert.equal(first.event_id,action.event_id);
  assert.equal(first.recorded_at,action.recorded_at);
  assert.deepEqual(log.append(snapshot,{action}),first);
  const reopened=createAuditLog(storage);
  assert.deepEqual(reopened.append(simulateWeather('clear'),{action}),first);
  assert.equal(reopened.list().length,1);
});

test('different actions with identical results are all stored in stable same-time order',()=>{
  store.clear();
  const log=createAuditLog(storage), snapshot=simulateWeather('trap');
  for(const id of ['z','a','y','b']){
    const action=createEvent('MANUAL_SNAPSHOT_RECORDED',{}, {
      id:()=>id, now:()=> '2026-11-15T18:00:23.000Z'
    });
    log.append(snapshot,{action});
  }
  assert.deepEqual(log.list().map(row=>row.id),['z','a','y','b']);
  assert.deepEqual(createAuditLog(storage).list().map(row=>row.sequence_number),[1,2,3,4]);
});
