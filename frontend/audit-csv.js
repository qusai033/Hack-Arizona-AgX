import { deltas } from './contract.js';
import { recordDay } from './audit-calendar.js';

export const CSV_UNAVAILABLE = '[UNAVAILABLE]';
const unavailable = value => value === undefined || value === null ? CSV_UNAVAILABLE : value;
const jsonEvidence = (evidence, key) => evidence == null || evidence[key] === undefined
  ? CSV_UNAVAILABLE
  : JSON.stringify(evidence[key]);
const evidenceScalar = (evidence, key) => evidence == null || !Object.hasOwn(evidence, key)
  ? CSV_UNAVAILABLE
  : evidence[key] === null ? 'null' : evidence[key];
const timeEvidence = (evidence, key) => {
  if (evidence == null || evidence.times === undefined || !(key in evidence.times)) return CSV_UNAVAILABLE;
  return evidence.times[key] === null ? 'null' : evidence.times[key];
};
const localTime = (timestamp, zone) => {
  if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) return CSV_UNAVAILABLE;
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'short', timeStyle: 'medium', timeZone: zone
    }).format(new Date(timestamp));
  } catch {
    return CSV_UNAVAILABLE;
  }
};
const observationDate = (record, zone) => {
  try { return recordDay(record, zone); } catch { return CSV_UNAVAILABLE; }
};
const hiddenRisk = snapshot => snapshot.evaluation.caught_hidden_risk ??
  (snapshot.evaluation.single_station_5ft_status === 'GO' && snapshot.evaluation.multi_height_status === 'STOP');
const reasons = snapshot => snapshot.evaluation.triggered_rules
  .map(rule => rule.code + ': ' + rule.metric + '. ' + rule.explanation).join(' | ') ||
  snapshot.evaluation.headline_reason;

/** RFC 4180 quoting plus spreadsheet-formula neutralization for text cells.
 * Numeric values are intentionally not rewritten, including negative deltas.
 */
export function csvCell(value) {
  let content = value === null || value === undefined
    ? ''
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && (/^[\s\uFEFF]*[=+@-]/u.test(content) || /^[\t\r\n]/u.test(content))) {
    content = "'" + content;
  }
  return '"' + content.replaceAll('"', '""') + '"';
}

const HEADERS = Object.freeze([
  // Existing PCA-facing columns, retained in their original order.
  'Log ID', 'Recorded UTC', 'Recorded local', 'Time zone', 'Observation UTC', 'Observation local',
  'Source', 'Event', 'Session state', 'Orchard block', 'Active pesticide', 'Recorded treatment',
  '5 ft °F', '5 ft mph', '5 ft wind from', '30 ft °F', '30 ft mph', '30 ft wind from',
  'Canopy minus ground °F', 'Absolute speed shear mph', 'Direction shift degrees',
  'Multi-height status', 'Trigger reasons', 'Single-station status', 'Hidden risk caught',
  // Event, measurement, timestamp, and version metadata.
  'Event ID', 'Sequence number', 'Record schema version', 'Evaluator kind', 'Engine version',
  'Rule/config version', 'Observation time role', 'Simulation clock UTC', 'Forecast valid UTC',
  'Observation UTC (provenance)', 'Evaluation UTC', '5 ft humidity %', '5 ft wind bearing °',
  '30 ft humidity %', '30 ft wind bearing °', 'Signed 30 ft minus 5 ft wind mph',
  // Complete machine-readable evidence. Historical absence is explicit, never inferred.
  'Session JSON', 'Snapshot JSON', 'Effective thresholds JSON', 'Effective profile JSON',
  'Evaluation JSON', 'Evaluation context JSON', 'Diagnostics JSON', 'Source provenance JSON',
  'Timestamp evidence JSON', 'Audit evidence JSON', 'Demo run ID',
  // Calendar date the record is filed under in the daily history (see audit-calendar.js).
  'Observation date'
]);

