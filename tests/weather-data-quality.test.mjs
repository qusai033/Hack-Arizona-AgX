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
    records: [record(0, { relativeHumidityPct: null }), record(1, { windSpeedMps: -1 })]
  }), { referenceTimeMs });
  assert.equal(result.invalidRecordCount, 2);
  assert.deepEqual(result.records[0].missingFields, ['relativeHumidityPct']);
  assert.deepEqual(result.records[1].invalidFields, ['windSpeedMps']);
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
    records: [record(0), record(1), record(3), record(2), record(2)]
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
