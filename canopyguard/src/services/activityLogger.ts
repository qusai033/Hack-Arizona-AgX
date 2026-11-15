import type {
  ActivityLogEntry, AlertBannerState, EvaluationResult, LogEventType,
  RuleConfig, SpraySessionState, WeatherSnapshot,
} from '../types/canopy';

export const ACTIVITY_LOG_KEY = 'canopyguard_activity_log_v1';
export type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function computeReasonSignature(evaluation: EvaluationResult): string {
  return [...new Set(evaluation.triggered_rules.map(rule => `${rule.severity}:${rule.code}`))].sort().join('|');
}

export function createActivityLogEntry(
  eventId: string, sequenceNumber: number, eventType: LogEventType,
  recordedAtSimIso: string, sessionState: SpraySessionState,
  snapshot: WeatherSnapshot, ruleConfig: RuleConfig, evaluation: EvaluationResult,
): ActivityLogEntry {
  return structuredClone({
    event_id: eventId, sequence_number: sequenceNumber, event_type: eventType,
    recorded_at_sim_iso: recordedAtSimIso, session_state: sessionState,
    snapshot, rule_config: ruleConfig, evaluation,
    reason_signature: computeReasonSignature(evaluation),
  });
}

export function appendLogEntryIdempotent(existingEntries: ActivityLogEntry[], candidate: ActivityLogEntry): ActivityLogEntry[] {
  if (existingEntries.some(entry => entry.event_id === candidate.event_id)) return existingEntries;
  return [...existingEntries, structuredClone(candidate)];
}

export function shouldTriggerAlertToast(currentAlert: AlertBannerState | null, evaluation: EvaluationResult): boolean {
  return evaluation.status !== 'GO' && (
    currentAlert === null || currentAlert.severity !== evaluation.status ||
    currentAlert.reason_signature !== computeReasonSignature(evaluation)
  );
}

function csvCell(value: unknown): string {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Treat user-controlled text as text when opened in spreadsheet applications.
  // Numeric negative deltas retain their numeric representation.
  if (typeof value === 'string' && /^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportActivityLogsToCsv(entries: ActivityLogEntry[]): string {
  const header = [
    'event_id', 'sequence_number', 'event_type', 'recorded_at_sim_iso', 'session_state',
    'scenario_id', 'scenario_label', 'source', 'observed_at_iso',
    'ground_temp_f', 'ground_wind_speed_mph', 'ground_wind_dir_deg', 'ground_humidity_pct',
    'canopy_temp_f', 'canopy_wind_speed_mph', 'canopy_wind_dir_deg', 'canopy_humidity_pct',
    'profile_id', 'rule_version', 'multi_height_status', 'ground_only_status', 'hidden_risk_caught',
    'temp_delta_f', 'wind_speed_shear_mph', 'wind_dir_shear_deg',
    'headline', 'reason_signature', 'triggered_rules_json',
    'snapshot_json', 'rule_config_json', 'evaluation_json',
  ];
  const rows = entries.map(entry => {
    const { snapshot: s, evaluation: e, rule_config: c } = entry;
    return [
      entry.event_id, entry.sequence_number, entry.event_type, entry.recorded_at_sim_iso, entry.session_state,
      s.scenario_id, s.scenario_label, s.source, s.observed_at_iso,
      s.ground_5ft.temp_f, s.ground_5ft.wind_speed_mph, s.ground_5ft.wind_dir_deg, s.ground_5ft.humidity_pct,
      s.canopy_30ft.temp_f, s.canopy_30ft.wind_speed_mph, s.canopy_30ft.wind_dir_deg, s.canopy_30ft.humidity_pct,
      c.profile.id, e.rule_version, e.status, e.ground_only_baseline.status, e.hidden_risk_caught,
      e.metrics.temp_delta_f, e.metrics.wind_speed_shear_mph, e.metrics.wind_dir_shear_deg,
      e.headline, entry.reason_signature, e.triggered_rules, s, c, e,
    ];
  });
  return '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function triggerCsvDownload(csvContent: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Keep the object URL alive until the browser has begun consuming the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isLogEntry(value: unknown): value is ActivityLogEntry {
  if (!object(value) || typeof value.event_id !== 'string' || !value.event_id ||
      typeof value.sequence_number !== 'number' || !Number.isSafeInteger(value.sequence_number) ||
      typeof value.recorded_at_sim_iso !== 'string' || !Number.isFinite(Date.parse(value.recorded_at_sim_iso)) ||
      typeof value.event_type !== 'string' || typeof value.session_state !== 'string' ||
      typeof value.reason_signature !== 'string') return false;
  const s = value.snapshot, c = value.rule_config, e = value.evaluation;
  if (!object(s) || !object(s.ground_5ft) || !object(s.canopy_30ft) ||
      typeof s.scenario_label !== 'string' || typeof s.scenario_id !== 'string' ||
      !object(c) || !object(c.profile) || typeof c.profile.id !== 'string' ||
      !object(e) || typeof e.headline !== 'string' || !['GO', 'CAUTION', 'STOP'].includes(String(e.status)) ||
      !object(e.metrics) || !object(e.data_quality) || !Array.isArray(e.data_quality.issues) ||
      !object(e.ground_only_baseline) || !Array.isArray(e.triggered_rules)) return false;
  return e.triggered_rules.every(rule => object(rule) && typeof rule.code === 'string' &&
    typeof rule.severity === 'string' && typeof rule.plain_reason === 'string');
}

export function loadActivityLog(storage: StoragePort | null): { entries: ActivityLogEntry[]; warning: string | null } {
  if (!storage) return { entries: [], warning: 'Browser storage is unavailable. Keep this tab open and export CSV to retain the activity log.' };
  try {
    const raw = storage.getItem(ACTIVITY_LOG_KEY);
    if (!raw) return { entries: [], warning: null };
    const parsed: unknown = JSON.parse(raw);
    if (!object(parsed) || parsed.schema_version !== 1 || !Array.isArray(parsed.entries) || !parsed.entries.every(isLogEntry)) {
      throw new Error('Unrecognized log format');
    }
    const seen = new Set<string>();
    const entries = parsed.entries.filter(entry => {
      if (seen.has(entry.event_id)) return false;
      seen.add(entry.event_id);
      return true;
    });
    return { entries, warning: null };
  } catch {
    return { entries: [], warning: 'Saved activity could not be restored. A new log is open; export CSV to retain it.' };
  }
}

export function persistActivityLog(storage: StoragePort | null, entries: ActivityLogEntry[]): string | null {
  if (!storage) return 'Browser storage is unavailable. The activity log remains in this tab; export CSV to save it.';
  try {
    storage.setItem(ACTIVITY_LOG_KEY, JSON.stringify({ schema_version: 1, entries }));
    return null;
  } catch {
    return 'The browser could not save the activity log. It remains in this tab; export CSV before closing.';
  }
}
