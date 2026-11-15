import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateWeather, loadOrchardForecast, normalizeHourly, locations, presetClockMinutes, presetTimeOfDay, validateForecastIssuance, MAX_FORECAST_ISSUANCE_AGE_MS } from '../frontend/weather.js';
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
  const fetchImpl=async url=>({ok:true,json:async()=>url===forecastHourly?{properties:{periods,updateTime:new Date(nowMs-20*60000).toISOString()}}:{properties:{forecastHourly}}});
  const store=new Map(),cache={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)};
  const profile=getProfile('contact_fungicide');
  const live=await loadOrchardForecast('fresno',profile,{nowMs,cache,fetchImpl});
  assert.equal(live.source,'nws');assert.equal(live.snapshots.length,24);
  assert.equal(live.issued_at,new Date(nowMs-20*60000).toISOString());
  assert.equal(live.fetched_at,new Date(nowMs).toISOString());
  assert.equal(live.issuance_age_minutes,20);
  const offline=async()=>{throw new Error('Offline');};
  const cached=await loadOrchardForecast('fresno',profile,{nowMs,cache,fetchImpl:offline});
  assert.equal(cached.source,'cached_nws');
  assert.equal(cached.issued_at,live.issued_at);
  assert.deepEqual(cached.snapshots.map(row=>row.readings),live.snapshots.map(row=>row.readings));
  const a=await loadOrchardForecast('yuba_city',profile,{nowMs,fetchImpl:offline});
  assert.equal(a.source,'synthetic');assert.equal(a.time_zone,'America/Los_Angeles');
  assert.equal(a.location_id,'yuba_city');
  assert.deepEqual(a,await loadOrchardForecast('yuba_city',profile,{nowMs,fetchImpl:offline}));
});

test('required California forecast cities are stable and have valid location metadata',()=>{
  const expected={fresno:'Fresno, CA',modesto:'Modesto, CA',merced:'Merced, CA',
    bakersfield:'Bakersfield, CA',chico:'Chico, CA',yuba_city:'Yuba City, CA'};
  assert.deepEqual(Object.keys(locations),Object.keys(expected));
  for(const [id,label] of Object.entries(expected)){
    const place=locations[id];
    assert.equal(place.label,label);
    assert.equal(place.zone,'America/Los_Angeles');
    assert.ok(place.latitude>32 && place.latitude<43);
    assert.ok(place.longitude< -114 && place.longitude> -125);
    assert.ok(place.block.includes(label));
  }
});
test('city selections use different NWS point coordinates and isolated cache keys',async()=>{
  const nowMs=Date.parse('2026-11-15T18:00:00Z');
  const rows=Array.from({length:24},(_,i)=>({
    startTime:new Date(nowMs+i*3600000).toISOString(),
    endTime:new Date(nowMs+(i+1)*3600000).toISOString(),
    windSpeed:'5 mph',windDirection:'NW',temperature:68,temperatureUnit:'F',
    relativeHumidity:{value:55},shortForecast:'Sunny'
  }));
  const seen=[],store=new Map();
  const cache={getItem:key=>store.get(key),setItem:(key,val)=>store.set(key,val)};
  const fetchImpl=async url=>{
    seen.push(url);
    return {ok:true,json:async()=>url.includes('/points/')?
      {properties:{forecastHourly:'https://api.weather.gov/gridpoints/HNX/53,50/forecast/hourly'}}:
      {properties:{periods:rows,generatedAt:new Date(nowMs-15*60000).toISOString()}}};
  };
  const profile=getProfile('contact_fungicide');
  for(const id of Object.keys(locations)){
    const result=await loadOrchardForecast(id,profile,{nowMs,cache,fetchImpl});
    assert.equal(result.source,'nws');
    assert.equal(result.location_id,id);
    assert.equal(result.location_label,locations[id].label);
    assert.equal(result.time_zone,locations[id].zone);
    assert.ok(result.snapshots.every(s=>s.orchard_block===locations[id].block));
    assert.ok(store.has('canopyguard-nws-v1-'+id));
    assert.ok(seen.includes('https://api.weather.gov/points/'+locations[id].latitude+','+locations[id].longitude));
  }
  assert.equal([...store.keys()].length,6);
  const fail=async()=>{throw new Error('offline');};
  const merced=await loadOrchardForecast('merced',profile,{nowMs,cache,fetchImpl:fail});
  assert.equal(merced.source,'cached_nws');
  assert.ok(merced.snapshots.every(s=>s.orchard_block===locations.merced.block));
  const emptyCache={getItem:()=>null,setItem:()=>{}};
  const chico=await loadOrchardForecast('chico',profile,{nowMs,cache:emptyCache,fetchImpl:fail});
  assert.equal(chico.source,'synthetic'); // Never display as production observations.
});

