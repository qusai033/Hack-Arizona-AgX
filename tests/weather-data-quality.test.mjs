import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessWeatherEnvelope, WEATHER_SOURCE_KINDS } from '../frontend/weather-data-quality.js';

const referenceTimeMs = Date.parse('2026-11-15T18:00:00Z');
const hour = 60 * 60 * 1000;
const iso = offset => new Date(referenceTimeMs + offset * hour).toISOString();
function record(offset, values = {}) {
  return { validAt: iso(offset), values: {
    temperatureC: 22, relativeHumidityPct: 45, windSpeedMps: 3, ...values
  }};
}
function envelope(overrides = {}) {
  return {
    source: { label: 'Example weather station', kind: 'observed' },
    retrievedAt: iso(0),
    records: [record(-2), record(-1), record(0)],
    ...overrides
  };
}

test('fresh observations preserve provenance and distinguish retrieval time from record time', () => {
  const result = assessWeatherEnvelope(envelope(), { referenceTimeMs });
  assert.equal(result.status, 'ok');
  assert.equal(result.freshness, 'fresh');
  assert.equal(result.sourceLabel, 'Example weather station');
  assert.equal(result.sourceKindLabel, WEATHER_SOURCE_KINDS.observed);
  assert.equal(result.isMeasured, true);
  assert.equal(result.retrievedAt, iso(0));
  assert.equal(result.records[0].validAt, iso(-2));
  assert.equal(result.validRecordCount, 3);
  assert.deepEqual(result.issues, []);
});

test('provider issuance, record valid time, retrieval time, and evaluation time remain separate', () => {
  const issuedAt = iso(-4);
  const retrievedAt = new Date(referenceTimeMs - 30 * 60 * 1000).toISOString();
  const result = assessWeatherEnvelope(envelope({ issuedAt, retrievedAt }), { referenceTimeMs });

  assert.equal(result.issuedAt, issuedAt);
  assert.equal(result.issuanceTimestampStatus, 'valid');
  assert.equal(result.issuanceAgeMs, 4 * hour);
  assert.equal(result.records[0].validAt, iso(-2));
  assert.equal(result.retrievedAt, retrievedAt);
  assert.equal(result.evaluatedAt, iso(0));
  assert.equal(result.retrievalAgeMs, 30 * 60 * 1000);
  assert.notEqual(result.issuedAt, result.records[0].validAt);
  assert.notEqual(result.records[0].validAt, result.retrievedAt);
  assert.notEqual(result.retrievedAt, result.evaluatedAt);
});

test('invalid optional issuance metadata is reported without changing retrieval freshness classification', () => {
  const baseline = assessWeatherEnvelope(envelope(), { referenceTimeMs });
  const invalidIssuance = assessWeatherEnvelope(envelope({ issuedAt: 'not-a-date' }), { referenceTimeMs });
  const oldIssuance = assessWeatherEnvelope(envelope({ issuedAt: iso(-12) }), { referenceTimeMs });
  const futureIssuance = assessWeatherEnvelope(envelope({ issuedAt: iso(12) }), { referenceTimeMs });

  assert.equal(invalidIssuance.issuedAt, null);
  assert.equal(invalidIssuance.issuanceTimestampStatus, 'invalid');
  assert.equal(invalidIssuance.issuanceAgeMs, null);
  assert.equal(invalidIssuance.freshness, baseline.freshness);
  assert.equal(invalidIssuance.status, baseline.status);
  assert.equal(oldIssuance.issuanceAgeMs, 12 * hour);
  assert.equal(oldIssuance.freshness, baseline.freshness);
  assert.equal(oldIssuance.status, baseline.status);
  assert.equal(futureIssuance.issuanceAgeMs, -12 * hour);
  assert.equal(futureIssuance.freshness, baseline.freshness);
  assert.equal(futureIssuance.status, baseline.status);
});

