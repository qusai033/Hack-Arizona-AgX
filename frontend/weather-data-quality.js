/**
 * General-purpose weather-feed quality checks.
 * Reports provenance, timestamp freshness, field coverage, and time-series continuity.
 * It does not calculate environmental risk or make operational recommendations.
 */
export const WEATHER_VALUE_LIMITS = Object.freeze({
  temperatureC: Object.freeze({ min: -90, max: 65 }),
  relativeHumidityPct: Object.freeze({ min: 0, max: 100 }),
  windSpeedMps: Object.freeze({ min: 0, max: 150 }),
  /** Meteorological direction FROM, clockwise from north. */
  windDirectionDeg: Object.freeze({ min: 0, max: 360 }),
  precipitationMm: Object.freeze({ min: 0, max: 1000 })
});
export const WEATHER_SOURCE_KINDS = Object.freeze({
  observed: 'Measured observations',
  forecast: 'Forecast values',
  modeled: 'Modeled estimates',
  synthetic: 'Synthetic/demo values'
});
const DEFAULT_REQUIRED_FIELDS = Object.freeze(['temperatureC', 'relativeHumidityPct', 'windSpeedMps']);
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function parseTimestamp(value) {
  const match = typeof value === 'string' ? ISO_TIMESTAMP.exec(value) : null;
  if (!match) return null;
  // Date.parse rolls impossible calendar days (February 30) into the next month.
  const [year, month, day] = match.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function validateOptions(options) {
  const {
    referenceTimeMs = Date.now(),
    staleAfterMs = 2 * 60 * 60 * 1000,
    expireAfterMs = 3 * staleAfterMs,
    futureToleranceMs = 5 * 60 * 1000,
    expectedIntervalMinutes = 60,
    expectedRecordCount = null,
    requiredFields = DEFAULT_REQUIRED_FIELDS
  } = options ?? {};
  if (!Number.isFinite(referenceTimeMs)) throw new TypeError('referenceTimeMs must be finite');
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) throw new RangeError('staleAfterMs must be positive');
  if (!Number.isFinite(expireAfterMs) || expireAfterMs < staleAfterMs) {
    throw new RangeError('expireAfterMs must be at least staleAfterMs');
  }
  if (!Number.isFinite(futureToleranceMs) || futureToleranceMs < 0) throw new RangeError('futureToleranceMs must be non-negative');
  if (!Number.isInteger(expectedIntervalMinutes) || expectedIntervalMinutes <= 0) {
    throw new RangeError('expectedIntervalMinutes must be a positive integer');
  }
  if (expectedRecordCount !== null && (!Number.isInteger(expectedRecordCount) || expectedRecordCount <= 0)) {
    throw new RangeError('expectedRecordCount must be a positive integer');
  }
  if (!Array.isArray(requiredFields) ||
      requiredFields.some(field => !Object.hasOwn(WEATHER_VALUE_LIMITS, field))) {
    throw new TypeError('requiredFields must contain supported weather fields');
  }
  return { referenceTimeMs, staleAfterMs, expireAfterMs, futureToleranceMs, expectedIntervalMinutes,
    expectedRecordCount, requiredFields };
}
/** Age classification shared by retrieval time and, for observed feeds, the newest observation. */
function classifyAge(ageMs, config) {
  if (ageMs === null) return 'unknown';
  if (ageMs < -config.futureToleranceMs) return 'future';
  if (ageMs > config.expireAfterMs) return 'expired';
  if (ageMs > config.staleAfterMs) return 'stale';
  return 'fresh';
}
function inspectRecord(record, index, config, observed) {
  const values = record && typeof record === 'object' && record.values &&
    typeof record.values === 'object' && !Array.isArray(record.values) ? record.values : {};
  const missingFields = [];
  const invalidFields = [];
  for (const field of Object.keys(WEATHER_VALUE_LIMITS)) {
    const hasValue = Object.hasOwn(values, field) && values[field] !== null && values[field] !== undefined;
    if (!hasValue) {
      if (config.requiredFields.includes(field)) missingFields.push(field);
      continue;
    }
    const { min, max } = WEATHER_VALUE_LIMITS[field];
    if (typeof values[field] !== 'number' || !Number.isFinite(values[field]) ||
        values[field] < min || values[field] > max) invalidFields.push(field);
  }
  // Unsupported fields are never range-checked, so they are reported rather than silently trusted.
  const unknownFields = Object.keys(values).filter(field => !Object.hasOwn(WEATHER_VALUE_LIMITS, field));
  const validAtMs = parseTimestamp(record?.validAt);
  // An observation cannot describe a time that has not happened yet.
  const futureTimestamp = observed && validAtMs !== null &&
    validAtMs - config.referenceTimeMs > config.futureToleranceMs;
  return {
    index,
    validAt: validAtMs === null ? null : new Date(validAtMs).toISOString(),
    missingFields,
    invalidFields,
    unknownFields,
    futureTimestamp,
    valid: validAtMs !== null && !futureTimestamp && missingFields.length === 0 && invalidFields.length === 0,
    _validAtMs: validAtMs
  };
}
/**
 * Assess a source envelope:
 * { source: { label, kind }, retrievedAt, records: [{ validAt, values }] }
 * Source kinds: observed | forecast | modeled | synthetic.
 * validAt is record time; retrievedAt is application retrieval time.
 * Returned summaries contain metadata only, not raw measurements.
 * Only status 'ok' means no problem was found; 'unavailable' must not be displayed as usable data.
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
  const observed = source.kind === 'observed';

  const retrievedAtMs = parseTimestamp(envelope.retrievedAt);
  const ageMs = retrievedAtMs === null ? null : config.referenceTimeMs - retrievedAtMs;
  const freshness = classifyAge(ageMs, config);

  const records = envelope.records.map((record, index) => inspectRecord(record, index, config, observed));
  const timestamps = records.map(record => record._validAtMs).filter(timestamp => timestamp !== null);
  let outOfOrderTimestamps = 0;
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] < timestamps[index - 1]) outOfOrderTimestamps += 1;
  }
  // Continuity is measured on the sorted series so that row order cannot invent or hide gaps.
  const sorted = [...timestamps].sort((a, b) => a - b);
  const intervalMs = config.expectedIntervalMinutes * 60 * 1000;
  let missingIntervals = 0;
  let duplicateTimestamps = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const delta = sorted[index] - sorted[index - 1];
    if (delta === 0) duplicateTimestamps += 1;
    else if (delta > intervalMs * 1.5) missingIntervals += Math.round(delta / intervalMs) - 1;
  }
  const distinctTimestamps = sorted.length - duplicateTimestamps;
  const recordShortfall = config.expectedRecordCount === null
    ? 0 : Math.max(0, config.expectedRecordCount - distinctTimestamps);

  const invalidRecordCount = records.filter(record => !record.valid).length;
  const validRecordCount = records.length - invalidRecordCount;
  const futureRecordCount = records.filter(record => record.futureTimestamp).length;
  const unknownFieldRecordCount = records.filter(record => record.unknownFields.length > 0).length;

  // A fresh response can still carry old observations (for example, a station that stopped reporting).
  const validTimes = records.filter(record => record.valid).map(record => record._validAtMs);
  const latestValidMs = validTimes.length ? Math.max(...validTimes) : null;
  const latestRecordAgeMs = latestValidMs === null ? null : config.referenceTimeMs - latestValidMs;
  const observationFreshness = observed ? classifyAge(latestRecordAgeMs, config) : null;

  const issues = [];
  if (freshness === 'unknown') issues.push('Retrieval timestamp is missing or invalid');
  if (freshness === 'future') issues.push('Retrieval timestamp is ahead of the reference clock');
  if (freshness === 'stale') issues.push('Source response is older than the configured freshness limit');
  if (freshness === 'expired') issues.push('Source response is older than the configured expiry limit');
  if (records.length === 0) issues.push('No weather records were returned');
  else if (validRecordCount === 0) issues.push('No valid weather records were returned');
  if (invalidRecordCount > 0) issues.push(invalidRecordCount + ' record(s) have missing or invalid fields/timestamps');
  if (futureRecordCount > 0) issues.push(futureRecordCount + ' observed record(s) are timestamped ahead of the reference clock');
  if (observationFreshness === 'stale') issues.push('Newest valid observation is older than the configured freshness limit');
  if (observationFreshness === 'expired') issues.push('Newest valid observation is older than the configured expiry limit');
  if (unknownFieldRecordCount > 0) issues.push(unknownFieldRecordCount + ' record(s) contain unsupported fields that were not checked');
  if (missingIntervals > 0) issues.push(missingIntervals + ' expected time interval(s) are missing');
  if (recordShortfall > 0) issues.push(recordShortfall + ' fewer distinct record time(s) than expected');
  if (duplicateTimestamps > 0) issues.push(duplicateTimestamps + ' duplicate record timestamp(s) found');
  if (outOfOrderTimestamps > 0) issues.push(outOfOrderTimestamps + ' record timestamp(s) are out of order');

  const unavailable = freshness === 'future' || freshness === 'unknown' || freshness === 'expired' ||
    validRecordCount === 0 || observationFreshness === 'expired';
  const status = unavailable ? 'unavailable' : issues.length > 0 ? 'warning' : 'ok';

  return {
    sourceLabel: source.label.trim(),
    sourceKind: source.kind,
    sourceKindLabel: WEATHER_SOURCE_KINDS[source.kind],
    isMeasured: observed,
    retrievedAt: retrievedAtMs === null ? null : new Date(retrievedAtMs).toISOString(),
    retrievalAgeMs: ageMs,
    freshness,
    latestValidRecordAt: latestValidMs === null ? null : new Date(latestValidMs).toISOString(),
    latestRecordAgeMs,
    observationFreshness,
    status,
    recordCount: records.length,
    validRecordCount,
    invalidRecordCount,
    futureRecordCount,
    unknownFieldRecordCount,
    missingIntervals,
    recordShortfall,
    duplicateTimestamps,
    outOfOrderTimestamps,
    records: records.map(({ _validAtMs, ...summary }) => summary),
    issues
  };
}
