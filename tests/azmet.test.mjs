import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAzmetObservation, latestAzmetObservation, loadAzmetObservation, AZMET_MAX_AGE_MS, AZMET_REFRESH_MS, AZMET_ORIGIN } from '../frontend/azmet.js';
import { loadOrchardForecast, locations, stationCheck } from '../frontend/weather.js';
import { getProfile } from '../frontend/engine/index.js';
import { assertSnapshot } from '../frontend/contract.js';
import { reevaluateForecastModel } from '../frontend/forecast-profile.js';

const hour=3600000;
// Shape and string typing copied from a real 15-minute API row; missing sensors use negative sentinels.
const row=(overrides={})=>({datetime:'2026-11-15 15:04:01',meta_needs_review:'0',meta_station_id:'az02',meta_station_name:'Yuma Valley',
  relative_humidity:'40',temp_airC:'25.0',temp_air_30cmC:'27.0',wind_2min_spd_mean_mps:'2.0',wind_2min_vector_dir:'286',
  wind_spd_mps:'3.2',wind_vector_dir:'280',relative_humidity_30cm:'-99999',...overrides});
const nowMs=Date.parse('2026-11-15T22:10:00Z'); // 3:10 PM MST, six minutes after the row above
const periods=(startMs,temperature=77)=>Array.from({length:24},(_,i)=>({
  startTime:new Date(startMs+i*hour).toISOString(),endTime:new Date(startMs+(i+1)*hour).toISOString(),
  windSpeed:'5 mph',windDirection:'NW',temperature,temperatureUnit:'F',relativeHumidity:{value:40},shortForecast:'Sunny'}));
const fetchFor=(azmet,seen=[])=>async url=>{
  seen.push(url);
  if(url.startsWith(AZMET_ORIGIN)){
    if(azmet instanceof Error)throw azmet;
    return {ok:true,json:async()=>azmet};
  }
  return {ok:true,json:async()=>url.includes('/points/')?
    {properties:{forecastHourly:'https://api.weather.gov/gridpoints/PSR/10,20/forecast/hourly'}}:
    {properties:{periods:periods(Math.floor(nowMs/hour)*hour),updateTime:new Date(nowMs-20*60000).toISOString()}}};
};

