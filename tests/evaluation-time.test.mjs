import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoState,reduceDemoState,AFTERNOON_REPLAY_TIME} from '../frontend/demo-controller.js';
import {createEvent} from '../frontend/events.js';
import {createAuditLog} from '../frontend/audit-storage.js';
import {readAuditRecord} from '../frontend/audit-validation.js';
import {auditCSV} from '../frontend/audit-csv.js';
import {analyze,getProfile} from '../frontend/engine/index.js';
import {simulateWeather,loadOrchardForecast} from '../frontend/weather.js';
import {reevaluateForecastModel,currentForecastPeriod} from '../frontend/forecast-profile.js';

const minute=60000,hour=60*minute,stamp='2026-11-15T20:00:23.000Z';
const event=(id,event_type='MANUAL_SNAPSHOT_RECORDED',recorded_at=stamp,payload={})=>
  createEvent(event_type,payload,{id:()=>id,now:()=>recorded_at});
function storageFixture(){
  const map=new Map();
  const storage={get length(){return map.size;},key:i=>[...map.keys()][i],
    getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),
    removeItem:k=>map.delete(k)};
  return {map,storage};
}
function storeDemo(log,state,action){
  return log.append(state.snapshot,{source:'demo',session:state.session,action,
    evaluationContext:state.evaluationContext,demo_run_id:state.demo_run_id??undefined});
}

test('SPEC-EVALUATION-TIME: initial and stepped demo uses its deterministic evaluator clock',()=>{
  const start=createDemoState();
  assert.equal(start.evaluationContext.evaluationTimeMs,Date.parse(start.clock_iso));
  assert.equal(start.snapshot.timestamp,start.clock_iso);
  const row=storeDemo(createAuditLog(null),start,event('start'));
  assert.equal(row.evidence.times.evaluated_at,start.clock_iso);
  assert.equal(row.evidence.times.simulation_clock_at,start.clock_iso);
  assert.equal(row.evidence.times.recorded_at,stamp);
  assert.notEqual(row.recorded_at,row.evidence.times.evaluated_at);
  assert.deepEqual(analyze(row.snapshot,row.evidence.evaluation_context).evaluation,row.snapshot.evaluation);
  const tick=reduceDemoState(start,event('tick','SIMULATION_TICK'));
  assert.equal(tick.evaluationContext.evaluationTimeMs,Date.parse(start.clock_iso)+minute);
  assert.equal(tick.snapshot.timestamp,tick.clock_iso);
  const later=storeDemo(createAuditLog(null),tick,event('stepped'));
  assert.equal(later.evidence.times.evaluated_at,tick.clock_iso);
});

test('paused manual actions have distinct event IDs and recording times but keep evaluation clock',()=>{
  const state=createDemoState();
  const {storage}=storageFixture(),log=createAuditLog(storage);
  const first=reduceDemoState(state,event('paused-first'));
  const second=reduceDemoState(first,event('paused-second','MANUAL_SNAPSHOT_RECORDED','2026-11-15T20:12:23.000Z'));
  assert.equal(first.clock_iso,second.clock_iso);
  const rowA=storeDemo(log,first,event('paused-first'));
  const rowB=storeDemo(log,second,event('paused-second','MANUAL_SNAPSHOT_RECORDED','2026-11-15T20:12:23.000Z'));
  assert.notEqual(rowA.event_id,rowB.event_id);
  assert.notEqual(rowA.recorded_at,rowB.recorded_at);
  assert.equal(rowA.evidence.times.evaluated_at,rowB.evidence.times.evaluated_at);
  assert.notEqual(rowB.evidence.times.evaluated_at,rowB.recorded_at);
  assert.equal(log.append(second.snapshot,{source:'demo',session:second.session,
    action:event('paused-second','MANUAL_SNAPSHOT_RECORDED','2026-11-15T20:12:23.000Z'),
    evaluationContext:second.evaluationContext}).id,rowB.id);
  assert.equal(createAuditLog(storage).list().length,2);
});

test('afternoon treatment replay uses same clock, session and evaluated time in storage and CSV',()=>{
  const initial=createDemoState({scenario:'afternoon',clock_iso:AFTERNOON_REPLAY_TIME,demo_run_id:'run-a'});
  const action=event('afternoon','FRAME_SELECTED',stamp,{minute:135});
  const state=reduceDemoState(initial,action),{storage}=storageFixture(),log=createAuditLog(storage);
  assert.equal(state.session.state,'POST_SPRAY_CURING');
  const row=storeDemo(log,state,action);
  const restored=createAuditLog(storage).get(row.id);
  assert.deepEqual(restored,row);
  assert.equal(row.evidence.times.evaluated_at,'2026-11-16T01:15:00.000Z');
  assert.equal(row.evidence.evaluation_context.evaluationTimeMs,Date.parse(row.evidence.times.evaluated_at));
  assert.deepEqual(row.evidence.evaluation_context.session,state.session);
  assert.deepEqual(analyze(restored.snapshot,restored.evidence.evaluation_context).evaluation,restored.snapshot.evaluation);
  const csv=auditCSV([restored],'America/Los_Angeles');
  assert.match(csv,/"Evaluation UTC"/);
  assert.ok(csv.includes(row.evidence.times.evaluated_at));
  assert.ok(csv.includes('evaluationTimeMs'));
  assert.ok(csv.includes('POST_SPRAY_VOLATILITY_ALERT'));
  const reset=log.resetDemoRun('run-a');
  assert.deepEqual(reset.removed,['afternoon']);
});

