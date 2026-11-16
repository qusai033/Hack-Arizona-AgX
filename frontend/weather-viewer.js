/** General-purpose weather display fixtures and data-quality checks.
 * This module is intentionally independent of CanopyGuard's decision engine.
 * The bundled observations are synthetic examples, never live station readings.
 */
import { locations } from './locations.js';
export const DEMO_REFERENCE_TIME = Date.parse('2026-11-15T16:00:00Z');
const demoValues = [
  [68,55,5], [66,57,4], [67,54,6], [72,43,7], [63,62,3], [65,59,4],
  [84,16,7], [83,18,6], [82,20,5], [80,24,4], [73,30,5], [70,34,6]
];
export const SAMPLE_OBSERVATIONS = Object.freeze(Object.entries(locations).map(([id,place],index) => {
  const [temperatureF,humidityPct,windMph] = demoValues[index];
  return Object.freeze({id,name:place.label,latitude:place.latitude,longitude:place.longitude,
    temperatureF,humidityPct,windMph,windDirection:'NW',observedAt:'2026-11-15T15:00:00Z',source:'Synthetic demo fixture'});
}));

const DIRECTIONS = new Set(['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW','CALM']);
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function validateWeatherRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') return {valid:false,errors:['Record must be an object']};
  if (typeof record.id !== 'string' || !record.id.trim()) errors.push('Missing record ID');
  if (typeof record.name !== 'string' || !record.name.trim()) errors.push('Missing location name');
  if (!finite(record.latitude) || record.latitude < 31 || record.latitude > 42.1) errors.push('Latitude is outside the California–Arizona viewer bounds');
  if (!finite(record.longitude) || record.longitude < -124.6 || record.longitude > -109) errors.push('Longitude is outside the California–Arizona viewer bounds');
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
