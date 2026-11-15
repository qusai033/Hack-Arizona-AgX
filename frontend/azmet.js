/** AZMET (Arizona Meteorological Network) 15-minute station observations.
 * Published sensor heights: air temperature and relative humidity at 1.5 m (4.9 ft),
 * wind speed and direction at 3.0 m (9.8 ft). Some stations also report air
 * temperature at 0.3 m (1 ft). Nothing here measures conditions at 30 ft.
 * https://azmet.arizona.edu/about/data-variables
 */
export const AZMET_ORIGIN = 'https://api.azmet.arizona.edu';
/** Project policy, not an AZMET guarantee: stations report every 15 minutes, so an
 * observation older than 45 minutes has missed two cycles and is not shown as current.
 */
export const AZMET_MAX_AGE_MS = 45*60000;
const MAX_CLOCK_SKEW_MS = 5*60000;
/** Stations publish every 15 minutes; do not ask more often than this per station. */
export const AZMET_REFRESH_MS = 5*60000;
const ERROR_RETRY_MS = 60000;
export const AZMET_HEIGHTS = Object.freeze({temperature_ft:4.9, humidity_ft:4.9, wind_ft:9.8, low_temperature_ft:1.0});

const stationId = id => typeof id==='string' && /^az\d{2}$/.test(id);
// Missing values arrive as large negative sentinels (-999, -9999, -99999); range checks reject them.
const number = (value, min, max) => {
  const parsed = typeof value==='string' && value.trim()!=='' ? Number(value) : typeof value==='number' ? value : NaN;
  return Number.isFinite(parsed) && parsed>=min && parsed<=max ? parsed : null;
};
const fahrenheit = celsius => celsius*1.8+32;

/** One API row to US units. Throws for a row that cannot be used as a reading.
 * `datetime` carries no zone; AZMET reports Arizona local time, which is MST (UTC−7) all year.
 */
export function normalizeAzmetObservation(row) {
  if(!row||typeof row!=='object') throw new TypeError('AZMET observation must be an object');
  if(!stationId(row.meta_station_id)) throw new Error('AZMET observation has no valid station ID');
  const stamp = typeof row.datetime==='string' && /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)$/.exec(row.datetime);
  const time = stamp ? Date.parse(`${stamp[1]}T${stamp[2]}-07:00`) : NaN;
  if(!Number.isFinite(time)) throw new Error('AZMET observation has no valid time');
  if(String(row.meta_needs_review)!=='0') throw new Error('AZMET observation is flagged for review');
  const temperature = number(row.temp_airC,-40,60), humidity = number(row.relative_humidity,0,100);
  const wind = number(row.wind_2min_spd_mean_mps,0,75), direction = number(row.wind_2min_vector_dir,0,360);
  if(temperature===null||humidity===null||wind===null||direction===null) throw new Error('AZMET observation is missing temperature, humidity, or wind');
  const low = number(row.temp_air_30cmC,-40,60);
  return {
    station_id:row.meta_station_id,
    station_name:typeof row.meta_station_name==='string'&&row.meta_station_name.trim()?row.meta_station_name.trim():row.meta_station_id,
    observed_at:new Date(time).toISOString(),
    temp_f:fahrenheit(temperature), humidity_pct:humidity,
    // Two-minute sustained wind. A calm reading has no bearing; use 0° like the NWS adapter.
    wind_speed_mph:wind*2.2369363, wind_dir_deg:wind===0?0:direction%360,
    temp_1ft_f:low===null?null:fahrenheit(low)
  };
}

/** Newest usable row for the station, checked against the supplied clock. */
export function latestAzmetObservation(payload, id, nowMs, maxAgeMs=AZMET_MAX_AGE_MS) {
  if(!stationId(id)||!Number.isFinite(nowMs)||!Number.isFinite(maxAgeMs)||maxAgeMs<=0) throw new TypeError('Invalid AZMET request');
  if(!payload||!Array.isArray(payload.data)) throw new Error('Unexpected AZMET response');
  let latest=null, reason='AZMET returned no observations for this station';
  for(const row of payload.data){
    if(row?.meta_station_id!==id) continue;
    try{
      const observation=normalizeAzmetObservation(row);
      if(!latest||observation.observed_at>latest.observed_at) latest=observation;
    }catch(error){reason=error.message;}
  }
  if(!latest) throw new Error(reason);
  return checkAge(latest,nowMs,maxAgeMs);
}
function checkAge(observation, nowMs, maxAgeMs) {
  const age=nowMs-Date.parse(observation.observed_at);
  if(age < -MAX_CLOCK_SKEW_MS) throw new Error('AZMET observation time is in the future');
  if(age > maxAgeMs) throw new Error(`AZMET observation is ${Math.round(age/60000)} minutes old; not shown as current`);
  return {...observation, age_minutes:Math.max(0,age/60000)};
}

/** Latest fresh observation for one station. Pass a Map as `memo` to reuse a result
 * for AZMET_REFRESH_MS instead of refetching on every dashboard refresh.
 */
export async function loadAzmetObservation(id, {nowMs=Date.now(), fetchImpl=fetch, signal, memo, maxAgeMs=AZMET_MAX_AGE_MS}={}) {
  if(!stationId(id)||!Number.isFinite(nowMs)) throw new TypeError('Invalid AZMET station or clock');
  const saved=memo?.get(id);
  if(saved && nowMs>=saved.at && nowMs-saved.at<(saved.error?ERROR_RETRY_MS:AZMET_REFRESH_MS)){
    if(saved.error) throw new Error(saved.error);
    return checkAge(saved.observation,nowMs,maxAgeMs);
  }
  try{
    // Ask only for the last two hours, expressed in MST as the API expects.
    const start=new Date(nowMs-2*3600000-7*3600000).toISOString().slice(0,16);
    const timeout=AbortSignal.timeout(4500);
    const response=await fetchImpl(`${AZMET_ORIGIN}/v1/observations/15min/${id}/${start}/*`,
      {headers:{Accept:'application/json'},signal:signal?AbortSignal.any([signal,timeout]):timeout});
    if(!response.ok) throw new Error(`AZMET HTTP ${response.status}`);
    const {age_minutes, ...observation}=latestAzmetObservation(await response.json(),id,nowMs,maxAgeMs);
    memo?.set(id,{at:nowMs,observation});
    return {...observation, age_minutes};
  }catch(error){
    if(signal?.aborted) throw error;
    memo?.set(id,{at:nowMs,error:error.message});
    throw error;
  }
}