test('forecast, modeled, and synthetic feeds are never labelled as measured observations', () => {
  for (const [kind, label] of [
    ['forecast', 'Forecast values'],
    ['modeled', 'Modeled estimates'],
    ['synthetic', 'Synthetic/demo values']
  ]) {
    const result = assessWeatherEnvelope(envelope({
      source: { label: 'Non-observation feed', kind }
    }), { referenceTimeMs });
    assert.equal(result.isMeasured, false);
    assert.equal(result.sourceKindLabel, label);
  }
});

test('stale source responses receive a warning while record times remain unchanged', () => {
  const result = assessWeatherEnvelope(envelope({ retrievedAt: iso(-3) }), {
    referenceTimeMs, staleAfterMs: 2 * hour
  });
  assert.equal(result.freshness, 'stale');
  assert.equal(result.status, 'warning');
  assert.equal(result.records[2].validAt, iso(0));
  assert.match(result.issues.join(' '), /older than/i);
});

test('missing, malformed, and future retrieval timestamps fail closed', () => {
  for (const retrievedAt of [undefined, 'not-a-date']) {
    const result = assessWeatherEnvelope(envelope({ retrievedAt }), { referenceTimeMs });
    assert.equal(result.freshness, 'unknown');
    assert.equal(result.status, 'unavailable');
  }
  const future = assessWeatherEnvelope(envelope({
    retrievedAt: new Date(referenceTimeMs + 10 * 60 * 1000).toISOString()
  }), { referenceTimeMs });
  assert.equal(future.freshness, 'future');
  assert.equal(future.status, 'unavailable');
});

test('missing and out-of-range required fields are reported per record', () => {
  const result = assessWeatherEnvelope(envelope({
    records: [record(-2), record(-1, { relativeHumidityPct: null }), record(0, { windSpeedMps: -1 })]
  }), { referenceTimeMs });
  assert.equal(result.invalidRecordCount, 2);
  assert.deepEqual(result.records[1].missingFields, ['relativeHumidityPct']);
  assert.deepEqual(result.records[2].invalidFields, ['windSpeedMps']);
  assert.equal(result.status, 'warning');
});

test('optional measurements are validated when present but are not required by default', () => {
  assert.equal(assessWeatherEnvelope(envelope(), { referenceTimeMs }).invalidRecordCount, 0);
  const invalid = assessWeatherEnvelope(envelope({
    records: [record(0, { precipitationMm: -0.1 })]
  }), { referenceTimeMs });
  assert.deepEqual(invalid.records[0].invalidFields, ['precipitationMm']);
});

test('time-series gaps, duplicate timestamps, and out-of-order rows are detected', () => {
  const result = assessWeatherEnvelope(envelope({
    records: [record(-5), record(-4), record(-1), record(-2), record(-2)]
  }), { referenceTimeMs });
  assert.equal(result.missingIntervals, 1);
  assert.equal(result.outOfOrderTimestamps, 1);
  assert.equal(result.duplicateTimestamps, 1);
  assert.equal(result.status, 'warning');
});

test('empty feeds are unavailable and malformed record times are invalid', () => {
  const empty = assessWeatherEnvelope(envelope({ records: [] }), { referenceTimeMs });
  assert.equal(empty.status, 'unavailable');
  assert.match(empty.issues.join(' '), /no weather records/i);
  const malformed = assessWeatherEnvelope(envelope({
    records: [{ validAt: 'yesterday', values: {
      temperatureC: 20, relativeHumidityPct: 50, windSpeedMps: 2
    }}]
  }), { referenceTimeMs });
  assert.equal(malformed.invalidRecordCount, 1);
  assert.equal(malformed.records[0].validAt, null);
});

