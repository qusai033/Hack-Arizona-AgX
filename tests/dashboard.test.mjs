import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSnapshot, assertFresh, deltas, windDifference, escapeHTML } from '../frontend/contract.js';
import { example, scenario, evaluateDemo, demoForecast } from '../frontend/demo.js';
import { nextWindow, validateForecast } from '../frontend/timeline.js';
import { orchardSVG } from '../frontend/visualizer.js';

test('shared example preserves the hidden-risk contrast and derived measurements',()=>{
  assertSnapshot(example);
  assert.equal(example.evaluation.single_station_5ft_status,'GO');
  assert.equal(example.evaluation.multi_height_status,'STOP');
  const d=deltas(example);
  assert.equal(d.temperature,4.5); assert.ok(Math.abs(d.speed-7.6)<1e-12); assert.equal(d.direction,95);
});
test('all 27 scenario/profile combinations validate and severe atmospheric risks stay STOP',()=>{
  for(const name of ['trap','marginal','clear'])for(const volatility_class of ['LOW','MEDIUM','HIGH'])for(const nozzle_droplet_size of ['COARSE','MEDIUM','FINE']){
    const s=scenario(name,{...example.pesticide_profile,volatility_class,nozzle_droplet_size});assertSnapshot(s);
    if(name==='trap')assert.equal(s.evaluation.multi_height_status,'STOP');
    if(name==='clear')assert.equal(s.evaluation.multi_height_status,'GO');
  }
});
test('marginal demo responds to both selectors without changing physical observations',()=>{
  const s=scenario('marginal'); assert.equal(s.evaluation.multi_height_status,'CAUTION');
  const low=evaluateDemo(s,{...s.pesticide_profile,volatility_class:'LOW',nozzle_droplet_size:'COARSE'});
  assert.equal(low.evaluation.multi_height_status,'GO'); assert.deepEqual(low.readings,s.readings);
  assert.equal(evaluateDemo(low,{...low.pesticide_profile,nozzle_droplet_size:'FINE'}).evaluation.multi_height_status,'CAUTION');
});
test('missing, malformed and nonfinite fields are rejected rather than converted to GO',()=>{
  for(const change of [s=>delete s.readings.canopy_30ft,s=>s.readings.ground_5ft.wind_speed_mph=NaN,s=>s.readings.ground_5ft.humidity_pct=101,s=>s.readings.canopy_30ft.wind_dir_deg=360,s=>s.timestamp='yesterday',s=>s.evaluation.multi_height_status='GO',s=>s.evaluation.triggered_rules='none',s=>s.extra=true,s=>s.pesticide_profile.max_wind_mph=1]){
    const s=structuredClone(example);change(s);assert.throws(()=>assertSnapshot(s));
  }
});
test('wind difference uses the shortest circular angle',()=>{
  assert.equal(windDifference(350,10),20);assert.equal(windDifference(10,350),20);assert.equal(windDifference(0,180),180);assert.equal(windDifference(0,0),0);
});
test('live snapshots reject stale and future timestamps',()=>{
  const now=Date.parse(example.timestamp);
  assert.doesNotThrow(()=>assertFresh(example,now));
  assert.throws(()=>assertFresh(example,now+300001),/stale/);
  assert.throws(()=>assertFresh(example,now-60001),/future/);
});
test('24-hour demo derives 09:00–13:30 Pacific window rather than hardcoding callout',()=>{
  const forecast=demoForecast(example.pesticide_profile);assert.equal(forecast.length,48);validateForecast(forecast);
  const w=nextWindow(forecast);assert.equal(new Date(w.start).toISOString(),'2026-11-15T17:00:00.000Z');assert.equal(new Date(w.end).toISOString(),'2026-11-15T21:30:00.000Z');assert.equal(w.hours,4.5);
  const low=demoForecast({...example.pesticide_profile,volatility_class:'LOW',nozzle_droplet_size:'COARSE'});assert.ok(nextWindow(low).hours>w.hours);
});
test('forecast rejects gaps, unordered entries, and invalid intervals',()=>{
  const f=demoForecast(example.pesticide_profile);
  assert.throws(()=>validateForecast([f[0],f[2]]),/contiguous/);
  assert.throws(()=>validateForecast([f[1],f[0]]));
  assert.throws(()=>validateForecast(f,0));assert.throws(()=>validateForecast([]));
});
test('forecast handles no GO window, excludes expired windows and clips current windows',()=>{
  const f=demoForecast(example.pesticide_profile),start=Date.parse('2026-11-15T18:00:00Z');
  assert.equal(nextWindow(f,30,start).hours,3.5);
  assert.equal(nextWindow(f,30,Date.parse('2026-11-16T20:00:00Z')),null);
  assert.equal(nextWindow(f.map(s=>({...s,evaluation:{...s.evaluation,multi_height_status:'STOP'}}))),null);
});
test('dynamic strings are HTML-escaped',()=>{
  assert.equal(escapeHTML('<img onerror="bad()">'), '&lt;img onerror=&quot;bad()&quot;&gt;');
});
test('visualizer respects meteorological FROM direction and removes cap in mixed air',()=>{
  const svg=orchardSVG(example);
  assert.match(svg,/rotate\(180\)/); // N wind points toward S
  assert.match(svg,/rotate\(275\)/); // 95° E wind points toward 275°
  assert.match(svg,/class="warm-cap"/);
  assert.doesNotMatch(orchardSVG(scenario('clear')),/class="warm-cap"/);
  assert.match(orchardSVG(scenario('clear')),/droplet rising/);
});