test('forecast evaluated time is the supplied screening instant, not future valid or issuance time',async()=>{
  const nowMs=Date.parse('2026-11-15T18:23:00.000Z'),validStart=Math.floor(nowMs/hour)*hour;
  const hourlyUrl='https://api.weather.gov/gridpoints/HNX/53,50/forecast/hourly';
  const periods=Array.from({length:24},(_,i)=>({
    startTime:new Date(validStart+i*hour).toISOString(),
    endTime:new Date(validStart+(i+1)*hour).toISOString(),
    windSpeed:'5 mph',windDirection:'NW',temperature:70,temperatureUnit:'F',
    relativeHumidity:{value:50},shortForecast:'Sunny'
  }));
  const fetchImpl=async url=>({ok:true,json:async()=>url===hourlyUrl?
    {properties:{updateTime:new Date(nowMs-5*minute).toISOString(),periods}}:
    {properties:{forecastHourly:hourlyUrl}}});
  const profile=getProfile('contact_fungicide');
  const model=await loadOrchardForecast('fresno',profile,{nowMs,fetchImpl});
  assert.equal(model.source,'nws');
  assert.equal(model.evaluation_context.evaluationTimeMs,nowMs);
  assert.ok(model.snapshots.length>=23);
  const evaluationMs=nowMs+2*minute;
  const screened=reevaluateForecastModel(model,getProfile('volatile_formulation'),evaluationMs);
  assert.equal(screened.evaluation_context.evaluationTimeMs,evaluationMs);
  const snap=currentForecastPeriod(screened,evaluationMs),log=createAuditLog(null);
  const row=log.append(snap,{source:'forecast',action:event('forecast'),evaluationContext:screened.evaluation_context,
    provenance:{kind:'nws_regional_modeled_heights',issued_at:model.issued_at,
      fetched_at:model.fetched_at,location_id:model.location_id}});
  assert.equal(row.evidence.times.evaluated_at,new Date(evaluationMs).toISOString());
  assert.equal(row.evidence.times.forecast_valid_at,snap.timestamp);
  assert.notEqual(row.evidence.times.evaluated_at,row.evidence.times.forecast_valid_at);
  assert.notEqual(row.evidence.times.evaluated_at,row.evidence.provenance.issued_at);
  assert.notEqual(row.evidence.times.evaluated_at,row.evidence.provenance.fetched_at);
  assert.deepEqual(analyze(row.snapshot,row.evidence.evaluation_context).evaluation,row.snapshot.evaluation);
  const csv=auditCSV([row],'America/Los_Angeles');
  assert.match(csv,/"Evaluation UTC"/);
  assert.ok(csv.includes(row.evidence.times.evaluated_at));
});

test('legacy v1/v2 and externally evaluated records remain readable with unknown time',()=>{
  const {storage,map}=storageFixture(),log=createAuditLog(storage);
  const builtIn=log.append(simulateWeather('trap'),{source:'demo',action:event('legacy-v2')});
  assert.equal(builtIn.evidence.times.evaluated_at,null);
  assert.equal(readAuditRecord(builtIn).record.evidence.times.evaluated_at,null);
  const historical={...structuredClone(builtIn),id:'legacy-v1',event_id:'legacy-v1'};
  delete historical.schema_version;delete historical.evidence;
  map.set('canopyguard.audit.v1.legacy-v1',JSON.stringify(historical));
  const external=log.append(simulateWeather('clear'),{source:'imported',
    action:event('external'),evaluationContext:{evaluationTimeMs:Date.parse(stamp)}});
  assert.equal(external.evidence.times.evaluated_at,null);
  assert.equal(external.evidence.evaluator_kind,'external_or_unverified');
  const rows=createAuditLog(storage).list();
  assert.equal(rows.length,3);
  assert.equal(rows.find(r=>r.id==='legacy-v1').evidence,null);
  assert.equal(rows.find(r=>r.id==='external').evidence.times.evaluated_at,null);
});

test('time-context corruption or fabricated evaluated_at is rejected without mutating stored records',()=>{
  const {storage,map}=storageFixture(),log=createAuditLog(storage);
  const state=createDemoState();
  const saved=storeDemo(log,state,event('tamper'));
  const corruptions=[
    row=>{row.evidence.times.evaluated_at=row.recorded_at;},
    row=>{row.evidence.times.evaluated_at=null;},
    row=>{row.evidence.evaluation_context.evaluationTimeMs+=minute;},
    row=>{row.evidence.evaluation_context.evaluationTimeMs='not a time';},
    row=>{row.evidence.times.simulation_clock_at=new Date(0).toISOString();}
  ];
  for(const change of corruptions) {
    const row=structuredClone(saved);
    change(row);
    assert.throws(()=>readAuditRecord(row));
    map.set('canopyguard.audit.v1.tamper',JSON.stringify(row));
    const view=createAuditLog(storage).read();
    assert.equal(view.records.length,0);
    assert.ok(view.issues.some(issue=>issue.code==='MALFORMED_RECORD'));
  }
  map.set('canopyguard.audit.v1.tamper',JSON.stringify(saved));
  assert.deepEqual(createAuditLog(storage).get('tamper'),saved);
  const rejected=analyze(saved.snapshot,{evaluationTimeMs:NaN});
  assert.equal(rejected.evaluation.multi_height_status,'STOP');
  assert.ok(rejected.evaluation.triggered_rules.some(rule=>rule.code==='DATA_INVALID'));
});