test('invalid envelopes, source kinds, and options are rejected', () => {
  assert.throws(() => assessWeatherEnvelope(null, { referenceTimeMs }), /object/i);
  assert.throws(() => assessWeatherEnvelope(envelope({ records: null }), { referenceTimeMs }), /records/i);
  assert.throws(() => assessWeatherEnvelope(envelope({
    source: { label: 'Unknown', kind: 'guess' }
  }), { referenceTimeMs }), /source label and supported source kind/i);
  assert.throws(() => assessWeatherEnvelope(envelope(), { referenceTimeMs, staleAfterMs: 0 }), /positive/i);
  assert.throws(() => assessWeatherEnvelope(envelope(), {
    referenceTimeMs, requiredFields: ['unknown']
  }), /requiredFields/i);
});

test('observed feeds are judged by observation age, not only by retrieval time', () => {
  const dead = assessWeatherEnvelope(envelope({
    records: [record(-74), record(-73), record(-72)]
  }), { referenceTimeMs });
  assert.equal(dead.freshness, 'fresh');
  assert.equal(dead.observationFreshness, 'expired');
  assert.equal(dead.latestValidRecordAt, iso(-72));
  assert.equal(dead.latestRecordAgeMs, 72 * hour);
  assert.equal(dead.status, 'unavailable');
  assert.match(dead.issues.join(' '), /newest valid observation/i);

  const lagging = assessWeatherEnvelope(envelope({
    records: [record(-5), record(-4), record(-3)]
  }), { referenceTimeMs });
  assert.equal(lagging.observationFreshness, 'stale');
  assert.equal(lagging.status, 'warning');
});

test('observed records cannot be timestamped in the future; forecast records can', () => {
  const records = [record(-1), record(0), record(1), record(2)];
  const observed = assessWeatherEnvelope(envelope({ records }), { referenceTimeMs });
  assert.equal(observed.futureRecordCount, 2);
  assert.equal(observed.invalidRecordCount, 2);
  assert.equal(observed.records[3].futureTimestamp, true);
  assert.equal(observed.latestValidRecordAt, iso(0));
  assert.equal(observed.status, 'warning');

  const onlyFuture = assessWeatherEnvelope(envelope({
    records: [record(48), record(49)]
  }), { referenceTimeMs });
  assert.equal(onlyFuture.status, 'unavailable');

  const forecast = assessWeatherEnvelope(envelope({
    source: { label: 'Forecast provider', kind: 'forecast' }, records
  }), { referenceTimeMs });
  assert.equal(forecast.futureRecordCount, 0);
  assert.equal(forecast.observationFreshness, null);
  assert.equal(forecast.status, 'ok');
});

test('a feed with records but no valid record is unavailable', () => {
  for (const records of [
    [-2, -1, 0].map(offset => ({ validAt: iso(offset), values: {} })),
    [null, 'row', 7],
    [{ validAt: iso(0), values: [22, 45, 3] }]
  ]) {
    const result = assessWeatherEnvelope(envelope({ records }), { referenceTimeMs });
    assert.equal(result.validRecordCount, 0);
    assert.equal(result.status, 'unavailable');
    assert.match(result.issues.join(' '), /no valid weather records/i);
  }
});

test('responses past the expiry limit are unavailable rather than a warning', () => {
  const expired = assessWeatherEnvelope(envelope({
    source: { label: 'Forecast provider', kind: 'forecast' }, retrievedAt: iso(-7)
  }), { referenceTimeMs });
  assert.equal(expired.freshness, 'expired');
  assert.equal(expired.status, 'unavailable');
  const custom = assessWeatherEnvelope(envelope({
    source: { label: 'Forecast provider', kind: 'forecast' }, retrievedAt: iso(-7)
  }), { referenceTimeMs, expireAfterMs: 12 * hour });
  assert.equal(custom.freshness, 'stale');
  assert.equal(custom.status, 'warning');
});

