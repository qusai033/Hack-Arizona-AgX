/** General-purpose weather display fixtures and data-quality checks.
 * This module is intentionally independent of CanopyGuard's decision engine.
 * The bundled observations are synthetic examples, never live station readings.
 */
export const SAMPLE_OBSERVATIONS = Object.freeze([
  Object.freeze({id:'tucson',name:'Tucson',latitude:32.2226,longitude:-110.9747,temperatureF:76,humidityPct:28,windMph:6,windDirection:'W',observedAt:'2026-11-15T15:00:00Z',source:'Synthetic demo fixture'}),
  Object.freeze({id:'phoenix',name:'Phoenix',latitude:33.4484,longitude:-112.0740,temperatureF:81,humidityPct:19,windMph:5,windDirection:'NW',observedAt:'2026-11-15T15:00:00Z',source:'Synthetic demo fixture'}),
  Object.freeze({id:'flagstaff',name:'Flagstaff',latitude:35.1983,longitude:-111.6513,temperatureF:54,humidityPct:38,windMph:8,windDirection:'SW',observedAt:'2026-11-15T14:00:00Z',source:'Synthetic demo fixture'}),
  Object.freeze({id:'yuma',name:'Yuma',latitude:32.6927,longitude:-114.6277,temperatureF:84,humidityPct:16,windMph:7,windDirection:'W',observedAt:'2026-11-15T15:00:00Z',source:'Synthetic demo fixture'}),
  Object.freeze({id:'show-low',name:'Show Low',latitude:34.2542,longitude:-110.0298,temperatureF:61,humidityPct:31,windMph:4,windDirection:'N',observedAt:'2026-11-15T13:00:00Z',source:'Synthetic demo fixture'})
]);

const DIRECTIONS = new Set(['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW','CALM']);
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function validateWeatherRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') return {valid:false,errors:['Record must be an object']};
  if (typeof record.id !== 'string' || !record.id.trim()) errors.push('Missing record ID');
  if (typeof record.name !== 'string' || !record.name.trim()) errors.push('Missing location name');
  if (!finite(record.latitude) || record.latitude < 31 || record.latitude > 37) errors.push('Latitude is outside the Arizona viewer bounds');
  if (!finite(record.longitude) || record.longitude < -115 || record.longitude > -109) errors.push('Longitude is outside the Arizona viewer bounds');
  if (!finite(record.temperatureF) || record.temperatureF < -100 || record.temperatureF > 150) errors.push('Temperature is missing or outside the broad validation range');
  if (!finite(record.humidityPct) || record.humidityPct < 0 || record.humidityPct > 100) errors.push('Relative humidity must be between 0 and 100');
  if (!finite(record.windMph) || record.windMph < 0 || record.windMph > 250) errors.push('Wind speed is missing or outside the broad validation range');
  if (typeof record.windDirection !== 'string' || !DIRECTIONS.has(record.windDirection)) errors.push('Wind direction is missing or unrecognized');
  if (typeof record.observedAt !== 'string' || !Number.isFinite(Date.parse(record.observedAt))) errors.push('Observation timestamp is missing or invalid');
  if (typeof record.source !== 'string' || !record.source.trim()) errors.push('Source attribution is missing');
  return {valid:errors.length===0,errors};
}

/** Assess a collection without interpolating, combining, or filling any values. */
export function assessWeatherDataset(records, nowMs, {maxAgeMs=3*60*60*1000}={}) {
  if (!Array.isArray(records)) throw new TypeError('Records must be an array');
  if (!finite(nowMs) || !finite(maxAgeMs) || maxAgeMs < 0) throw new TypeError('Invalid assessment clock or age limit');
  const ids = new Set();
  const entries = records.map(record => {
    const result = validateWeatherRecord(record);
    const errors = [...result.errors];
    if (record && typeof record.id === 'string') {
      if (ids.has(record.id)) errors.push('Duplicate record ID');
      ids.add(record.id);
    }
    if (record && typeof record.observedAt === 'string' && Number.isFinite(Date.parse(record.observedAt))) {
      const age = nowMs - Date.parse(record.observedAt);
      if (age < -5*60*1000) errors.push('Observation timestamp is in the future');
      else if (age > maxAgeMs) errors.push('Observation is older than the configured freshness window');
    }
    return {id:record?.id ?? null,valid:errors.length===0,errors};
  });
  return {total:records.length,validCount:entries.filter(item=>item.valid).length,
    invalidCount:entries.filter(item=>!item.valid).length,entries};
}

export function formatObservationAge(observedAt, nowMs) {
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp) || !finite(nowMs)) return 'Time unavailable';
  const minutes = Math.round((nowMs-timestamp)/60000);
  if (minutes < 0) return 'Future timestamp';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes/60), remainder = minutes%60;
  return remainder ? `${hours} hr ${remainder} min ago` : `${hours} hr ago`;
}
