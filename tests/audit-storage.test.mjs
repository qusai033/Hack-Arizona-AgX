import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAuditLog, AUDIT_PREFIX as prefix, persistenceWarning} from '../frontend/audit-storage.js';
import {readAuditRecord} from '../frontend/audit-validation.js';
import {auditCSV} from '../frontend/audit.js';
import {simulateWeather} from '../frontend/weather.js';
import {getProfile} from '../frontend/engine/index.js';

const snapshot=()=>simulateWeather('trap');
const action=id=>({event_id:id,event_type:'MANUAL_SNAPSHOT_RECORDED',recorded_at:'2026-11-15T20:00:00.000Z'});
function fixture(){
  const map=new Map();
  const storage={get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)??null,
    setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  return {map,storage};
}
test('unavailable storage gives an explicit result and retains exportable activity',()=>{
  const log=createAuditLog(null),result=log.write(snapshot(),{action:action('memory')});
  assert.equal(result.saved,false);assert.equal(result.persistent,false);
  assert.deepEqual(result.issues.map(i=>i.code),['STORAGE_UNAVAILABLE']);
  assert.equal(log.read().unsaved_count,1);
  assert.match(auditCSV(log.list(),'UTC'),/memory/);
  assert.match(persistenceWarning(log.status()),/export CSV before closing/);
});
test('read denial preserves already recovered and new in-memory activity',()=>{
  const {storage}=fixture();
  createAuditLog(storage).append(snapshot(),{action:action('saved')});
  const log=createAuditLog(storage);assert.equal(log.read().records.length,1);
  storage.getItem=()=>{throw new Error('access denied');};
  assert.equal(log.read().records.length,1);
  const result=log.write(snapshot(),{action:action('new')});
  assert.equal(result.saved,false);
  assert.ok(result.issues.some(i=>i.code==='READ_FAILED'));
  assert.deepEqual(log.list().map(r=>r.id),['saved','new']);
  assert.match(auditCSV(log.list(),'UTC'),/saved/);
});
test('partial recovery keeps good records and leaves damaged or unknown records untouched',()=>{
  const {storage,map}=fixture();
  const good=createAuditLog(storage).append(snapshot(),{action:action('good')});
  map.set(prefix+'json','{broken');
  map.set(prefix+'future',JSON.stringify({...good,id:'future',event_id:'future',schema_version:99}));
  map.set(prefix+'session',JSON.stringify({...good,id:'session',event_id:'session',session:{state:'SPRAYING_IN_PROGRESS'}}));
  map.set(prefix+'sequence',JSON.stringify({...good,id:'sequence',event_id:'sequence',sequence_number:'bad'}));
  const before=[...map];
  const restored=createAuditLog(storage).read();
  assert.deepEqual(restored.records.map(r=>r.id),['good']);
  assert.equal(restored.issues.filter(i=>i.code==='MALFORMED_RECORD').length,3);
  assert.equal(restored.issues.filter(i=>i.code==='INCOMPATIBLE_RECORD').length,1);
  assert.deepEqual([...map],before);
  assert.match(persistenceWarning(restored),/Only readable activity was recovered/);
});
test('known abbreviated legacy treatment is readable with an explicit missing-context warning',()=>{
  const {storage,map}=fixture();
  const old=createAuditLog(null).append(snapshot(),{action:action('legacy')});
  delete old.schema_version;delete old.evidence;
  old.session={state:'POST_SPRAY_CURING',pesticide_profile:getProfile('volatile_formulation')};
  map.set(prefix+old.id,JSON.stringify(old));
  const restored=createAuditLog(storage).read();
  assert.equal(restored.records.length,1);
  assert.equal(restored.records[0].session.started_at,undefined);
  assert.equal(restored.issues[0].code,'LEGACY_CONTEXT_UNAVAILABLE');
  assert.match(auditCSV(restored.records,'UTC'),/Volatile/);
  assert.throws(()=>createAuditLog(storage).append(snapshot(),{session:old.session}),/session fields/i);
});
for(const [name,code] of [['QuotaExceededError','QUOTA_EXCEEDED'],['SecurityError','WRITE_FAILED']]){
  test(`${name} reports failed persistence while retaining immutable exportable evidence`,()=>{
    const {storage}=fixture();storage.setItem=()=>{throw Object.assign(new Error('blocked'),{name});};
    const log=createAuditLog(storage),input=snapshot();
    const result=log.write(input,{action:action('unsaved')});
    input.orchard_block='Changed';
    assert.equal(result.saved,false);assert.ok(result.issues.some(i=>i.code===code));
    assert.equal(log.list().length,1);assert.notEqual(log.list()[0].snapshot.orchard_block,'Changed');
    assert.match(auditCSV(log.list(),'UTC'),/INVERSION_DETECTED/);
  });
}
test('bad stored identity cannot be overwritten by an intentional event with the same ID',()=>{
  const {storage,map}=fixture();map.set(prefix+'occupied','{bad');
  assert.throws(()=>createAuditLog(storage).append(snapshot(),{action:action('occupied')}),/Duplicate/);
  assert.equal(map.get(prefix+'occupied'),'{bad');
});
test('full v2 envelope validation rejects malformed context, times, thresholds, diagnostics, and provenance',()=>{
  const {storage,map}=fixture();
  const saved=createAuditLog(storage).append(snapshot(),{source:'demo',action:action('versioned')});
  assert.deepEqual(createAuditLog(storage).list(),[saved]);
  const corruptions=[
    row=>{row.evidence.evaluation_context.maxAgeMs=10;},
    row=>{row.evidence.evaluation_context.labelProhibitsInversion='false';},
    row=>{row.evidence.evaluation_context.session={state:'SPRAYING_IN_PROGRESS'};},
    row=>{row.evidence.effective_thresholds.maxWind='ten';},
    row=>{row.evidence.diagnostics.thresholds.maxWind=123;},
    row=>{row.evidence.diagnostics.wet_bulb.ground_5ft=null;},
    row=>{row.evidence.times.simulation_clock_at=null;},
    row=>{row.evidence.provenance={issued_at:'not a time'};},
    row=>{row.evidence.effective_profile.name='Another profile';}
  ];
  for(const corrupt of corruptions){
    const row=structuredClone(saved);corrupt(row);
    assert.throws(()=>readAuditRecord(row));
    map.set(prefix+'versioned',JSON.stringify(row));
    const result=createAuditLog(storage).read();
    assert.equal(result.records.length,0);assert.equal(result.issues[0].code,'MALFORMED_RECORD');
  }
  // A schema-compatible historical engine version is not relabeled or recomputed.
  saved.evidence.engine_version='historical-engine';saved.evidence.diagnostics.engine_version='historical-engine';
  map.set(prefix+'versioned',JSON.stringify(saved));
  assert.deepEqual(createAuditLog(storage).list(),[saved]);
});
test('cross-tab additions and removals remain visible without dropping unsaved local rows',()=>{
  const {storage}=fixture(),a=createAuditLog(storage),b=createAuditLog(storage);
  a.append(snapshot(),{action:action('shared')});assert.equal(b.list().length,1);
  storage.removeItem(prefix+'shared');assert.equal(b.list().length,0);
  storage.setItem=()=>{throw new Error('denied');};
  b.append(snapshot(),{action:action('local')});assert.equal(b.list().length,1);
});
test('reset removes only explicit current-run demo records and preserves every other source',()=>{
  const {storage,map}=fixture(),log=createAuditLog(storage);
  for(const [id,source,run] of [['own','demo','run-a'],['other','demo','run-b'],['legacy','demo'],
    ['live','live'],['import','imported'],['forecast','forecast']]){
    log.append(snapshot(),{action:action(id),source,...(run?{demo_run_id:run}:{})});
  }
  map.set('unrelated-preference','keep');
  assert.match(auditCSV(log.list(),'UTC'),/Demo run ID/);
  assert.match(auditCSV(log.list(),'UTC'),/"run-a"\r\n/);
  assert.deepEqual(log.resetDemoRun('run-a').removed,['own']);
  assert.deepEqual(createAuditLog(storage).list().map(r=>r.id),['other','legacy','live','import','forecast']);
  assert.equal(map.get('unrelated-preference'),'keep');
  assert.throws(()=>log.resetDemoRun(''),/explicit demo/);
});
test('failed demo removal is disclosed, while reset remains usable in memory',()=>{
  const {storage}=fixture(),log=createAuditLog(storage);
  log.append(snapshot(),{action:action('old'),source:'demo',demo_run_id:'run-a'});
  storage.removeItem=()=>{throw new Error('denied');};
  const result=log.resetDemoRun('run-a');
  assert.deepEqual(log.list(),[]);assert.equal(result.issues[0].code,'REMOVE_FAILED');
  assert.equal(createAuditLog(storage).list().length,1);
  assert.match(persistenceWarning(result),/may return after reload/);
});
