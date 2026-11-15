import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateSnapshot, analyze } from '../frontend/engine/evaluate.js';
import { getProfile, PROFILES, thresholdsFor } from '../frontend/engine/profiles.js';
import { createSession, startSpray, finishSpray, monitorSession } from '../frontend/engine/session.js';
import { wetBulbDepression } from '../frontend/engine/wet-bulb.js';
import { assertSnapshot } from '../frontend/contract.js';

const base=()=>({timestamp:'2026-11-15T20:00:00Z',scenario_name:'Boundary test',orchard_block:'Block 4B',readings:{ground_5ft:{temp_f:70,humidity_pct:50,wind_speed_mph:5,wind_dir_deg:0,wind_dir_cardinal:'N'},canopy_30ft:{temp_f:69,humidity_pct:50,wind_speed_mph:5,wind_dir_deg:0,wind_dir_cardinal:'N'}},pesticide_profile:getProfile('contact_fungicide')});
const inversion=(delta,profile='contact_fungicide')=>{const s=base();s.readings.canopy_30ft.temp_f=70+delta;s.pesticide_profile=getProfile(profile);return s;};
const rule=(input,code,ctx)=>evaluate(input,ctx).triggered_rules.find(r=>r.code===code);

for(const [delta,expected] of [[-1,'GO'],[0,'GO'],[0.0001,'CAUTION'],[1,'CAUTION'],[1.0001,'STOP']])test(`standard inversion boundary ${delta}°F → ${expected}`,()=>assert.equal(evaluate(inversion(delta)).multi_height_status,expected));
for(const [delta,expected] of [[0,'GO'],[0.2,'CAUTION'],[0.2001,'STOP'],[1,'STOP']])test(`high-volatility inversion boundary ${delta}°F → ${expected}`,()=>assert.equal(evaluate(inversion(delta,'volatile_formulation')).multi_height_status,expected));
test('a verified label prohibition stops even a weak positive gradient',()=>{
  assert.equal(evaluate(inversion(.01),{labelProhibitsInversion:true}).multi_height_status,'STOP');
  assert.equal(evaluate(inversion(0),{labelProhibitsInversion:true}).multi_height_status,'GO');
});
for(const [speed,expected] of [[0,'STOP'],[2.9999,'STOP'],[3,'GO'],[8,'GO'],[8.0001,'CAUTION'],[10,'CAUTION'],[10.0001,'STOP']])test(`both heights wind boundary ${speed} mph → ${expected}`,()=>{
  const s=base();for(const r of Object.values(s.readings))r.wind_speed_mph=speed;
  const e=evaluate(s);assert.equal(e.multi_height_status,expected);assert.equal(e.single_station_5ft_status,expected);
});
test('each height independently triggers calm and excessive wind',()=>{
  for(const [height,prefix] of [['ground_5ft','GROUND'],['canopy_30ft','UPPER']])for(const [speed,code] of [[2,'WIND_TOO_CALM'],[11,'WIND_EXCEEDED']]){
    const s=base();s.readings[height].wind_speed_mph=speed;assert.equal(rule(s,`${prefix}_${code}`).severity,'STOP');
  }
});
test('supplied lower max and higher minimum tighten screening, never loosen it',()=>{
  const s=base();s.pesticide_profile.max_wind_mph=4;assert.equal(evaluate(s).multi_height_status,'STOP');
  s.pesticide_profile.max_wind_mph=20;assert.equal(thresholdsFor(s.pesticide_profile).maxWind,10);
  s.pesticide_profile.min_wind_mph=6;assert.equal(evaluate(s).multi_height_status,'STOP');
  s.pesticide_profile.volatility_class='HIGH';s.pesticide_profile.min_wind_mph=9;
  assert.equal(rule(s,'DATA_INVALID').severity,'STOP');
});
test('high volatility upper wind >8 stops even when custom max is 10',()=>{
  const s=base();s.pesticide_profile.volatility_class='HIGH';s.readings.canopy_30ft.wind_speed_mph=8.0001;
  assert.equal(rule(s,'UPPER_WIND_EXCEEDED').severity,'STOP');
});
for(const [difference,expected] of [[3.9999,undefined],[4,'CAUTION'],[5.9999,'CAUTION'],[6,'STOP']])test(`speed shear boundary ${difference} mph → ${expected}`,()=>{
  const s=base();s.readings.ground_5ft.wind_speed_mph=3;s.readings.canopy_30ft.wind_speed_mph=3+difference;
  assert.equal(rule(s,'VERTICAL_WIND_SHEAR')?.severity,expected);
});
test('fine droplets stop at 4.5 mph shear, coarse at 6; reversed shear still detected',()=>{
  for(const [shear,expected] of [[4.4999,'CAUTION'],[4.5,'STOP']]){
    const s=base();s.pesticide_profile=getProfile('fine_airblast');s.readings.ground_5ft.wind_speed_mph=3;s.readings.canopy_30ft.wind_speed_mph=3+shear;
    assert.equal(rule(s,'VERTICAL_WIND_SHEAR').severity,expected);
  }
  const s=base();s.readings.ground_5ft.wind_speed_mph=9;s.readings.canopy_30ft.wind_speed_mph=3;
  assert.equal(rule(s,'VERTICAL_WIND_SHEAR').severity,'STOP');assert.match(rule(s,'VERTICAL_WIND_SHEAR').metric,/−6.00/);
});
for(const [angle,speed,expected] of [[44.999,5,undefined],[45,5,'CAUTION'],[74.999,5,'CAUTION'],[75,4,'CAUTION'],[75,4.0001,'STOP'],[180,5,'STOP']])test(`direction ${angle}° upper ${speed} mph → ${expected}`,()=>{
  const s=base();s.readings.canopy_30ft.wind_dir_deg=angle;s.readings.canopy_30ft.wind_speed_mph=speed;
  assert.equal(rule(s,'DIRECTIONAL_WIND_SHEAR')?.severity,expected);
});
test('359° / 1° wrap is 2°, not 358°',()=>{
  const s=base();s.readings.ground_5ft.wind_dir_deg=359;s.readings.canopy_30ft.wind_dir_deg=1;
  assert.equal(analyze(s).diagnostics.direction_shear_deg,2);assert.equal(rule(s,'DIRECTIONAL_WIND_SHEAR'),undefined);
});
test('evaporation rule uses strict >85 F AND <25% RH at each height',()=>{
  for(const [temp,rh,expected] of [[85,24,false],[86,25,false],[86,24,true]])for(const [height,prefix] of [['ground_5ft','GROUND'],['canopy_30ft','UPPER']]){
    const s=base();Object.assign(s.readings[height],{temp_f:temp,humidity_pct:rh});
    assert.equal(!!rule(s,`${prefix}_EVAPORATIVE_RISK`),expected);
  }
});
test('wet bulb matches UCAR independent reference at 20 C / 50% RH',()=>{
  const result=wetBulbDepression(68,50);assert.ok(Math.abs(result.wet_bulb_c-13.69934)<.00001);
  assert.ok(Math.abs(result.depression_c-6.30066)<.00001);
  assert.equal(wetBulbDepression(86,100).depression_c,0);
  for(const [temp,rh] of [[20,50],[90,2],[130,50]])assert.equal(wetBulbDepression(temp,rh).available,false);
});
test('single station is blind to upper hazards but shares all ground rules',()=>{
  const s=inversion(4.5);Object.assign(s.readings.canopy_30ft,{wind_speed_mph:12.4,wind_dir_deg:95,wind_dir_cardinal:'E'});s.readings.ground_5ft.wind_speed_mph=4.8;
  const e=evaluate(s);assert.equal(e.single_station_5ft_status,'GO');assert.equal(e.multi_height_status,'STOP');assert.equal(e.caught_hidden_risk,true);
  s.readings.ground_5ft.wind_speed_mph=2;assert.equal(evaluate(s).caught_hidden_risk,false);
  s.readings.ground_5ft.wind_speed_mph=5;s.readings.ground_5ft.temp_f=90;s.readings.ground_5ft.humidity_pct=20;
  assert.equal(evaluate(s).single_station_5ft_status,'CAUTION');assert.equal(evaluate(s).caught_hidden_risk,false);
});
test('four presets are independent, immutable, and do not relax oil label requirements',()=>{
  assert.equal(Object.keys(PROFILES).length,4);const a=getProfile('contact_fungicide');a.max_wind_mph=30;
  assert.equal(getProfile('contact_fungicide').max_wind_mph,10);
  assert.equal(thresholdsFor(getProfile('volatile_formulation')).monitorHours,12);
  assert.equal(evaluate(inversion(2,'dormant_oil')).multi_height_status,'STOP');
});
test('bad/missing data produces a complete fail-closed evaluation',()=>{
  for(const mutate of [s=>delete s.readings.canopy_30ft,s=>s.readings.ground_5ft.temp_f=NaN,s=>s.readings.canopy_30ft.wind_speed_mph=-1,s=>s.readings.ground_5ft.humidity_pct=101,s=>s.timestamp='bad']){
    const s=base();mutate(s);const e=evaluate(s);assert.equal(e.multi_height_status,'STOP');assert.equal(e.caught_hidden_risk,false);assert.equal(e.triggered_rules[0].code,'DATA_INVALID');
  }
  assert.equal(evaluate(null).multi_height_status,'STOP');
});
test('context freshness is explicit, deterministic, and fails closed',()=>{
  const s=base(),now=Date.parse(s.timestamp);assert.equal(evaluate(s,{nowMs:now}).multi_height_status,'GO');
  assert.equal(evaluate(s,{nowMs:now+300001}).multi_height_status,'STOP');
  assert.equal(evaluate(s,{nowMs:now-60001}).multi_height_status,'STOP');
  assert.equal(evaluate(s,{maxAgeMs:100}).multi_height_status,'STOP');
  assert.equal(evaluate(s,{labelProhibitsInversion:'false'}).multi_height_status,'STOP');
});
test('engine ignores old evaluations, does not mutate input, and accepts legacy output',()=>{
  const s=base();s.evaluation={multi_height_status:'STOP'};const original=structuredClone(s);
  const out=evaluateSnapshot(s);assertSnapshot(out);assert.equal(out.evaluation.multi_height_status,'GO');assert.deepEqual(s,original);assert.deepEqual(evaluate(s),evaluate(s));
  delete out.evaluation.caught_hidden_risk;assertSnapshot(out);
  out.evaluation.caught_hidden_risk=true;assert.throws(()=>assertSnapshot(out));
});
function treated(profile=getProfile('volatile_formulation')){
  let session=createSession('Block 4B',profile);session=startSpray(session,'2026-11-15T17:30:00Z');
  const end=base();end.timestamp='2026-11-15T18:00:00Z';return finishSpray(session,end.timestamp,end);
}
test('session state transitions are explicit and preserve original treatment profile',()=>{
  const p=getProfile('volatile_formulation'),s=treated(p);p.volatility_class='LOW';
  assert.equal(s.state,'POST_SPRAY_CURING');assert.equal(s.pesticide_profile.volatility_class,'HIGH');assert.ok(Object.isFrozen(s.pesticide_profile));
  assert.throws(()=>startSpray(s,'2026-11-15T19:00:00Z'));
  assert.throws(()=>finishSpray(createSession('Block 4B',p),'2026-11-15T19:00:00Z'));
  const started=startSpray(createSession('Block 4B',p),'2026-11-15T19:00:00Z');assert.throws(()=>finishSpray(started,'2026-11-15T18:00:00Z'));
});
test('2-hour high-volatility treatment +3.8 F inversion emits specialized alert',()=>{
  const s=inversion(3.8),session=treated();const e=evaluate(s,{session});
  const r=e.triggered_rules.find(r=>r.code==='POST_SPRAY_VOLATILITY_ALERT');assert.equal(r.severity,'STOP');assert.match(r.explanation,/2 hrs ago/);assert.match(r.explanation,/developed since treatment/);assert.match(r.explanation,/re-entry restrictions/);
  assert.equal(s.pesticide_profile.volatility_class,'LOW'); // current selector cannot erase recorded HIGH
  assert.equal(e.caught_hidden_risk,true);
});
test('post-spray alert boundaries, no treatment, low volatility, and expiry',()=>{
  const session=treated();assert.equal(monitorSession(inversion(1),session).alert,null);assert.ok(monitorSession(inversion(1.0001),session).alert);
  assert.equal(rule(inversion(3.8),'POST_SPRAY_VOLATILITY_ALERT'),undefined);
  assert.equal(monitorSession(inversion(3.8),treated(getProfile('contact_fungicide'))).alert,null);
  for(const [time,expected] of [['2026-11-16T05:59:59Z',true],['2026-11-16T06:00:00Z',false]]){
    const s=inversion(3.8);s.timestamp=time;const m=monitorSession(s,session);assert.equal(!!m.alert,expected);if(!expected)assert.match(m.message,/not a clearance/);
  }
});
test('session block mismatch, time reversal, and malformed state fail closed',()=>{
  const s=inversion(3.8),session=treated();s.orchard_block='Another block';assert.equal(rule(s,'DATA_INVALID',{session}).severity,'STOP');
  s.orchard_block='Block 4B';s.timestamp='2026-11-15T17:45:00Z';assert.equal(rule(s,'DATA_INVALID',{session}).severity,'STOP');
  assert.equal(rule(base(),'DATA_INVALID',{session:{...session,state:'FINISHED'}}).severity,'STOP');
});
test('in-progress session uses applied HIGH profile even if current selector is LOW',()=>{
  const session=startSpray(createSession('Block 4B',getProfile('volatile_formulation')),'2026-11-15T19:00:00Z');
  assert.equal(evaluate(inversion(.5),{session}).multi_height_status,'STOP');
});
test('unknown end conditions do not claim an inversion has newly formed',()=>{
  const s=finishSpray(startSpray(createSession('Block 4B',getProfile('volatile_formulation')),'2026-11-15T17:00:00Z'),'2026-11-15T18:00:00Z');
  assert.match(monitorSession(inversion(3.8),s).alert.explanation,/is present/);
});
