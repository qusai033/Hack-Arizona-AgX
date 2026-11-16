import { FRESHNESS_POLICY, describeLimit } from './freshness-policy.js';
import { locations } from './locations.js';
const hour = 3600000;
const compass = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

/** Raw regional hourly weather; no modeled heights, evaluator, or synthetic fallback. */
export async function loadNwsHourly(id, {nowMs=Date.now(), fetchImpl=fetch, signal}={}) {
  if (!Object.hasOwn(locations,id) || !Number.isFinite(nowMs)) throw new TypeError('Invalid location or clock');
  const place = locations[id];
  const timeout = AbortSignal.timeout(10000);
  const requestSignal = signal ? AbortSignal.any([signal,timeout]) : timeout;
  const request = async url => {
    const response = await fetchImpl(url, {headers:{Accept:'application/geo+json'},signal:requestSignal});
    if (!response.ok) throw new Error(`NWS HTTP ${response.status}`);
    return response.json();
  };
  const point = await request(`https://api.weather.gov/points/${place.latitude},${place.longitude}`);
  const url = new URL(point?.properties?.forecastHourly);
  if (url.origin !== 'https://api.weather.gov' || !/^\/gridpoints\/[A-Z]+\/\d+,\d+\/forecast\/hourly$/.test(url.pathname)) {
    throw new Error('Unexpected NWS hourly URL');
  }
  const payload = await request(url.href);
  const issuance = validateForecastIssuance(payload?.properties,nowMs);
  if (!Array.isArray(payload?.properties?.periods)) throw new Error('NWS hourly periods missing');
  const start = Math.floor(nowMs/hour)*hour;
  const rows = payload.properties.periods.filter(period => Date.parse(period.startTime)>=start)
    .slice(0,24).map(normalizeHourly);
  if (!rows.length || Date.parse(rows[0].timestamp)>start+hour || rows.some((row,index) =>
    Date.parse(row.timestamp)!==Date.parse(rows[0].timestamp)+index*hour ||
    row.temperature < -100 || row.temperature > 150 || row.wind < 0 || row.wind > 250)) {
    throw new Error('NWS hourly coverage is unavailable or invalid');
  }
  return {location_id:id,rows,...issuance,fetched_at:new Date(nowMs).toISOString()};
}

/** Project policy, not a guarantee of NWS publication frequency (docs/FRESHNESS_POLICY.md): reject issuance
 * older than 6 hours and timestamps more than 5 minutes ahead of the request clock.
 */
export const MAX_FORECAST_ISSUANCE_AGE_MS = FRESHNESS_POLICY.forecastIssuance.maxAgeMs;
const MAX_ISSUANCE_CLOCK_SKEW_MS = FRESHNESS_POLICY.forecastIssuance.maxFutureMs;
const issuanceFields=['updateTime','generatedAt','updated'];
/** Valid time (hourly period), source issue/update time, and fetch time are distinct.
 * Use NWS updateTime when available, then generatedAt, then updated. An invalid
 * primary field is rejected rather than silently replaced by a secondary field.
 */
export function validateForecastIssuance(properties, nowMs, maxAgeMs=MAX_FORECAST_ISSUANCE_AGE_MS) {
  if(!properties||typeof properties!=='object'||!Number.isFinite(nowMs)||
     !Number.isFinite(maxAgeMs)||maxAgeMs<=0)throw new TypeError('Invalid NWS issuance validation input');
  const field=issuanceFields.find(key=>Object.hasOwn(properties,key));
  if(!field)throw new Error('NWS forecast issuance/update timestamp missing');
  const value=properties[field];
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)||
     !Number.isFinite(Date.parse(value)))throw new Error('Invalid NWS forecast issuance/update timestamp');
  const issuedMs=Date.parse(value),age=nowMs-issuedMs;
  if(age < -MAX_ISSUANCE_CLOCK_SKEW_MS)throw new Error(`NWS forecast issuance time is in the future (more than ${describeLimit(MAX_ISSUANCE_CLOCK_SKEW_MS)} ahead)`);
  if(age > maxAgeMs)throw new Error(`NWS forecast issuance is too old (older than ${describeLimit(maxAgeMs)})`);
  return {issued_at:new Date(issuedMs).toISOString(),issuance_source:field,issuance_age_minutes:Math.max(0,age/60000)};
}
export function normalizeHourly(period) {
  const match = typeof period.windSpeed==='string' && /^(\d+(?:\.\d+)?)(?:\s+to\s+(\d+(?:\.\d+)?))?\s+mph$/i.exec(period.windSpeed.trim());
  const wind = match ? Number(match[2]??match[1]) : NaN;
  // A zero-length wind vector has no bearing. Use 0° for the fixed contract.
  const direction = wind===0 ? 0 : compass.indexOf(period.windDirection);
  const humidity = period.relativeHumidity?.value;
  const time = Date.parse(period.startTime);
  if(!match||direction<0||!Number.isFinite(humidity)||humidity<0||humidity>100||
     !Number.isFinite(period.temperature)||!['F','C'].includes(period.temperatureUnit)||
     !Number.isFinite(time)||Date.parse(period.endTime)-time!==hour) throw new Error('Unsupported or incomplete NWS hourly period');
  const skyText = period.shortForecast ?? '';
  return {timestamp:new Date(time).toISOString(), temperature:period.temperatureUnit==='F'?period.temperature:period.temperature*1.8+32,
    wind, direction:direction*22.5, humidity,
    sky:/cloudy|overcast|rain|snow/i.test(skyText)?'cloudy':/sunny|clear/i.test(skyText)?'clear':'unknown'};
}
