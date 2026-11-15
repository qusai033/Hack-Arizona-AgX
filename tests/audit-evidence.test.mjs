import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuditLog, auditCSV } from '../frontend/audit.js';
import { createDemoState, reduceDemoState, AFTERNOON_REPLAY_TIME } from '../frontend/demo-controller.js';
import { createEvent } from '../frontend/events.js';
import { simulateWeather } from '../frontend/weather.js';
import { analyze, assertSession, ENGINE_VERSION, getProfile, thresholdsFor } from '../frontend/engine/index.js';

function makeStorage() {
  const map=new Map();
  return {map,storage:{get length(){return map.size;},
    key:i=>[...map.keys()][i],getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)}};
}
const action=(id,type='FRAME_SELECTED',payload={minute:135})=>
  createEvent(type,payload,{id:()=>id,now:()=> '2026-11-15T20:00:23.000Z'});

test('judge afternoon replay stores full treatment, effective thresholds, version and distinct times',()=>{
  const {storage}=makeStorage();
  const initial=createDemoState({scenario:'afternoon',clock_iso:AFTERNOON_REPLAY_TIME});
  const event=action('replay-evidence');
  const state=reduceDemoState(initial,event);
  assertSession(state.session);
  assert.equal(state.session.state,'POST_SPRAY_CURING');
  assert.ok(state.session.started_at);
  assert.ok(state.session.ended_at);
  assert.equal(state.session.orchard_block,state.snapshot.orchard_block);
  assert.equal(typeof state.session.inversion_at_end_f,'number');
  assert.ok(state.snapshot.evaluation.triggered_rules.some(r=>r.code==='POST_SPRAY_VOLATILITY_ALERT'));
  const log=createAuditLog(storage);
  // Current demo results carry the evaluator's independent simulation clock:
  // replay must receive the original context, not infer it from action time.
  const row=log.append(state.snapshot,{source:'demo',session:state.session,action:event,
    evaluationContext:state.evaluationContext});
  assert.equal(row.schema_version,2);
  assert.equal(row.evidence.schema_version,2);
  assert.equal(row.evidence.engine_version,ENGINE_VERSION);
  assert.deepEqual(row.evidence.effective_thresholds,thresholdsFor(getProfile('volatile_formulation')));
  assert.deepEqual(row.evidence.evaluation_context.session,state.session);
  assert.equal(row.evidence.reproduced_with_current_engine,true);
  assert.deepEqual(analyze(row.snapshot,row.evidence.evaluation_context).evaluation,row.snapshot.evaluation);
  assert.equal(row.recorded_at,event.recorded_at);
  assert.equal(row.evidence.times.recorded_at,event.recorded_at);
  assert.equal(row.evidence.times.simulation_clock_at,row.snapshot.timestamp);
  assert.equal(row.evidence.times.evaluated_at,state.clock_iso);
  assert.notEqual(row.recorded_at,row.snapshot.timestamp);
  assert.deepEqual(createAuditLog(storage).get(event.event_id),row);
});

test('stored evidence is independent from later edits, reloads and profile changes',()=>{
  const {storage}=makeStorage();
  const log=createAuditLog(storage);
  const snapshot=structuredClone(simulateWeather('trap'));
  const prior=JSON.stringify(snapshot);
  const row=log.append(snapshot,{source:'demo',action:action('copy','MANUAL_SNAPSHOT_RECORDED',{})});
  snapshot.readings.ground_5ft.temp_f=100;
  snapshot.pesticide_profile.name='Changed after append';
  row.evidence.effective_thresholds.maxWind=999;
  row.evidence.evaluation_context.labelProhibitsInversion=true;
  const reread=createAuditLog(storage).list()[0];
  assert.equal(JSON.stringify(reread.snapshot),prior);
  assert.equal(reread.evidence.effective_thresholds.maxWind,10);
  assert.deepEqual(reread.evidence.evaluation_context,{});
  assert.equal(reread.evidence.engine_version,ENGINE_VERSION);
});

test('legacy records are readable with explicitly unavailable provenance, never fabricated',()=>{
  const {storage,map}=makeStorage();
  const legacy={id:'legacy',recorded_at:'2026-11-15T18:00:23.000Z',
    source:'demo',event:'old',snapshot:simulateWeather('afternoon',135),
    session:{state:'POST_SPRAY_CURING',pesticide_profile:getProfile('volatile_formulation')}};
  map.set('canopyguard.audit.v1.legacy',JSON.stringify(legacy));
  const log=createAuditLog(storage);
  const row=log.list()[0];
  assert.equal(row.schema_version,1);
  assert.equal(row.evidence,null);
  assert.deepEqual(row.session,legacy.session);
  assert.equal(log.get('legacy').evidence,null);
});

test('unknown external evaluator is never attributed to built-in rules',()=>{
  const row=createAuditLog(null,{id:()=> 'import'}).append(simulateWeather('clear'),{
    source:'imported',provenance:{source_file:'user-supplied JSON'}
  });
  assert.equal(row.evidence.evaluator_kind,'external_or_unverified');
  assert.equal(row.evidence.engine_version,null);
  assert.equal(row.evidence.effective_thresholds,null);
  assert.equal(row.evidence.reproduced_with_current_engine,false);
  assert.equal(row.evidence.times.snapshot_time_role,'imported_observation');
  assert.equal(row.evidence.times.evaluated_at,null);
  assert.equal(row.evidence.provenance.source_file,'user-supplied JSON');
});

test('missing treatment fields and non-reproducible built-in results cannot be recorded as valid v2 evidence',()=>{
  const log=createAuditLog(null,{id:()=> 'not-replayable'});
  assert.throws(()=>log.append(simulateWeather('afternoon',135),{source:'demo',
    session:{state:'POST_SPRAY_CURING',pesticide_profile:getProfile('volatile_formulation')}}),/session fields/i);
  const edited=simulateWeather('trap');
  edited.evaluation.headline_reason='Changed evaluation with no corresponding model context.';
  assert.throws(()=>log.append(edited,{source:'demo'}),/does not match/i);
});

test('PCA CSV exports the versioned audit evidence envelope as machine-readable columns',()=>{
  const row=createAuditLog(null,{id:()=> 'csv'}).append(simulateWeather('trap'),{source:'demo'});
  const csv=auditCSV([row],'America/Los_Angeles');
  assert.match(csv,/INVERSION_DETECTED/);
  assert.match(csv,/"Engine version"/);
  assert.match(csv,/"Effective thresholds JSON"/);
  assert.match(csv,/"Effective profile JSON"/);
  assert.match(csv,/"Snapshot JSON"/);
  assert.match(csv,/"Evaluation JSON"/);
  assert.match(csv,/"Evaluation context JSON"/);
  assert.match(csv,/"Timestamp evidence JSON"/);
  assert.ok(csv.includes(row.evidence.engine_version));
});
