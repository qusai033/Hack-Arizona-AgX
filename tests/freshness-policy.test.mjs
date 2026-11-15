// Issue #47: the retained freshness policy (docs/FRESHNESS_POLICY.md), tested at its exact boundaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRESHNESS_POLICY } from '../frontend/freshness-policy.js';
import { assertFresh } from '../frontend/contract.js';
import { evaluateSnapshot, getProfile } from '../frontend/engine/index.js';
import { loadOrchardForecast, validateForecastIssuance, MAX_FORECAST_ISSUANCE_AGE_MS } from '../frontend/weather.js';
import { scenario } from '../frontend/demo.js';

const second = 1000, minute = 60 * second, hour = 60 * minute;
const nowMs = Date.parse('2026-11-15T18:00:00Z');
const observedAt = offsetMs => ({ ...scenario('clear'), timestamp: new Date(nowMs - offsetMs).toISOString() });
const issued = offsetMs => ({ updateTime: new Date(nowMs - offsetMs).toISOString() });

test('the retained policy values are the documented decision', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(FRESHNESS_POLICY)), {
    observation: { maxAgeMs: 5 * minute, maxFutureMs: 60 * second },
    forecastIssuance: { maxAgeMs: 6 * hour, maxFutureMs: 5 * minute },
    forecastCache: { maxRetrievalAgeMs: 6 * hour }
  });
  assert.equal(MAX_FORECAST_ISSUANCE_AGE_MS, FRESHNESS_POLICY.forecastIssuance.maxAgeMs);
});

test('observation age and future skew: exact boundaries', () => {
  assert.doesNotThrow(() => assertFresh(observedAt(5 * minute), nowMs));          // 300 s: accepted
  assert.throws(() => assertFresh(observedAt(5 * minute + 1), nowMs), /stale/);   // 300.001 s: stale
  assert.throws(() => assertFresh(observedAt(301 * second), nowMs), /stale/);     // SPEC-FRESHNESS 301 s
  assert.doesNotThrow(() => assertFresh(observedAt(-60 * second), nowMs));        // 60 s ahead: accepted
  assert.throws(() => assertFresh(observedAt(-60 * second - 1), nowMs), /future/);
  // Approved deviation from the handoff (5 s): 5 s and 6 s ahead are both accepted.
  assert.doesNotThrow(() => assertFresh(observedAt(-5 * second), nowMs));
  assert.doesNotThrow(() => assertFresh(observedAt(-6 * second), nowMs));
});

test('the evaluator applies the same observation limits through an explicit clock and fails closed', () => {
  const status = offsetMs => evaluateSnapshot(observedAt(offsetMs), { nowMs }).evaluation.multi_height_status;
  assert.equal(status(5 * minute), 'GO');
  assert.equal(status(5 * minute + 1), 'STOP');
  assert.equal(status(-60 * second), 'GO');
  assert.equal(status(-60 * second - 1), 'STOP');
  const stale = evaluateSnapshot(observedAt(5 * minute + 1), { nowMs }).evaluation;
  assert.deepEqual(stale.triggered_rules.map(rule => rule.code), ['DATA_INVALID']);
  assert.match(stale.triggered_rules[0].explanation, /older than 5 minutes/);
});

test('missing or invalid observation timestamps never count as fresh', () => {
  for (const timestamp of [undefined, null, '', 'yesterday', '2026-13-45T99:00:00Z'])
    assert.throws(() => assertFresh({ ...scenario('clear'), timestamp }, nowMs), /missing or invalid/, String(timestamp));
});

test('forecast issuance age and future skew: exact boundaries', () => {
  assert.equal(validateForecastIssuance(issued(6 * hour), nowMs).issuance_age_minutes, 360);
  assert.throws(() => validateForecastIssuance(issued(6 * hour + 1), nowMs), /too old \(older than 6 hours\)/);
  assert.doesNotThrow(() => validateForecastIssuance(issued(-5 * minute), nowMs));
  assert.throws(() => validateForecastIssuance(issued(-5 * minute - 1), nowMs), /future \(more than 5 minutes ahead\)/);
  // Approved deviation from the handoff (2 h old / 5 s ahead): SPEC-FORECAST-AGE's 7201 s and -7 s are accepted.
  assert.doesNotThrow(() => validateForecastIssuance(issued(7201 * second), nowMs));
  assert.doesNotThrow(() => validateForecastIssuance(issued(-7 * second), nowMs));
});

test('missing or invalid issuance timestamps are rejected, not replaced', () => {
  assert.throws(() => validateForecastIssuance({}, nowMs), /missing/);
  for (const value of ['', 'yesterday', '2026-11-15', '2026-11-15 18:00:00', 1763229600000, null])
    assert.throws(() => validateForecastIssuance({ updateTime: value }, nowMs), /Invalid/, String(value));
  // An invalid primary field is not silently replaced by a valid secondary field.
  assert.throws(() => validateForecastIssuance({ updateTime: 'bad', generatedAt: new Date(nowMs).toISOString() }, nowMs), /Invalid/);
  assert.throws(() => validateForecastIssuance(issued(0), NaN), TypeError);
});

