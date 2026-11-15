import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoState, reduceDemoState, INITIAL_SIM_TIME, AFTERNOON_REPLAY_TIME} from '../frontend/demo-controller.js';
import {createEvent} from '../frontend/events.js';
import {getProfile, assertSession} from '../frontend/engine/index.js';

let sequence = 0;
const action = (type, payload={}) => createEvent(type, payload, {
  id:()=>`test-${++sequence}`, now:()=> '2026-11-15T20:00:00.000Z'
});
const apply = (state,type,payload) => reduceDemoState(state,action(type,payload));
const minutes = (a,b) => (Date.parse(a)-Date.parse(b))/60000;

test('scenario frames reset independently of the monotonic simulation clock',()=>{
  let state=createDemoState();
  state=apply(state,'SIMULATION_TICK');
  state=apply(state,'READING_CHANGED',{height:'ground_5ft',field:'temp_f',value:90});
  const previous=structuredClone(state);
  const next=apply(state,'SCENARIO_SELECTED',{name:'clear'});
  assert.equal(minutes(next.clock_iso,INITIAL_SIM_TIME),2);
  assert.equal(next.minute,0);
  assert.deepEqual(next.overrides,{});
  assert.equal(next.snapshot.timestamp,next.clock_iso);
  assert.equal(next.snapshot.evaluation.multi_height_status,'GO');
  assert.equal(next.handled_events.size,state.handled_events.size+1);
  assert.deepEqual(state,previous);
});

test('scenario changes preserve a manual treatment begun after advancing time',()=>{
  let state=apply(createDemoState({scenario:'clear'}),'FRAME_SELECTED',{minute:60});
  state=apply(state,'SESSION_STARTED');
  const treatment=structuredClone(state.session), now=state.clock_iso;
  state=apply(state,'SCENARIO_SELECTED',{name:'trap'});
  assert.deepEqual(state.session,treatment);
  assert.equal(minutes(state.clock_iso,now),1);
  assert.equal(state.snapshot.evaluation.multi_height_status,'STOP');
  assert.ok(!state.snapshot.evaluation.triggered_rules.some(r=>r.code==='DATA_INVALID'));
  state=apply(state,'SESSION_FINISHED');
  assert.equal(state.session.ended_at,state.clock_iso);
});

test('completed treatments keep their original times/profile across scenario switches',()=>{
  let state=apply(createDemoState({scenario:'clear',profile:getProfile('volatile_formulation')}),'FRAME_SELECTED',{minute:60});
  state=apply(state,'SESSION_STARTED');
  state=apply(state,'FRAME_SELECTED',{minute:120});
  state=apply(state,'SESSION_FINISHED');
  const treatment=structuredClone(state.session);
  state=apply(state,'PROFILE_CHANGED',{profile:getProfile('dormant_oil')});
  state=apply(state,'SCENARIO_SELECTED',{name:'trap'});
  assert.deepEqual(state.session,treatment);
  assert.equal(minutes(state.clock_iso,treatment.ended_at),1);
  assert.ok(state.snapshot.evaluation.triggered_rules.some(r=>r.code==='POST_SPRAY_VOLATILITY_ALERT'));
});

test('backward frame scrubbing cannot backdate an active or completed treatment',()=>{
  let state=apply(createDemoState({scenario:'clear'}),'FRAME_SELECTED',{minute:60});
  state=apply(state,'SESSION_STARTED');
  const start=state.clock_iso;
  state=apply(state,'FRAME_SELECTED',{minute:0});
  assert.equal(minutes(state.clock_iso,start),1);
  state=apply(state,'SESSION_FINISHED');
  assert.equal(state.session.ended_at,state.clock_iso);
  state=apply(state,'FRAME_SELECTED',{minute:10});
  state=apply(state,'FRAME_SELECTED',{minute:0});
  assert.equal(minutes(state.clock_iso,state.session.ended_at),11);
});

