import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateWeather, loadOrchardForecast, normalizeHourly, presetClockMinutes } from '../frontend/weather.js';
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
test('preset playback follows the local clock: anchors at their story times, no midday inversion, inversions return at night',()=>{
  const localHour=snapshot=>Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',hourCycle:'h23'}).format(new Date(snapshot.timestamp)));
  const anchorHours={trap:6,calm:6,clear:10,evaporation:14,afternoon:15};
  for(const [name,hour] of Object.entries(anchorHours))assert.equal(localHour(simulateWeather(name)),hour,`${name} anchor hour`);
  const profile=getProfile('volatile_formulation');
  for(const name of ['trap','calm','clear','evaporation']){
    let nightInversion=false;
    for(let minute=0;minute<=1440;minute+=10){
      const snapshot=simulateWeather(name,minute,profile),h=localHour(snapshot);
      const gradient=snapshot.readings.canopy_30ft.temp_f-snapshot.readings.ground_5ft.temp_f;
      if(h>=11&&h<15){
        assert.ok(gradient<0,`${name} minute ${minute} (${h}:00) shows a midday inversion of ${gradient.toFixed(2)}°F`);
        assert.ok(!snapshot.evaluation.triggered_rules.some(rule=>rule.code==='INVERSION_DETECTED'),`${name} minute ${minute} flags a midday inversion`);
      }
      if((h>=20||h<5)&&gradient>0)nightInversion=true;
    }
    assert.ok(nightInversion,`${name} never forms a night inversion`);
  }
});
test('dashboard clock covers 12:00 AM–11:59 PM of the preset day',()=>{
  const localTime=snapshot=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(snapshot.timestamp));
  assert.deepEqual({...presetClockMinutes},{trap:405,calm:390,clear:600,evaporation:840,afternoon:900});
  for(const [name,clock] of Object.entries(presetClockMinutes)){
    assert.equal(localTime(assertSnapshot(simulateWeather(name,-clock))),'Nov 15, 12:00 AM',`${name} at the slider's start`);
    assert.equal(localTime(assertSnapshot(simulateWeather(name,1439-clock))),'Nov 15, 11:59 PM',`${name} at the slider's end`);
  }
  // Before the 3:00 PM application there is no treatment, so no post-spray alert.
  const morning=simulateWeather('afternoon',-300);
  assert.ok(!morning.evaluation.triggered_rules.some(rule=>rule.code==='POST_SPRAY_VOLATILITY_ALERT'));
  assert.ok(simulateWeather('afternoon',135).evaluation.triggered_rules.some(rule=>rule.code==='POST_SPRAY_VOLATILITY_ALERT'));
});
