/**
 * General-purpose weather-feed quality checks.
 * Reports provenance, timestamp freshness, field coverage, and time-series continuity.
 * It does not calculate environmental risk or make operational recommendations.
 */
export const WEATHER_VALUE_LIMITS = Object.freeze({
  temperatureC: Object.freeze({ min: -90, max: 65 }),
  relativeHumidityPct: Object.freeze({ min: 0, max: 100 }),
  windSpeedMps: Object.freeze({ min: 0, max: 150 }),
  precipitationMm: Object.freeze({ min: 0, max: 1000 })
});
export const WEATHER_SOURCE_KINDS = Object.freeze({
  observed: 'Measured observations',
  forecast: 'Forecast values',
  modeled: 'Modeled estimates',
  synthetic: 'Synthetic/demo values'
});
const DEFAULT_REQUIRED_FIELDS = Object.freeze(['temperatureC', 'relativeHumidityPct', 'windSpeedMps']);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function parseTimestamp(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function validateOptions(options) {
  const {
    referenceTimeMs = Date.now(),
    staleAfterMs = 2 * 60 * 60 * 1000,
    futureToleranceMs = 5 * 60 * 1000,
    expectedIntervalMinutes = 60,
    requiredFields = DEFAULT_REQUIRED_FIELDS
  } = options ?? {};
  if (!Number.isFinite(referenceTimeMs)) throw new TypeError('referenceTimeMs must be finite');
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) throw new RangeError('staleAfterMs must be positive');
  if (!Number.isFinite(futureToleranceMs) || futureToleranceMs < 0) throw new RangeError('futureToleranceMs must be non-negative');
  if (!Number.isInteger(expectedIntervalMinutes) || expectedIntervalMinutes <= 0) {
    throw new RangeError('expectedIntervalMinutes must be a positive integer');
  }
  if (!Array.isArray(requiredFields) ||
      requiredFields.some(field => !Object.hasOwn(WEATHER_VALUE_LIMITS, field))) {
    throw new TypeError('requiredFields must contain supported weather fields');
  }
  return { referenceTimeMs, staleAfterMs, futureToleranceMs, expectedIntervalMinutes, requiredFields };
}
function inspectRecord(record, requiredFields, index) {
  const values = record && typeof record === 'object' && record.values && typeof record.values === 'object'
    ? record.values : {};
  const missingFields = [];
  const invalidFields = [];
  for (const field of Object.keys(WEATHER_VALUE_LIMITS)) {
    const hasValue = Object.hasOwn(values, field) && values[field] !== null && values[field] !== undefined;
    if (!hasValue) {
      if (requiredFields.includes(field)) missingFields.push(field);
      continue;
    }
    const { min, max } = WEATHER_VALUE_LIMITS[field];
    if (typeof values[field] !== 'number' || !Number.isFinite(values[field]) ||
        values[field] < min || values[field] > max) invalidFields.push(field);
  }
  const validAtMs = parseTimestamp(record?.validAt);
  return {
    index,
    validAt: validAtMs === null ? null : new Date(validAtMs).toISOString(),
    missingFields,
    invalidFields,
    valid: validAtMs !== null && missingFields.length === 0 && invalidFields.length === 0,
    _validAtMs: validAtMs
  };
}
/**
 * Assess a source envelope:
 * { source: { label, kind }, retrievedAt, records: [{ validAt, values }] }
 * Source kinds: observed | forecast | modeled | synthetic.
 * validAt is record time; retrievedAt is application retrieval time.
 * Returned summaries contain metadata only, not raw measurements.
 */
export function assessWeatherEnvelope(envelope, options = {}) {
  const config = validateOptions(options);
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TypeError('Weather envelope must be an object');
  }
  const source = envelope.source;
  if (!source || typeof source !== 'object' ||
      typeof source.label !== 'string' || !source.label.trim() ||
      !Object.hasOwn(WEATHER_SOURCE_KINDS, source.kind)) {
    throw new TypeError('Weather envelope requires a source label and supported source kind');
  }
  if (!Array.isArray(envelope.records)) throw new TypeError('Weather envelope records must be an array');

  const retrievedAtMs = parseTimestamp(envelope.retrievedAt);
  const ageMs = retrievedAtMs === null ? null : config.referenceTimeMs - retrievedAtMs;
  let freshness = 'unknown';
  if (ageMs !== null) {
    if (ageMs < -config.futureToleranceMs) freshness = 'future';
    else if (ageMs > config.staleAfterMs) freshness = 'stale';
    else freshness = 'fresh';
  }

  const records = envelope.records.map((record, index) =>
    inspectRecord(record, config.requiredFields, index));
  let missingIntervals = 0;
  let duplicateTimestamps = 0;
  let outOfOrderTimestamps = 0;
  const seenTimestamps = new Set();
  const intervalMs = config.expectedIntervalMinutes * 60 * 1000;
  let previousMs = null;
  for (const record of records) {
    const timestamp = record._validAtMs;
    if (timestamp === null) continue;
    if (seenTimestamps.has(timestamp)) duplicateTimestamps += 1;
    seenTimestamps.add(timestamp);
    if (previousMs !== null) {
      const delta = timestamp - previousMs;
      if (delta < 0) outOfOrderTimestamps += 1;
      else if (delta > intervalMs * 1.5) {
        missingIntervals += Math.max(1, Math.floor((delta - intervalMs * 1.5) / intervalMs) + 1);
      }
    }
    previousMs = timestamp;
  }

  const invalidRecordCount = records.filter(record => !record.valid).length;
  const issues = [];
  if (freshness === 'unknown') issues.push('Retrieval timestamp is missing or invalid');
  if (freshness === 'future') issues.push('Retrieval timestamp is ahead of the reference clock');
  if (freshness === 'stale') issues.push('Source response is older than the configured freshness limit');
  if (records.length === 0) issues.push('No weather records were returned');
  if (invalidRecordCount > 0) issues.push(invalidRecordCount + ' record(s) have missing or invalid fields/timestamps');
  if (missingIntervals > 0) issues.push(missingIntervals + ' expected time interval(s) are missing');
  if (duplicateTimestamps > 0) issues.push(duplicateTimestamps + ' duplicate record timestamp(s) found');
  if (outOfOrderTimestamps > 0) issues.push(outOfOrderTimestamps + ' record timestamp(s) are out of order');

  const status = freshness === 'future' || freshness === 'unknown' || records.length === 0
    ? 'unavailable'
    : freshness === 'stale' || invalidRecordCount > 0 || missingIntervals > 0 ||
      duplicateTimestamps > 0 || outOfOrderTimestamps > 0
      ? 'warning' : 'ok';

  return {
    sourceLabel: source.label.trim(),
    sourceKind: source.kind,
    sourceKindLabel: WEATHER_SOURCE_KINDS[source.kind],
    isMeasured: source.kind === 'observed',
    retrievedAt: retrievedAtMs === null ? null : new Date(retrievedAtMs).toISOString(),
    retrievalAgeMs: ageMs,
    freshness,
    status,
    recordCount: records.length,
    validRecordCount: records.length - invalidRecordCount,
    invalidRecordCount,
    missingIntervals,
    duplicateTimestamps,
    outOfOrderTimestamps,
    records: records.map(({ _validAtMs, ...summary }) => summary),
    issues
  };
}