/** Export every record passed by the caller. The UI applies its selected filter before
 * calling this function; the 250-row table display limit is not applied to exports.
 */
export function auditCSV(records, zone) {
  if (!Array.isArray(records)) throw new TypeError('CSV records must be an array.');
  if (typeof zone !== 'string' || !zone.trim()) throw new TypeError('A time zone is required.');

  const rows = records.map(record => {
    if (!record || typeof record !== 'object' || !record.snapshot?.readings || !record.snapshot?.evaluation) {
      throw new TypeError('Each CSV record must contain a snapshot and evaluation.');
    }
    const snapshot = record.snapshot;
    const ground = snapshot.readings.ground_5ft;
    const canopy = snapshot.readings.canopy_30ft;
    const difference = deltas(snapshot);
    const evaluation = snapshot.evaluation;
    const session = record.session;
    const evidence = record.evidence;
    const times = evidence?.times;
    const appliedProfile = session?.pesticide_profile?.name;
    const activePesticide = session?.state === 'SPRAYING_IN_PROGRESS'
      ? appliedProfile
      : snapshot.pesticide_profile?.name;
    const ruleConfigVersion = evidence?.diagnostics?.rule_version ??
      evidence?.effective_thresholds?.rule_version;

    return [
      unavailable(record.id),
      unavailable(record.recorded_at),
      localTime(record.recorded_at, zone),
      zone,
      unavailable(snapshot.timestamp),
      localTime(snapshot.timestamp, zone),
      unavailable(record.source),
      unavailable(record.event ?? record.event_type),
      unavailable(session?.state),
      unavailable(snapshot.orchard_block),
      unavailable(activePesticide),
      unavailable(appliedProfile),
      unavailable(ground.temp_f),
      unavailable(ground.wind_speed_mph),
      unavailable(ground.wind_dir_cardinal),
      unavailable(canopy.temp_f),
      unavailable(canopy.wind_speed_mph),
      unavailable(canopy.wind_dir_cardinal),
      difference.temperature,
      Math.abs(difference.speed),
      difference.direction,
      unavailable(evaluation.multi_height_status),
      reasons(snapshot),
      unavailable(evaluation.single_station_5ft_status),
      hiddenRisk(snapshot),

      unavailable(record.event_id),
      unavailable(record.sequence_number),
      unavailable(record.schema_version),
      evidence == null ? CSV_UNAVAILABLE : unavailable(evidence.evaluator_kind),
      evidenceScalar(evidence, 'engine_version'),
      evidence == null ? CSV_UNAVAILABLE : unavailable(ruleConfigVersion),
      evidence == null ? CSV_UNAVAILABLE : unavailable(times?.snapshot_time_role),
      timeEvidence(evidence, 'simulation_clock_at'),
      timeEvidence(evidence, 'forecast_valid_at'),
      timeEvidence(evidence, 'observation_at'),
      timeEvidence(evidence, 'evaluated_at'),
      unavailable(ground.humidity_pct),
      unavailable(ground.wind_dir_deg),
      unavailable(canopy.humidity_pct),
      unavailable(canopy.wind_dir_deg),
      difference.speed,

      Object.hasOwn(record, 'session') ? JSON.stringify(session) : CSV_UNAVAILABLE,
      JSON.stringify(snapshot),
      jsonEvidence(evidence, 'effective_thresholds'),
      jsonEvidence(evidence, 'effective_profile'),
      JSON.stringify(evaluation),
      jsonEvidence(evidence, 'evaluation_context'),
      jsonEvidence(evidence, 'diagnostics'),
      jsonEvidence(evidence, 'provenance'),
      jsonEvidence(evidence, 'times'),
      evidence == null ? CSV_UNAVAILABLE : JSON.stringify(evidence),
      unavailable(record.demo_run_id),
      observationDate(record, zone)
    ];
  });

  return [HEADERS, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
