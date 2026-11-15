import { deltas } from './contract.js';
import { hiddenRisk, reasons, localDate } from './audit.js';

export const CSV_UNAVAILABLE = '[UNAVAILABLE]';
const cellValue = value => value === undefined || value === null ? CSV_UNAVAILABLE : value;
const evidenceValue = (evidence, key) => evidence == null
  ? CSV_UNAVAILABLE
  : evidence[key] === undefined ? CSV_UNAVAILABLE : JSON.stringify(evidence[key]);
const timestampValue = (evidence, key) => evidence == null
  ? CSV_UNAVAILABLE
  : evidence.times?.[key] === undefined ? CSV_UNAVAILABLE : evidence.times[key] === null ? 'null' : evidence.times[key];
const localTime = (timestamp, zone) => {
  if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) return CSV_UNAVAILABLE;
  try { return localDate(timestamp, zone); } catch { return CSV_UNAVAILABLE; }
};

/** Spreadsheet-safe RFC 4180 cell. Preserve numeric values as numeric text;
 * neutralize formula-like user strings before quoting and escaping CSV syntax.
 */
export function csvCell(value) {
  let content = value === null || value === undefined
    ? ''
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && (/^[\\s\\uFEFF]*[=+@-]/u.test(content) || /^[\\t\\r\\n]/u.test(content))) {
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
  'Evaluation UTC', '5 ft humidity %', '5 ft wind bearing °', '30 ft humidity %', '30 ft wind bearing °',
  'Signed 30 ft minus 5 ft wind mph',
  // Machine-readable evidence. [UNAVAILABLE] denotes historical absence; JSON null stays JSON null.
  'Session JSON', 'Snapshot JSON', 'Effective thresholds JSON', 'Effective profile JSON',
  'Evaluation JSON', 'Evaluation context JSON', 'Diagnostics JSON', 'Source provenance JSON',
  'Timestamp evidence JSON'
]);

/** Export every record passed by the caller. UI filtering is applied before calling
 * this function, never by the 250-row audit-table rendering limit.
 */
export function auditCSV(records, zone) {
  if (!Array.isArray(records)) throw new TypeError('CSV records must be an array.');
  if (typeof zone !== 'string' || !zone.trim()) throw new TypeError('A time zone is required.');

  const rows = records.map(record => {
    const s = record.snapshot;
    const g = s.readings.ground_5ft;
    const c = s.readings.canopy_30ft;
    const d = deltas(s);
    const e = s.evaluation;
    const session = record.session;
    const evidence = record.evidence;
    const times = evidence?.times;
    const treatment = session?.pesticide_profile?.name;
    const activePesticide = session?.state === 'SPRAYING_IN_PROGRESS'
      ? treatment
      : s.pesticide_profile?.name;

    const scalar = (value) => value === undefined || value === null ? CSV_UNAVAILABLE : value;
    return [
      scalar(record.id),
      scalar(record.recorded_at),
      localTime(record.recorded_at, zone),
      zone,
      scalar(s.timestamp),
      localTime(s.timestamp, zone),
      scalar(record.source),
      scalar(record.event ?? record.event_type),
      scalar(session?.state),
      scalar(s.orchard_block),
      scalar(activePesticide),
      scalar(treatment),
      scalar(g.temp_f),
      scalar(g.wind_speed_mph),
      scalar(g.wind_dir_cardinal),
      scalar(c.temp_f),
      scalar(c.wind_speed_mph),
      scalar(c.wind_dir_cardinal),
      d.temperature,
      Math.abs(d.speed),
      d.direction,
      scalar(e.multi_height_status),
      reasons(s),
      scalar(e.single_station_5ft_status),
      hiddenRisk(s),

      scalar(record.event_id),
      scalar(record.sequence_number),
      scalar(record.schema_version),
      evidence == null ? CSV_UNAVAILABLE : scalar(evidence.evaluator_kind),
      evidence == null ? CSV_UNAVAILABLE : scalar(evidence.engine_version),
      evidence == null ? CSV_UNAVAILABLE : scalar(evidence.diagnostics?.rule_version ?? evidence.effective_thresholds?.rule_version),
      evidence == null ? CSV_UNAVAILABLE : scalar(times?.snapshot_time_role),
      timestampValue(evidence, 'simulation_clock_at'),
      timestampValue(evidence, 'forecast_valid_at'),
      timestampValue(evidence, 'evaluated_at'),
      scalar(g.humidity_pct),
      scalar(g.wind_dir_deg),
      scalar(c.humidity_pct),
      scalar(c.wind_dir_deg),
      d.speed,

      evidenceValue(evidence, 'session') === CSV_UNAVAILABLE
        ? (session === undefined ? CSV_UNAVAILABLE : JSON.stringify(session))
        : (session === undefined ? CSV_UNAVAILABLE : JSON.stringify(session)),
      JSON.stringify(s),
      evidenceValue(evidence, 'effective_thresholds'),
      evidenceValue(evidence, 'effective_profile'),
      JSON.stringify(e),
      evidenceValue(evidence, 'evaluation_context'),
      evidenceValue(evidence, 'diagnostics'),
      evidenceValue(evidence, 'provenance'),
      evidenceValue(evidence, 'times')
    ];
  });

  return [HEADERS, ...rows].map(row => row.map(csvCell).join(',')).join('\\r\\n') + '\\r\\n';
}
