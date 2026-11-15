import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateWeather, loadOrchardForecast, normalizeHourly } from '../frontend/weather.js';
import { getProfile } from '../frontend/engine/index.js';
import { assertSnapshot } from '../frontend/contract.js';

test('five presets evaluate at their anchors, with a treatment alert at 5:15 PM',()=>{
  for(const [name,status] of Object.entries({trap:'STOP',calm:'STOP',clear:'GO',evaporation:'CAUTION',afternoon:'GO'})){
    const snapshot=assertSnapshot(simulateWeather(name));
    assert.equal(snapshot.evaluation.multi_height_status,status);
  }
  assert.equal(simulateWeather('trap').evaluation.caught_hidden_risk,true);
  assert.ok(simulateWeather('afternoon',135).evaluation.triggered_rules.some(rule=>rule.code==='POST_SPRAY_VOLATILITY_ALERT'));
  assert.notEqual(simulateWeather('clear',1).readings.ground_5ft.temp_f,71);
});
test('manual overrides run the engine and normalize 360 degrees to north',()=>{
  const snapshot=assertSnapshot(simulateWeather('clear',0,undefined,{canopy_30ft:{wind_speed_mph:2,wind_dir_deg:360}}));
  assert.equal(snapshot.readings.canopy_30ft.wind_dir_deg,0);
  assert.equal(snapshot.evaluation.multi_height_status,'STOP');
});
test('NWS data uses hourly input, caches successful fetch, and falls back deterministically',async()=>{
  const nowMs=Date.parse('2026-11-15T18:00:00Z');
  const periods=Array.from({length:24},(_,index)=>({
    startTime:new Date(nowMs+index*3600000).toISOString(),endTime:new Date(nowMs+(index+1)*3600000).toISOString(),
    windSpeed:'5 to 7 mph',windDirection:'NW',temperature:70,temperatureUnit:'F',relativeHumidity:{value:55},shortForecast:'Sunny'
  }));
  assert.equal(normalizeHourly(periods[0]).wind,7);
  assert.equal(normalizeHourly({...periods[0],windSpeed:'0 mph',windDirection:''}).wind,0);
  const forecastHourly='https://api.weather.gov/gridpoints/HNX/53,50/forecast/hourly';
  const fetchImpl=async url=>({ok:true,json:async()=>url===forecastHourly?{properties:{periods}}:{properties:{forecastHourly}}});
  const store=new Map(),cache={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)};
  const profile=getProfile('contact_fungicide');
  const live=await loadOrchardForecast('fresno',profile,{nowMs,cache,fetchImpl});
  assert.equal(live.source,'nws');assert.equal(live.snapshots.length,24);
  const offline=async()=>{throw new Error('Offline');};
  const cached=await loadOrchardForecast('fresno',profile,{nowMs,cache,fetchImpl:offline});
  assert.equal(cached.source,'cached_nws');
  assert.deepEqual(cached.snapshots.map(row=>row.readings),live.snapshots.map(row=>row.readings));
  const a=await loadOrchardForecast('willcox',profile,{nowMs,fetchImpl:offline});
  assert.equal(a.source,'synthetic');assert.equal(a.time_zone,'America/Phoenix');
  assert.deepEqual(a,await loadOrchardForecast('willcox',profile,{nowMs,fetchImpl:offline}));
});
