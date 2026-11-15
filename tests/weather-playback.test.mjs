import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWeatherPlayback,
  PLAYBACK_SPEEDS,
  SYNTHETIC_WEATHER_FRAMES
} from '../frontend/weather-playback.js';

class FakeIntervals {
  constructor() { this.nextId=1; this.entries=new Map(); }
  set = (callback,delay) => {
    const id=this.nextId++;
    this.entries.set(id,{callback,delay,active:true});
    return id;
  };
  clear = id => {
    const entry=this.entries.get(id);
    if(entry) entry.active=false;
  };
  active() { return [...this.entries.entries()].filter(([,entry])=>entry.active); }
  fire(id) { this.entries.get(id)?.callback(); }
}

function setup() {
  const clock=new FakeIntervals();
  const changes=[];
  const playback=createWeatherPlayback({
    onChange:state=>changes.push(state),
    setIntervalFn:clock.set,
    clearIntervalFn:clock.clear
  });
  return {clock,changes,playback};
}

test('standalone weather playback has eight deterministic frames and normal 1x cadence',()=>{
  assert.equal(SYNTHETIC_WEATHER_FRAMES.length,8);
  assert.deepEqual(PLAYBACK_SPEEDS,[1,5,10]);
  const {clock,playback}=setup();
  assert.equal(playback.getState().speed,1);
  assert.equal(playback.getState().intervalMs,1000);
  playback.start();
  const [[timerId,timer]]=clock.active();
  assert.equal(timer.delay,1000);
  clock.fire(timerId);
  const state=playback.getState();
  assert.equal(state.elapsedMinutes,1);
  assert.equal(state.frameIndex,1);
  assert.equal(state.lastEventId,'weather-demo-run-1-tick-1');
});

test('speed changes wall-clock cadence but each callback advances exactly one minute',()=>{
  const {clock,playback}=setup();
  playback.setSpeed(5);
  playback.start();
  let [[timerId,timer]]=clock.active();
  assert.equal(timer.delay,200);
  clock.fire(timerId);
  assert.equal(playback.getState().elapsedMinutes,1);
  playback.setSpeed(10);
  [[timerId,timer]]=clock.active();
  assert.equal(timer.delay,100);
  clock.fire(timerId);
  assert.equal(playback.getState().elapsedMinutes,2);
  assert.equal(playback.getState().tickCount,2);
  assert.equal(playback.getState().lastEventId,'weather-demo-run-1-tick-2');
});

test('pause freezes playback, stale callbacks are ignored, and paused step advances one minute',()=>{
  const {clock,playback}=setup();
  playback.start();
  const [[timerId,timer]]=clock.active();
  const staleCallback=timer.callback;
  clock.fire(timerId);
  assert.equal(playback.getState().elapsedMinutes,1);
  playback.pause();
  assert.equal(clock.active().length,0);
  staleCallback();
  assert.equal(playback.getState().elapsedMinutes,1);
  assert.equal(playback.step(),true);
  assert.equal(playback.getState().elapsedMinutes,2);
  assert.equal(playback.getState().tickCount,2);
  assert.equal(playback.getState().playing,false);
});

test('step is disabled while playing and reset cancels timers and starts a new unique run',()=>{
  const {clock,playback}=setup();
  playback.start();
  const [[timerId,timer]]=clock.active();
  const staleCallback=timer.callback;
  assert.equal(playback.step(),false);
  playback.reset();
  assert.equal(clock.active().length,0);
  staleCallback();
  assert.equal(playback.getState().elapsedMinutes,0);
  assert.equal(playback.step(),true);
  assert.equal(playback.getState().lastEventId,'weather-demo-run-2-tick-1');
});

test('playback stops at the final frame and cannot advance past the end',()=>{
  const {clock,playback}=setup();
  playback.start();
  for(let minute=0;minute<SYNTHETIC_WEATHER_FRAMES.length-1;minute++) {
    const active=clock.active();
    assert.equal(active.length,1);
    clock.fire(active[0][0]);
  }
  const state=playback.getState();
  assert.equal(state.frameIndex,7);
  assert.equal(state.elapsedMinutes,7);
  assert.equal(state.completed,true);
  assert.equal(state.playing,false);
  assert.equal(clock.active().length,0);
  assert.equal(playback.start(),false);
  assert.equal(playback.step(),false);
});

test('speed is validated and changing it while playing reschedules the sole timer',()=>{
  const {clock,playback}=setup();
  assert.throws(()=>playback.setSpeed(3),/Unsupported playback speed/);
  playback.start();
  playback.setSpeed(5);
  assert.equal(clock.active().length,1);
  assert.equal(clock.active()[0][1].delay,200);
  playback.dispose();
  assert.equal(clock.active().length,0);
  assert.equal(playback.getState().playing,false);
});
