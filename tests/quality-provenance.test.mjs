import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,evaluate,evaluateSnapshot,ENGINE_VERSION} from '../frontend/engine/evaluate.js';
import {getProfile} from '../frontend/engine/profiles.js';
import {assessDataQuality} from '../frontend/engine/quality.js';
import {assertSnapshot} from '../frontend/contract.js';
import {createAuditLog} from '../frontend/audit-storage.js';
import {createEvent} from '../frontend/events.js';
import {auditCSV} from '../frontend/audit-csv.js';

const NOW=Date.parse('2026-11-15T20:00:00.000Z');
const reading=(temp_f=70,wind_speed_mph=5,humidity_pct=50,wind_dir_deg=0,wind_dir_cardinal='N')=>
  ({temp_f,humidity_pct,wind_speed_mph,wind_dir_deg,wind_dir_cardinal});
const fixture=()=>({
  timestamp:new Date(NOW).toISOString(),scenario_name:'Quality and rule provenance',
  orchard_block:'Block 4B',readings:{
    ground_5ft:reading(70),canopy_30ft:reading(69)
  },pesticide_profile:getProfile('contact_fungicide')
});
const find=(result,code)=>result.triggered_rules.find(rule=>rule.code===code);

test('SPEC-DATA and SPEC-RESULT: absent canopy temperature does not erase valid ground-only GO',()=>{
  const input=fixture();input.readings.canopy_30ft.temp_f=null;
  const {evaluation,diagnostics}=analyze(input,{nowMs:NOW,maxAgeMs:300000});
  assert.equal(evaluation.single_station_5ft_status,'GO');
  assert.equal(evaluation.multi_height_status,'STOP');
  assert.equal(evaluation.caught_hidden_risk,false);
  assert.equal(evaluation.data_quality.overall_status,'INVALID_OR_STALE');
  assert.equal(evaluation.data_quality.assessment,'STRUCTURE_AND_AGE');
  assert.equal(evaluation.data_quality.ground_5ft.status,'VALID');
  assert.equal(evaluation.data_quality.canopy_30ft.status,'INVALID');
  assert.equal(evaluation.data_quality.ground_5ft.age_ms,0);
  assert.deepEqual(diagnostics.data_quality,evaluation.data_quality);
  assert.deepEqual(evaluation.triggered_rules.map(r=>r.code),['DATA_INVALID']);
  assert.equal(evaluation.triggered_rules[0].provenance,'SAFETY_FAILSAFE');
  assert.deepEqual(evaluation.triggered_rules[0].source_heights,[30]);
  assert.equal(evaluation.triggered_rules[0].is_upper_or_cross_height_hazard,false);
});

test('independent ground comparison preserves true ground STOP/CAUTION while canopy is invalid',()=>{
  const calm=fixture();calm.readings.ground_5ft.wind_speed_mph=2;
  calm.readings.canopy_30ft.temp_f=null;
  assert.equal(evaluate(calm).single_station_5ft_status,'STOP');
  const hot=fixture();hot.readings.ground_5ft.temp_f=90;hot.readings.ground_5ft.humidity_pct=15;
  hot.readings.canopy_30ft.temp_f=null;
  assert.equal(evaluate(hot).single_station_5ft_status,'CAUTION');
  const lost=fixture();delete lost.readings.canopy_30ft;
  const result=evaluate(lost);
  assert.equal(result.single_station_5ft_status,'GO');
  assert.equal(result.multi_height_status,'STOP');
  assert.equal(result.caught_hidden_risk,false);
});

test('missing ground cannot produce ground GO even if 30 ft is complete',()=>{
  const input=fixture();input.readings.ground_5ft.wind_speed_mph=NaN;
  const result=evaluate(input);
  assert.equal(result.single_station_5ft_status,'STOP');
  assert.equal(result.multi_height_status,'STOP');
  assert.equal(result.data_quality.ground_5ft.status,'INVALID');
  assert.equal(result.data_quality.canopy_30ft.status,'VALID');
  assert.equal(result.caught_hidden_risk,false);
});

test('SPEC-PROVENANCE: source heights and rule basis distinguish ground, upper, cross-height and failsafe',()=>{
  const input=fixture();
  input.readings.ground_5ft.wind_speed_mph=2;
  input.readings.canopy_30ft.wind_speed_mph=12.4;
  input.readings.canopy_30ft.temp_f=74.5;
  input.readings.canopy_30ft.wind_dir_deg=90;
  input.readings.canopy_30ft.wind_dir_cardinal='E';
  const result=evaluate(input);
  assert.deepEqual(find(result,'GROUND_WIND_TOO_CALM').source_heights,[5]);
  assert.equal(find(result,'GROUND_WIND_TOO_CALM').is_upper_or_cross_height_hazard,false);
  assert.deepEqual(find(result,'UPPER_WIND_EXCEEDED').source_heights,[30]);
  assert.deepEqual(find(result,'INVERSION_DETECTED').source_heights,[5,30]);
  assert.deepEqual(find(result,'VERTICAL_WIND_SHEAR').source_heights,[5,30]);
  assert.deepEqual(find(result,'DIRECTIONAL_WIND_SHEAR').source_heights,[5,30]);
  for(const r of result.triggered_rules){
    assert.equal(r.provenance,'ILLUSTRATIVE_THRESHOLD');
    assert.equal(r.is_upper_or_cross_height_hazard,r.source_heights.includes(30));
    assert.match(r.explanation,/./);
  }
});

