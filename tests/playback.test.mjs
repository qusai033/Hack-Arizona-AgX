import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlayback} from '../frontend/playback.js';
import {createDemoState,reduceDemoState,INITIAL_SIM_TIME} from '../frontend/demo-controller.js';

test('repeated Play/Pause/Reset owns one timer and rejects stale queued callbacks',()=>{
  const timers=new Map();let id=0,ticks=0,steps=0,allowed=true;
  const player=createPlayback({tick:()=>ticks++,step:()=>++steps,canAdvance:()=>allowed,
    schedule:callback=>{timers.set(++id,callback);return id;},cancel:key=>timers.delete(key)});
  assert.equal(player.start(40),true);assert.equal(player.start(40),false);assert.equal(timers.size,1);
  const old=timers.values().next().value;old();assert.equal(ticks,1);
  assert.equal(player.step(),false);
  player.pause();player.pause();assert.equal(timers.size,0);old();assert.equal(ticks,1);
  assert.equal(player.step(),1);
  player.start(40);old();assert.equal(ticks,1);assert.equal(timers.size,1);
  allowed=false;timers.values().next().value();assert.equal(timers.size,0);assert.equal(player.step(),false);
});
test('Reset Demo restores a reproducible initial state and retains processed-ID protection',()=>{
  let count=0;
  const event=type=>({event_id:String(++count),event_type:type,recorded_at:INITIAL_SIM_TIME});
  let state=createDemoState({scenario:'clear',demo_run_id:'owned'});
  state=reduceDemoState(state,event('SESSION_STARTED'));
  const step=event('SIMULATION_STEP');state=reduceDemoState(state,step);
  assert.equal(Date.parse(state.clock_iso)-Date.parse(INITIAL_SIM_TIME),60000);
  const reset=event('DEMO_RESET');state=reduceDemoState(state,reset);
  assert.equal(state.clock_iso,INITIAL_SIM_TIME);assert.equal(state.scenario,'trap');
  assert.equal(state.session,null);assert.equal(state.minute,0);assert.deepEqual(state.overrides,{});
  assert.equal(state.demo_run_id,'owned');assert.equal(reduceDemoState(state,reset),state);
  assert.equal(reduceDemoState(state,step),state);
  const first=state.snapshot;
  state=reduceDemoState(state,event('SIMULATION_STEP'));
  state=reduceDemoState(state,event('DEMO_RESET'));
  assert.deepEqual(state.snapshot,first);
  assert.equal(reduceDemoState(state,reset),state);
});
