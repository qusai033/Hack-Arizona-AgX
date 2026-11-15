import {assertSnapshot, assertProfile} from './contract.js';
import {assertSession, SESSION_STATES} from './engine/session.js';
import {normalizeAuditRecord, AUDIT_SCHEMA_VERSION} from './audit-record.js';

const text = value => typeof value === 'string' && value.trim().length > 0;
export class IncompatibleAuditRecord extends TypeError {}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (condition, field) => { if (!condition) throw new TypeError(`Invalid audit ${field}.`); };
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const limits = ['minWind', 'maxWind', 'windCautionAbove', 'inversionStopAbove', 'speedShearCautionAt',
  'speedShearStopAt', 'directionCautionAt', 'directionStopAt', 'directionStopMinUpperWind', 'monitorHours'];

function validateEvidence(row) {
  const e = row.evidence, context = e.evaluation_context;
  check(row.event_id === row.id && Number.isSafeInteger(row.sequence_number) && row.sequence_number > 0, 'v2 identity');
  check(row.session === null || object(row.session), 'session');
  check(Object.keys(context).every(key => ['session', 'nowMs', 'maxAgeMs', 'labelProhibitsInversion', 'evaluationTimeMs'].includes(key)), 'context fields');
  if ('session' in context) assertSession(context.session);
  check(equal(context.session ?? null, row.session), 'session context');
  if ('nowMs' in context) check(Number.isFinite(context.nowMs), 'freshness reference time');
  if ('evaluationTimeMs' in context) {
    check(Number.isSafeInteger(context.evaluationTimeMs) && context.evaluationTimeMs >= 0 &&
      Number.isFinite(new Date(context.evaluationTimeMs).getTime()), 'explicit evaluation time');
  }
  if ('maxAgeMs' in context) check(Number.isFinite(context.nowMs) && Number.isFinite(context.maxAgeMs) && context.maxAgeMs > 0, 'freshness context');
  if ('labelProhibitsInversion' in context) check(typeof context.labelProhibitsInversion === 'boolean', 'label context');
  assertProfile(e.effective_profile);
  check(equal(e.effective_profile, row.session?.state === 'SPRAYING_IN_PROGRESS' ? row.session.pesticide_profile : row.snapshot.pesticide_profile), 'effective profile');
  const t = e.times, roles = {demo:'simulation_clock', forecast:'forecast_valid_time', live:'connected_observation', imported:'imported_observation'};
  check(iso(t.recorded_at) && t.recorded_at === row.recorded_at && t.snapshot_at === row.snapshot.timestamp, 'evidence timestamps');
  check(t.snapshot_time_role === (roles[row.source] ?? 'unverified'), 'timestamp role');
  for (const [field, source] of [['simulation_clock_at', 'demo'], ['forecast_valid_at', 'forecast'], ['observation_at', 'live']]) {
    check(t[field] === (row.source === source ? row.snapshot.timestamp : null), field);
  }
  // Older v2 and externally evaluated records have unknown evaluation clocks.
  // For newer built-in records the stored ISO instant MUST match the actual
  // evaluation boundary context, not the action recording timestamp.
  const explicitEvaluationAt=['demo','forecast'].includes(row.source) && 'evaluationTimeMs' in context
    ? new Date(context.evaluationTimeMs).toISOString() : null;
  check(t.evaluated_at === explicitEvaluationAt, 'independent evaluation time');
  if(row.source==='demo' && explicitEvaluationAt!==null) {
    check(Date.parse(t.evaluated_at)===Date.parse(t.simulation_clock_at), 'deterministic demo evaluation clock');
  }
  check(e.provenance === null || object(e.provenance), 'source provenance');
  if (e.provenance) {
    for (const key of ['issued_at', 'fetched_at']) if (key in e.provenance) check(e.provenance[key] === null || iso(e.provenance[key]), key);
    for (const key of ['kind', 'forecast_source', 'location_id', 'location_label', 'time_zone']) {
      if (key in e.provenance) check(text(e.provenance[key]), `provenance ${key}`);
    }
    if ('issuance_source' in e.provenance) check(e.provenance.issuance_source === null || text(e.provenance.issuance_source), 'issuance source');
  }
  if (!['demo', 'forecast'].includes(row.source)) {
    check(e.evaluator_kind === 'external_or_unverified' && e.engine_version === null && e.effective_thresholds === null &&
      e.diagnostics === null && e.reproduced_with_current_engine === false, 'external attribution');
    return;
  }
  check(e.evaluator_kind === 'canopyguard_builtin' && text(e.engine_version) && e.reproduced_with_current_engine === true, 'engine attribution');
  check(object(e.effective_thresholds) && limits.every(key => Number.isFinite(e.effective_thresholds[key]) && e.effective_thresholds[key] >= 0), 'effective thresholds');
  check(e.effective_thresholds.minWind <= e.effective_thresholds.maxWind, 'wind bounds');
  const d = e.diagnostics;
  check(object(d) && d.engine_version === e.engine_version && equal(d.thresholds, e.effective_thresholds), 'engine diagnostics');
  // New v2 records must preserve the evaluator's actual independent height
  // quality. Historical v2 records without this field remain valid and are
  // never rewritten or inferred from source timestamps.
  const actualQuality=row.snapshot.evaluation.data_quality;
  if(actualQuality!==undefined||d.data_quality!==undefined){
    check(actualQuality!==undefined&&equal(actualQuality,d.data_quality), 'per-height quality evidence');
    const expectedTime='evaluationTimeMs' in context?new Date(context.evaluationTimeMs).toISOString():null;
    check(actualQuality.evaluated_at===expectedTime,'evaluator-boundary quality time');
    if(context.nowMs!==undefined){
      check(actualQuality.assessment==='STRUCTURE_AND_AGE' &&
        actualQuality.age_ms===context.nowMs-Date.parse(row.snapshot.timestamp),'explicit observation age');
    }
  }
  for (const key of ['inversion_delta_f', 'speed_shear_mph', 'signed_speed_delta_mph', 'direction_shear_deg']) check(Number.isFinite(d[key]), `diagnostic ${key}`);
  check(object(d.wet_bulb), 'wet-bulb diagnostics');
  for (const height of ['ground_5ft', 'canopy_30ft']) {
    const w = d.wet_bulb[height];check(object(w) && typeof w.available === 'boolean', 'wet-bulb result');
    if (w.available) check(text(w.method) && ['dry_bulb_c', 'wet_bulb_c', 'depression_c', 'depression_f'].every(key => Number.isFinite(w[key])), 'wet-bulb values');
    else check(text(w.reason), 'unavailable wet-bulb reason');
  }
  if (row.session === null) check(d.session === null, 'absent treatment diagnostics');
  else {
    const s = d.session;
    check(object(s) && s.state === row.session.state && typeof s.monitoring === 'boolean' && typeof s.expired === 'boolean' &&
      (s.elapsed_hours === null || Number.isFinite(s.elapsed_hours)) && Number.isFinite(s.monitor_hours) && text(s.message), 'treatment diagnostics');
    check(s.alert === null || (object(s.alert) && text(s.alert.code) && ['GO','CAUTION','STOP'].includes(s.alert.severity) &&
      text(s.alert.metric) && text(s.alert.explanation)), 'treatment alert');
  }
}