// --- Loader: fresh responses, cached data, city isolation, deterministic clocks ---
const hourlyUrl = 'https://api.weather.gov/gridpoints/HNX/53,50/forecast/hourly';
const periodsFrom = startMs => Array.from({ length: 24 }, (_, i) => ({
  startTime: new Date(startMs + i * hour).toISOString(), endTime: new Date(startMs + (i + 1) * hour).toISOString(),
  windSpeed: '5 mph', windDirection: 'NW', temperature: 72, temperatureUnit: 'F', relativeHumidity: { value: 50 }, shortForecast: 'Sunny'
}));
const nws = (metadata, startMs = nowMs) => async url => ({ ok: true, json: async () => url === hourlyUrl
  ? { properties: { periods: periodsFrom(startMs), ...metadata } } : { properties: { forecastHourly: hourlyUrl } } });
const offline = async () => { throw new Error('Offline'); };
const memoryCache = () => { const map = new Map(); return { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v), map }; };
const profile = getProfile('contact_fungicide');

test('fresh responses: stale issuance is rejected even when every period is still valid', async () => {
  const atLimit = await loadOrchardForecast('fresno', profile, { nowMs, fetchImpl: nws(issued(6 * hour)) });
  assert.equal(atLimit.source, 'nws');
  const stale = await loadOrchardForecast('fresno', profile, { nowMs, fetchImpl: nws(issued(6 * hour + 1)) });
  assert.equal(stale.source, 'synthetic');
  assert.match(stale.error, /too old/);
  assert.equal(stale.issued_at, null);
  const ahead = await loadOrchardForecast('fresno', profile, { nowMs, fetchImpl: nws(issued(-5 * minute - 1)) });
  assert.equal(ahead.source, 'synthetic');
  assert.match(ahead.error, /future/);
});

test('issuance, valid time, retrieval time and the evaluation clock stay separate', async () => {
  const result = await loadOrchardForecast('fresno', profile, { nowMs, fetchImpl: nws(issued(90 * minute)) });
  assert.equal(result.issued_at, new Date(nowMs - 90 * minute).toISOString()); // source issue time
  assert.equal(result.fetched_at, new Date(nowMs).toISOString());              // retrieval time = supplied clock
  assert.equal(result.snapshots[0].timestamp, new Date(nowMs).toISOString());  // first valid period
  assert.equal(result.issuance_age_minutes, 90);
  assert.notEqual(result.issued_at, result.fetched_at);
});

test('cached data: the original issuance is rechecked on every read, a recent cache read never renews it', async () => {
  const cache = memoryCache();
  // Issued 5 h before the fetch; cached at nowMs.
  const live = await loadOrchardForecast('fresno', profile, { nowMs, cache, fetchImpl: nws(issued(5 * hour)) });
  assert.equal(live.source, 'nws');
  const oneHourLater = await loadOrchardForecast('fresno', profile, { nowMs: nowMs + hour, cache, fetchImpl: offline });
  assert.equal(oneHourLater.source, 'cached_nws');                 // issuance age exactly 6 h
  assert.equal(oneHourLater.issued_at, live.issued_at);
  assert.equal(oneHourLater.fetched_at, live.fetched_at);           // the cache read is not a new retrieval
  const justAfter = await loadOrchardForecast('fresno', profile, { nowMs: nowMs + hour + 1, cache, fetchImpl: offline });
  assert.equal(justAfter.source, 'synthetic');                     // issuance age 6 h + 1 ms, retrieval only 1 h old
});

test('cached data: coverage of the coming hours ends cache reuse before the 6-hour retrieval limit', async () => {
  // The cache keeps 24 hourly rows and is reused only while >= 20 of them are still ahead,
  // so a cached forecast stops being used about 4 hours after retrieval (issuance permitting).
  const cache = memoryCache();
  await loadOrchardForecast('fresno', profile, { nowMs, cache, fetchImpl: nws(issued(0)) });
  assert.equal((await loadOrchardForecast('fresno', profile, { nowMs: nowMs + 4 * hour, cache, fetchImpl: offline })).source, 'cached_nws');
  assert.equal((await loadOrchardForecast('fresno', profile, { nowMs: nowMs + 5 * hour, cache, fetchImpl: offline })).source, 'synthetic');
  // A retrieval time in the future (clock moved back) is never trusted.
  assert.equal((await loadOrchardForecast('fresno', profile, { nowMs: nowMs - 1, cache, fetchImpl: offline })).source, 'synthetic');
});

test('city isolation: one city\'s cached forecast is never served for another city', async () => {
  const cache = memoryCache();
  await loadOrchardForecast('fresno', profile, { nowMs, cache, fetchImpl: nws(issued(minute)) });
  assert.equal((await loadOrchardForecast('fresno', profile, { nowMs, cache, fetchImpl: offline })).source, 'cached_nws');
  for (const other of ['modesto', 'merced', 'bakersfield', 'chico', 'yuba_city']) {
    const result = await loadOrchardForecast(other, profile, { nowMs, cache, fetchImpl: offline });
    assert.equal(result.source, 'synthetic', other);
    assert.equal(result.issued_at, null, other);
  }
});

test('deterministic supplied clocks: same inputs and clock give the same result', async () => {
  const run = () => loadOrchardForecast('fresno', profile, { nowMs, fetchImpl: nws(issued(2 * hour)) });
  assert.deepEqual(await run(), await run());
  const a = validateForecastIssuance(issued(3 * hour), nowMs), b = validateForecastIssuance(issued(3 * hour), nowMs);
  assert.deepEqual(a, b);
  // The decision depends only on the supplied clock, not on when the test happens to run.
  assert.throws(() => validateForecastIssuance(issued(0), nowMs + 6 * hour + 1), /too old/);
});