test('SPEC-ORDER: every STOP precedes every CAUTION with stable ordering within each severity',()=>{
  const input=fixture();input.readings.ground_5ft.temp_f=90;input.readings.ground_5ft.humidity_pct=15;
  input.readings.canopy_30ft.wind_speed_mph=12.4;
  input.readings.canopy_30ft.wind_dir_deg=90;
  input.readings.canopy_30ft.wind_dir_cardinal='E';
  const rules=evaluate(input).triggered_rules;
  assert.ok(rules.some(r=>r.severity==='CAUTION')&&rules.some(r=>r.severity==='STOP'));
  const lastStop=rules.map(r=>r.severity).lastIndexOf('STOP');
  const firstCaution=rules.findIndex(r=>r.severity==='CAUTION');
  assert.ok(lastStop<firstCaution);
});

test('hidden-risk credit requires valid upper/cross-height STOP, never failed data or ground-only STOP',()=>{
  const upper=fixture();upper.readings.canopy_30ft.wind_speed_mph=12.4;
  assert.equal(evaluate(upper).single_station_5ft_status,'GO');
  assert.equal(evaluate(upper).caught_hidden_risk,true);
  const both=structuredClone(upper);both.readings.ground_5ft.wind_speed_mph=2;
  assert.equal(evaluate(both).caught_hidden_risk,false);
  const bad=structuredClone(upper);bad.readings.canopy_30ft.temp_f=null;
  assert.equal(evaluate(bad).caught_hidden_risk,false);
  const noH=fixture();
  assert.equal(evaluate(noH).caught_hidden_risk,false);
});

test('per-height age uses explicit freshness nowMs; evaluator clock never backdates NWS forecasts',()=>{
  const input=fixture(),twoMin=2*60000;
  const e=evaluate(input,{nowMs:NOW+twoMin,evaluationTimeMs:NOW+twoMin});
  assert.equal(e.data_quality.overall_status,'VALID');
  assert.equal(e.data_quality.ground_5ft.age_ms,twoMin);
  assert.equal(e.data_quality.canopy_30ft.age_ms,twoMin);
  assert.equal(e.data_quality.evaluated_at,new Date(NOW+twoMin).toISOString());
  const stale=evaluate(input,{nowMs:NOW+300001});
  assert.equal(stale.multi_height_status,'STOP');
  assert.equal(stale.data_quality.ground_5ft.status,'STALE');
  assert.equal(stale.data_quality.canopy_30ft.status,'STALE');
  assert.equal(stale.caught_hidden_risk,false);
  const future=fixture();future.timestamp=new Date(NOW+24*3600000).toISOString();
  const modeled=evaluate(future,{evaluationTimeMs:NOW});
  assert.equal(modeled.data_quality.overall_status,'VALID');
  assert.equal(modeled.data_quality.assessment,'STRUCTURE_ONLY');
  assert.equal(modeled.data_quality.age_ms,null);
  assert.equal(modeled.data_quality.evaluated_at,new Date(NOW).toISOString());
  assert.equal(assessDataQuality(future,{nowMs:NOW}).overall_status,'INVALID_OR_STALE');
});

test('runtime contract accepts legacy snapshots and rejects fabricated provenance or hidden credit',()=>{
  const input=fixture(),actual=evaluateSnapshot(input,{evaluationTimeMs:NOW});
  assertSnapshot(actual);
  const legacy=structuredClone(actual);
  delete legacy.evaluation.data_quality;
  for(const rule of legacy.evaluation.triggered_rules) {
    delete rule.source_heights;delete rule.is_upper_or_cross_height_hazard;delete rule.provenance;
  }
  assertSnapshot(legacy);
  const tampered=structuredClone(actual);
  tampered.evaluation.caught_hidden_risk=true;
  assert.throws(()=>assertSnapshot(tampered),/caught_hidden_risk/);
  const upper=fixture();upper.readings.canopy_30ft.wind_speed_mph=12.4;
  const r=evaluateSnapshot(upper);
  r.evaluation.triggered_rules[0].is_upper_or_cross_height_hazard=false;
  assert.throws(()=>assertSnapshot(r),/classification|caught_hidden_risk/);
  assert.equal(ENGINE_VERSION,'1.1.0');
});

test('version-2 activity evidence freezes real quality metadata and source heights without rewriting old records',()=>{
  const input=fixture(),context={evaluationTimeMs:NOW};
  const snapshot=evaluateSnapshot(input,context),log=createAuditLog(null);
  const action=createEvent('MANUAL_SNAPSHOT_RECORDED',{},{
    id:()=> 'quality-row',now:()=> '2026-11-15T21:00:00.000Z'
  });
  const row=log.append(snapshot,{source:'demo',action,evaluationContext:context});
  assert.equal(row.evidence.engine_version,ENGINE_VERSION);
  assert.deepEqual(row.evidence.diagnostics.data_quality,snapshot.evaluation.data_quality);
  assert.equal(row.evidence.times.evaluated_at,new Date(NOW).toISOString());
  assert.equal(row.evidence.reproduced_with_current_engine,true);
  const csv=auditCSV([row],'America/Los_Angeles');
  assert.match(csv,/data_quality/);
  assert.match(csv,/1\.1\.0/);
  const old={...structuredClone(row),schema_version:1,evidence:null};
  delete old.snapshot.evaluation.data_quality;
  for(const rule of old.snapshot.evaluation.triggered_rules){
    delete rule.provenance;delete rule.source_heights;delete rule.is_upper_or_cross_height_hazard;
  }
  assertSnapshot(old.snapshot);
});