test('reprocessing one event changes neither time nor evaluation twice',()=>{
  const tick=action('SIMULATION_TICK');
  const state=reduceDemoState(createDemoState(),tick);
  assert.equal(reduceDemoState(state,tick),state);
  assert.equal(minutes(state.clock_iso,INITIAL_SIM_TIME),1);
});

test('identical-result profile and manual actions remain distinct without advancing time',()=>{
  let state=createDemoState();
  for(const profile of ['dormant_oil','contact_fungicide']){
    state=apply(state,'PROFILE_CHANGED',{profile:getProfile(profile)});
    assert.equal(state.snapshot.evaluation.multi_height_status,'STOP');
  }
  state=apply(state,'MANUAL_SNAPSHOT_RECORDED');
  state=apply(state,'MANUAL_SNAPSHOT_RECORDED');
  assert.equal(state.handled_events.size,4);
  assert.equal(state.clock_iso,INITIAL_SIM_TIME);
});

test('afternoon replay carries a complete treatment consistent with its supplied clock',()=>{
  let state=createDemoState({scenario:'afternoon',clock_iso:AFTERNOON_REPLAY_TIME});
  state=apply(state,'FRAME_SELECTED',{minute:135});
  assertSession(state.session);
  assert.equal(state.session.started_at,AFTERNOON_REPLAY_TIME);
  assert.equal(state.session.ended_at,'2026-11-15T23:15:00.000Z');
  assert.equal(state.snapshot.timestamp,'2026-11-16T01:15:00.000Z');
  assert.ok(state.snapshot.evaluation.triggered_rules.some(r=>r.code==='POST_SPRAY_VOLATILITY_ALERT'));
  const clock=state.clock_iso;
  state=apply(state,'FRAME_SELECTED',{minute:0});
  assert.equal(minutes(state.clock_iso,clock),1);
  assert.equal(state.session.started_at,state.clock_iso);
  const later=apply(state,'SCENARIO_SELECTED',{name:'clear'});
  assert.equal(later.session,null); // Synthetic fixture sessions do not become user treatments.
  assert.equal(minutes(later.clock_iso,state.clock_iso),1);
});

test('selecting the afternoon weather frame never replaces a real manual demo treatment',()=>{
  let state=apply(createDemoState({scenario:'clear'}),'SESSION_STARTED');
  const treatment=structuredClone(state.session);
  state=apply(state,'SCENARIO_SELECTED',{name:'afternoon'});
  assert.equal(state.session_source,'manual');
  assert.deepEqual(state.session,treatment);
});

test('a separate judge replay cannot mutate the normal demo clock or treatment',()=>{
  const normal=apply(apply(createDemoState({scenario:'clear'}),'FRAME_SELECTED',{minute:60}),'SESSION_STARTED');
  const before=structuredClone(normal);
  apply(createDemoState({scenario:'afternoon',clock_iso:AFTERNOON_REPLAY_TIME}),'FRAME_SELECTED',{minute:135});
  assert.deepEqual(normal,before);
});

test('invalid event context fails without mutating the previously valid state',()=>{
  const state=createDemoState({scenario:'clear'});
  assert.throws(()=>reduceDemoState(state,{event_type:'SIMULATION_TICK'}),/event ID/);
  assert.throws(()=>apply(state,'FRAME_SELECTED',{minute:-1}),/frame/);
  assert.throws(()=>apply(state,'SCENARIO_SELECTED',{name:'missing'}),/scenario/);
  assert.equal(state.clock_iso,INITIAL_SIM_TIME);
  assert.equal(state.handled_events.size,0);
});

test('event construction copies payloads and preserves explicitly supplied identity/time',()=>{
  const profile=getProfile('dormant_oil');
  const event=action('PROFILE_CHANGED',{profile});
  profile.max_wind_mph=100;
  assert.equal(event.payload.profile.max_wind_mph,10);
  assert.equal(event.recorded_at,'2026-11-15T20:00:00.000Z');
});