test('production HTML derives forecast options from the shared registry and requires explicit demo',async()=>{
  const {readFile}=await import('node:fs/promises');
  const html=await readFile(new URL('../frontend/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8');
  assert.match(html,/<select id="weather-location"[^>]*><\/select>/);
  assert.ok(!html.includes('<option value="willcox">'));
  assert.ok(app.includes('Object.entries(locations)'));
  assert.ok(app.includes("get('mode') === 'demo'"));
  assert.ok(app.includes('else startProductionForecast()'));
  assert.ok(app.includes("result.source==='synthetic'&&mode!=='demo'"));
  assert.ok(app.includes("forecastRequestId"));
  assert.ok(app.includes('weatherForecast.location_id!==id'));
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
test('presetTimeOfDay labels a frame with the local time its conditions model',()=>{
  assert.equal(presetTimeOfDay('trap'),'6:45 AM');
  assert.equal(presetTimeOfDay('clear',120),'12:00 PM');
  assert.equal(presetTimeOfDay('afternoon',135),'5:15 PM');
  assert.equal(presetTimeOfDay('evaporation',1440),'2:00 PM');
  assert.equal(presetTimeOfDay('calm',-390),'12:00 AM');
  assert.throws(()=>presetTimeOfDay('unknown'),TypeError);
  assert.throws(()=>presetTimeOfDay('trap',1.5),TypeError);
});

test('issuance timestamps use source update time, not retrieval or valid period',()=>{
  const nowMs=Date.parse('2026-11-15T18:00:00Z');
  assert.deepEqual(validateForecastIssuance({updateTime:new Date(nowMs-60000).toISOString()},nowMs),{
    issued_at:new Date(nowMs-60000).toISOString(),issuance_source:'updateTime',issuance_age_minutes:1
  });
  assert.equal(validateForecastIssuance({generatedAt:new Date(nowMs-60000).toISOString()},nowMs).issuance_source,'generatedAt');
  assert.equal(validateForecastIssuance({updated:new Date(nowMs-60000).toISOString()},nowMs).issuance_source,'updated');
  assert.equal(validateForecastIssuance({updateTime:new Date(nowMs-MAX_FORECAST_ISSUANCE_AGE_MS).toISOString()},nowMs).issuance_age_minutes,360);
  assert.throws(()=>validateForecastIssuance({},nowMs),/missing/i);
  assert.throws(()=>validateForecastIssuance({updateTime:'bad'},nowMs),/invalid/i);
  assert.throws(()=>validateForecastIssuance({updateTime:null,generatedAt:new Date(nowMs).toISOString()},nowMs),/invalid/i);
  assert.throws(()=>validateForecastIssuance({updateTime:new Date(nowMs-MAX_FORECAST_ISSUANCE_AGE_MS-1).toISOString()},nowMs),/too old/i);
  assert.throws(()=>validateForecastIssuance({updateTime:new Date(nowMs+6*60000).toISOString()},nowMs),/future/i);
});

test('stale or missing NWS issuance cannot be hidden by future valid periods or a new fetch time',async()=>{
  const nowMs=Date.parse('2026-11-15T18:00:00Z'),hour=3600000,profile=getProfile('contact_fungicide');
  const periods=Array.from({length:24},(_,index)=>({
    startTime:new Date(nowMs+index*hour).toISOString(),
    endTime:new Date(nowMs+(index+1)*hour).toISOString(),windSpeed:'5 mph',
    windDirection:'NW',temperature:75,temperatureUnit:'F',relativeHumidity:{value:50},shortForecast:'Sunny'
  }));
  const hourlyUrl='https://api.weather.gov/gridpoints/HNX/53,50/forecast/hourly';
  const cacheMap=new Map();
  const cache={getItem:k=>cacheMap.get(k),setItem:(k,v)=>cacheMap.set(k,v)};
  const fetchFor=metadata=>async url=>({ok:true,json:async()=>url===hourlyUrl?
    {properties:{periods,...metadata}}:{properties:{forecastHourly:hourlyUrl}}});
  const fresh=await loadOrchardForecast('fresno',profile,{nowMs,cache,fetchImpl:fetchFor({updateTime:new Date(nowMs-60000).toISOString()})});
  assert.equal(fresh.source,'nws');
  assert.equal(fresh.issued_at,new Date(nowMs-60000).toISOString());
  assert.equal(fresh.snapshots[0].timestamp,new Date(nowMs).toISOString());
  const stale=await loadOrchardForecast('modesto',profile,{nowMs,fetchImpl:fetchFor({
    updateTime:'2026-11-01T00:00:00Z',generatedAt:'2026-11-01T00:00:00Z'
  })});
  assert.equal(stale.source,'synthetic');
  assert.match(stale.error,/too old/i);assert.equal(stale.issued_at,null);
  const missing=await loadOrchardForecast('modesto',profile,{nowMs,fetchImpl:fetchFor({})});
  assert.equal(missing.source,'synthetic');
  assert.match(missing.error,/missing/i);
  const future=await loadOrchardForecast('modesto',profile,{nowMs,fetchImpl:fetchFor({
    updateTime:new Date(nowMs+10*60000).toISOString()
  })});
  assert.equal(future.source,'synthetic');assert.match(future.error,/future/i);

  // A bad live reply may use recent cached NWS but must never claim the bad
  // response was fresh; both times and source survive.
  const cached=await loadOrchardForecast('fresno',profile,{nowMs:nowMs+hour,cache,
    fetchImpl:fetchFor({updateTime:'2026-11-01T00:00:00Z'})});
  assert.equal(cached.source,'cached_nws');
  assert.equal(cached.issued_at,fresh.issued_at);
  assert.equal(cached.fetched_at,fresh.fetched_at);
  assert.equal(cached.issuance_age_minutes,61);
  const tooOld=await loadOrchardForecast('fresno',profile,{nowMs:nowMs+7*hour,cache,
    fetchImpl:async()=>{throw new Error('offline');}});
  assert.equal(tooOld.source,'synthetic');
  assert.equal(tooOld.issued_at,null);
  const legacyMap=new Map(cacheMap);
  const legacy=JSON.parse(legacyMap.get('canopyguard-nws-v1-fresno'));
  delete legacy.issued_at;delete legacy.issuance_source;
  legacyMap.set('canopyguard-nws-v1-fresno',JSON.stringify(legacy));
  const oldCache={getItem:k=>legacyMap.get(k),setItem:(k,v)=>legacyMap.set(k,v)};
  const ignored=await loadOrchardForecast('fresno',profile,{nowMs,cache:oldCache,
    fetchImpl:async()=>{throw new Error('offline');}});
  assert.equal(ignored.source,'synthetic');
});