/** Validate the complete #9 envelope without recomputing historical decisions.
 * Unknown schema versions stay on disk; v1 context is never invented.
 */
export function readAuditRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid audit record.');
  if ('schema_version' in value && ![1, AUDIT_SCHEMA_VERSION].includes(value.schema_version)) throw new IncompatibleAuditRecord('Unsupported audit schema version.');
  if (!text(value.id) || !text(value.event) || !text(value.source) ||
      typeof value.recorded_at !== 'string' || !Number.isFinite(Date.parse(value.recorded_at))) {
    throw new TypeError('Invalid audit identity or recording time.');
  }
  if (value.event_id !== undefined && value.event_id !== value.id) throw new TypeError('Conflicting event identity.');
  if (value.sequence_number !== undefined && (!Number.isSafeInteger(value.sequence_number) || value.sequence_number < 1)) {
    throw new TypeError('Invalid audit sequence.');
  }
  if (value.demo_run_id !== undefined && (value.source !== 'demo' || !text(value.demo_run_id))) {
    throw new TypeError('Invalid demo ownership.');
  }
  if ('context' in value || 'evaluation_context' in value) {
    throw new IncompatibleAuditRecord('An evidence-schema reader is required.');
  }
  assertSnapshot(value.snapshot);
  const row = normalizeAuditRecord(value);
  if (row.schema_version === AUDIT_SCHEMA_VERSION) {
    validateEvidence(row);
    return {record: row, warnings: []};
  }
  const warnings = [];
  if (value.session != null) {
    try { assertSession(value.session); }
    catch (error) {
      // The original afternoon demo stored only these two known fields.
      const s = value.session;
      if (!s || Object.keys(s).sort().join(',') !== 'pesticide_profile,state' || !SESSION_STATES.includes(s.state)) throw error;
      assertProfile(s.pesticide_profile);
      warnings.push('LEGACY_CONTEXT_UNAVAILABLE');
    }
  }
  return {record: row, warnings};
}