test('continuity is counted on the sorted series and scales with gap length and interval', () => {
  const shuffled = assessWeatherEnvelope(envelope({
    records: [-5, 0, -4, -3, -2, -1].map(offset => record(offset))
  }), { referenceTimeMs });
  assert.equal(shuffled.missingIntervals, 0);
  assert.equal(shuffled.outOfOrderTimestamps, 1);

  const reversed = assessWeatherEnvelope(envelope({
    records: [0, -1, -2, -3].map(offset => record(offset))
  }), { referenceTimeMs });
  assert.equal(reversed.missingIntervals, 0);
  assert.equal(reversed.outOfOrderTimestamps, 3);

  const longGap = assessWeatherEnvelope(envelope({
    records: [record(-4), record(0)]
  }), { referenceTimeMs });
  assert.equal(longGap.missingIntervals, 3);

  const tenMinute = offset => ({ ...record(0), validAt: new Date(referenceTimeMs + offset * 10 * 60 * 1000).toISOString() });
  const fine = assessWeatherEnvelope(envelope({
    records: [tenMinute(-5), tenMinute(-4), tenMinute(-1), tenMinute(0)]
  }), { referenceTimeMs, expectedIntervalMinutes: 10 });
  assert.equal(fine.missingIntervals, 2);
});

test('expectedRecordCount reports truncated feeds', () => {
  const result = assessWeatherEnvelope(envelope({
    source: { label: 'Forecast provider', kind: 'forecast' },
    records: [record(0), record(1), record(1)]
  }), { referenceTimeMs, expectedRecordCount: 24 });
  assert.equal(result.recordShortfall, 22);
  assert.equal(result.status, 'warning');
  assert.equal(assessWeatherEnvelope(envelope(), { referenceTimeMs, expectedRecordCount: 3 }).recordShortfall, 0);
});

test('impossible calendar dates are rejected instead of rolled into the next month', () => {
  const result = assessWeatherEnvelope(envelope({
    records: [record(0), { ...record(0), validAt: '2026-02-30T00:00:00Z' }]
  }), { referenceTimeMs });
  assert.equal(result.records[1].validAt, null);
  assert.equal(result.invalidRecordCount, 1);
  assert.equal(assessWeatherEnvelope(envelope({ retrievedAt: '2026-11-31T18:00:00Z' }), { referenceTimeMs }).freshness, 'unknown');
  assert.equal(assessWeatherEnvelope(envelope({ retrievedAt: '2026-11-15T10:00:00-08:00' }), { referenceTimeMs }).freshness, 'fresh');
});

test('wind direction is validated and unsupported fields are reported, not trusted', () => {
  const result = assessWeatherEnvelope(envelope({
    records: [
      record(-2, { windDirectionDeg: 315 }),
      record(-1, { windDirectionDeg: 9999 }),
      record(0, { temp_f: 72 })
    ]
  }), { referenceTimeMs, requiredFields: ['temperatureC', 'windDirectionDeg'] });
  assert.equal(result.records[0].valid, true);
  assert.deepEqual(result.records[1].invalidFields, ['windDirectionDeg']);
  assert.deepEqual(result.records[2].missingFields, ['windDirectionDeg']);
  assert.deepEqual(result.records[2].unknownFields, ['temp_f']);
  assert.equal(result.unknownFieldRecordCount, 1);
  assert.match(result.issues.join(' '), /unsupported fields/i);

  const extraOnly = assessWeatherEnvelope(envelope({
    records: [record(0, { dewPointC: 9 })]
  }), { referenceTimeMs });
  assert.equal(extraOnly.records[0].valid, true);
  assert.equal(extraOnly.status, 'warning');
});

test('remaining option bounds are enforced', () => {
  for (const options of [
    { referenceTimeMs: NaN },
    { futureToleranceMs: -1 },
    { expectedIntervalMinutes: 0 },
    { expectedIntervalMinutes: 1.5 },
    { expectedRecordCount: 0 },
    { staleAfterMs: 2 * hour, expireAfterMs: hour },
    { requiredFields: 'temperatureC' }
  ]) {
    assert.throws(() => assessWeatherEnvelope(envelope(), { referenceTimeMs, ...options }));
  }
  assert.equal(assessWeatherEnvelope(envelope(), null).sourceKind, 'observed');
});