test('AZMET rows convert to US units with MST timestamps',()=>{
  const observation=normalizeAzmetObservation(row());
  assert.equal(observation.observed_at,'2026-11-15T22:04:01.000Z');
  assert.equal(observation.station_id,'az02');
  assert.equal(observation.station_name,'Yuma Valley');
  assert.ok(Math.abs(observation.temp_f-77)<1e-9);
  assert.ok(Math.abs(observation.temp_1ft_f-80.6)<1e-9);
  assert.equal(observation.humidity_pct,40);
  assert.ok(Math.abs(observation.wind_speed_mph-4.4738726)<1e-6);
  assert.equal(observation.wind_dir_deg,286);
  assert.equal(normalizeAzmetObservation(row({wind_2min_vector_dir:'360'})).wind_dir_deg,0);
  assert.equal(normalizeAzmetObservation(row({wind_2min_spd_mean_mps:'0.0'})).wind_dir_deg,0);
  // The low sensor is optional; its sentinel becomes null instead of a temperature.
  assert.equal(normalizeAzmetObservation(row({temp_air_30cmC:'-9999.0'})).temp_1ft_f,null);
});
test('AZMET rows with missing, flagged, or malformed values are rejected, never zero-filled',()=>{
  assert.throws(()=>normalizeAzmetObservation(row({temp_airC:'-9999.0'})),/missing/);
  assert.throws(()=>normalizeAzmetObservation(row({relative_humidity:'-99999'})),/missing/);
  assert.throws(()=>normalizeAzmetObservation(row({wind_2min_spd_mean_mps:''})),/missing/);
  assert.throws(()=>normalizeAzmetObservation(row({wind_2min_vector_dir:'361'})),/missing/);
  assert.throws(()=>normalizeAzmetObservation(row({meta_needs_review:'1'})),/review/);
  assert.throws(()=>normalizeAzmetObservation(row({datetime:'2026-11-15T15:04:01Z'})),/time/);
  assert.throws(()=>normalizeAzmetObservation(row({meta_station_id:'../x'})),/station/);
  assert.throws(()=>normalizeAzmetObservation(null),TypeError);
});
test('latest observation picks the newest usable row and enforces freshness',()=>{
  const data=[row({datetime:'2026-11-15 14:49:01',temp_airC:'24.0'}),row(),row({datetime:'2026-11-15 15:19:01',temp_airC:'-9999.0'}),
    row({meta_station_id:'az14',datetime:'2026-11-15 15:09:01'})];
  const latest=latestAzmetObservation({data},'az02',nowMs);
  assert.equal(latest.observed_at,'2026-11-15T22:04:01.000Z');
  assert.ok(Math.abs(latest.age_minutes-5.9833)<0.001);
  const observedMs=Date.parse(latest.observed_at);
  assert.equal(latestAzmetObservation({data:[row()]},'az02',observedMs+AZMET_MAX_AGE_MS).age_minutes,45);
  assert.throws(()=>latestAzmetObservation({data:[row()]},'az02',observedMs+AZMET_MAX_AGE_MS+1),/minutes old/);
  assert.throws(()=>latestAzmetObservation({data:[row()]},'az02',observedMs-6*60000),/future/);
  assert.throws(()=>latestAzmetObservation({data:[row()]},'az39',nowMs),/no observations/);
  assert.throws(()=>latestAzmetObservation({data:[row({temp_airC:'-9999.0'})]},'az02',nowMs),/missing/);
  assert.throws(()=>latestAzmetObservation({},'az02',nowMs),/Unexpected/);
  assert.throws(()=>latestAzmetObservation({data:[]},'nope',nowMs),TypeError);
});
test('station requests are narrow, memoized, and re-checked for age on reuse',async()=>{
  const seen=[],memo=new Map(),fetchImpl=fetchFor({data:[row()]},seen);
  const first=await loadAzmetObservation('az02',{nowMs,fetchImpl,memo});
  assert.deepEqual(seen,[AZMET_ORIGIN+'/v1/observations/15min/az02/2026-11-15T13:10/*']);
  const reused=await loadAzmetObservation('az02',{nowMs:nowMs+AZMET_REFRESH_MS-1,fetchImpl,memo});
  assert.equal(seen.length,1);
  assert.equal(reused.observed_at,first.observed_at);
  assert.ok(reused.age_minutes>first.age_minutes);
  await loadAzmetObservation('az02',{nowMs:nowMs+AZMET_REFRESH_MS,fetchImpl,memo});
  assert.equal(seen.length,2);
  // A failure is remembered for one minute, then retried.
  const failing=fetchFor(new Error('offline'),seen),errors=new Map();
  await assert.rejects(loadAzmetObservation('az14',{nowMs,fetchImpl:failing,memo:errors}),/offline/);
  await assert.rejects(loadAzmetObservation('az14',{nowMs:nowMs+59000,fetchImpl:failing,memo:errors}),/offline/);
  assert.equal(seen.length,3);
  await assert.rejects(loadAzmetObservation('az14',{nowMs:nowMs+60000,fetchImpl:failing,memo:errors}),/offline/);
  assert.equal(seen.length,4);
  await assert.rejects(loadAzmetObservation('az14',{nowMs,fetchImpl:async()=>({ok:false,status:503})}),/AZMET HTTP 503/);
  await assert.rejects(loadAzmetObservation('fresno',{nowMs,fetchImpl}),TypeError);
});
test('Arizona locations sit at AZMET stations in Arizona time',()=>{
  const arizona=Object.entries(locations).filter(([,place])=>place.azmet_station);
  assert.deepEqual(arizona.map(([id])=>id),['yuma_valley','yuma_north_gila','roll','maricopa','safford','willcox_bench']);
  assert.equal(new Set(arizona.map(([,place])=>place.azmet_station)).size,arizona.length);
  for(const [,place] of arizona){
    assert.match(place.azmet_station,/^az\d{2}$/);
    assert.equal(place.zone,'America/Phoenix');
    assert.ok(place.label.endsWith(', AZ') && place.block.includes(place.label));
    assert.ok(place.latitude>31.3 && place.latitude<37 && place.longitude> -114.9 && place.longitude< -109);
  }
  assert.ok(Object.values(locations).filter(place=>!place.azmet_station).every(place=>place.label.endsWith(', CA')));
});
test('forecast for an AZMET location carries a station check; the forecast rows stay modeled',async()=>{
  const profile=getProfile('contact_fungicide');
  const result=await loadOrchardForecast('yuma_valley',profile,{nowMs,fetchImpl:fetchFor({data:[row()]})});
  assert.equal(result.source,'nws');
  assert.equal(result.station_error,null);
  const {station}=result;
  assert.equal(station.source,'azmet');
  assert.equal(station.station_id,'az02');
  assert.equal(station.observed_at,'2026-11-15T22:04:01.000Z');
  assert.ok(Math.abs(station.measured.temp_f-77)<1e-9);
  assert.equal(station.measured.wind_dir_cardinal,'WNW');
  assert.deepEqual(station.heights,{temperature_ft:4.9,humidity_ft:4.9,wind_ft:9.8,low_temperature_ft:1});
  // 4.9 ft (77°F) minus 1 ft (80.6°F): cooler above, so no near-surface inversion.
  assert.ok(Math.abs(station.near_surface_gradient_f+3.6)<1e-9);
  assert.equal(station.model_period_at,'2026-11-15T22:00:00.000Z');
  const modeled=result.snapshots[0].readings;
  assert.deepEqual(station.modeled_ground,modeled.ground_5ft);
  assert.ok(Math.abs(station.model_minus_station.temp_f-(modeled.ground_5ft.temp_f-77))<1e-9);
  // Anchored screening: measured ground, with only the model's vertical differences applied above it.
  const anchored=assertSnapshot(station.anchored_snapshot).readings;
  assert.deepEqual(anchored.ground_5ft,station.measured);
  assert.ok(Math.abs((anchored.canopy_30ft.temp_f-anchored.ground_5ft.temp_f)-(modeled.canopy_30ft.temp_f-modeled.ground_5ft.temp_f))<1e-9);
  assert.ok(Math.abs(anchored.canopy_30ft.wind_speed_mph/anchored.ground_5ft.wind_speed_mph-modeled.canopy_30ft.wind_speed_mph/modeled.ground_5ft.wind_speed_mph)<1e-9);
  assert.equal(station.anchored_snapshot.timestamp,station.observed_at);
  assert.equal(station.anchored_snapshot.pesticide_profile.name,profile.name);
  // Forecast rows are untouched by the station.
  const plain=await loadOrchardForecast('yuma_valley',profile,{nowMs,fetchImpl:fetchFor(new Error('offline'))});
  assert.deepEqual(plain.snapshots,result.snapshots);
});
test('a station failure never fails the forecast, and California locations make no AZMET request',async()=>{
  const profile=getProfile('contact_fungicide');
  const down=await loadOrchardForecast('roll',profile,{nowMs,fetchImpl:fetchFor(new Error('offline'))});
  assert.equal(down.source,'nws');assert.equal(down.station,null);assert.equal(down.station_error,'offline');
  const stale=await loadOrchardForecast('roll',profile,{nowMs,fetchImpl:fetchFor({data:[row({meta_station_id:'az24',datetime:'2026-11-15 13:04:01'})]})});
  assert.equal(stale.station,null);assert.match(stale.station_error,/minutes old/);
  const seen=[];
  const fresno=await loadOrchardForecast('fresno',profile,{nowMs,fetchImpl:fetchFor({data:[row()]},seen)});
  assert.equal(fresno.station,null);assert.equal(fresno.station_error,null);
  assert.ok(seen.every(url=>url.startsWith('https://api.weather.gov/')));
});
test('offline synthetic rows are never compared with a station',async()=>{
  const profile=getProfile('contact_fungicide');
  const fetchImpl=async url=>{
    if(url.startsWith(AZMET_ORIGIN))return {ok:true,json:async()=>({data:[row({meta_station_id:'az39'})]})};
    throw new Error('NWS offline');
  };
  const result=await loadOrchardForecast('willcox_bench',profile,{nowMs,fetchImpl});
  assert.equal(result.source,'synthetic');
  assert.ok(Math.abs(result.station.measured.temp_f-77)<1e-9);
  assert.equal(result.station.modeled_ground,null);
  assert.equal(result.station.model_minus_station,null);
  assert.equal(result.station.anchored_snapshot,null);
  assert.equal(stationCheck({station_id:'az39',station_name:'Willcox Bench',observed_at:'2026-11-15T22:04:01.000Z',age_minutes:6,
    temp_f:77,humidity_pct:40,wind_speed_mph:4,wind_dir_deg:270,temp_1ft_f:null},[],'nws',locations.willcox_bench,profile).near_surface_gradient_f,null);
});
test('changing the screening profile re-screens the station-anchored snapshot without touching the measurement',async()=>{
  const result=await loadOrchardForecast('yuma_valley',getProfile('contact_fungicide'),{nowMs,fetchImpl:fetchFor({data:[row({wind_2min_spd_mean_mps:'3.2'})]})});
  // 7.2 mph measured gives about 9.4 mph at 30 ft: inside the 10 mph contact limit, above the 8 mph volatile limit.
  const upperWind=result.station.anchored_snapshot.readings.canopy_30ft.wind_speed_mph;
  assert.ok(upperWind>8 && upperWind<10,`anchored 30 ft wind ${upperWind}`);
  assert.equal(result.station.anchored_snapshot.evaluation.multi_height_status,'CAUTION');
  const volatile=getProfile('volatile_formulation');
  const updated=reevaluateForecastModel(result,volatile,nowMs);
  assert.equal(updated.station.anchored_snapshot.pesticide_profile.name,volatile.name);
  assert.equal(updated.station.anchored_snapshot.evaluation.multi_height_status,'STOP');
  assert.deepEqual(updated.station.measured,result.station.measured);
  assert.deepEqual(updated.station.anchored_snapshot.readings,result.station.anchored_snapshot.readings);
  assert.equal(result.station.anchored_snapshot.pesticide_profile.name,'Standard Contact Fungicide');
  // Models without a station are returned without a station key.
  const fresno=await loadOrchardForecast('fresno',volatile,{nowMs,fetchImpl:fetchFor({data:[]})});
  assert.equal(reevaluateForecastModel(fresno,volatile,nowMs).station,null);
});
