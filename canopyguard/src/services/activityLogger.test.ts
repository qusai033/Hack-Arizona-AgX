import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_LOG_KEY, appendLogEntryIdempotent, computeReasonSignature, createActivityLogEntry,
  exportActivityLogsToCsv, loadActivityLog, persistActivityLog, shouldTriggerAlertToast,
} from './activityLogger';
import { memoryStorage, testConfig, testEvaluation, testSnapshot } from '../test/fixtures';
import type { AlertBannerState } from '../types/canopy';

function entry(id: string) {
  return createActivityLogEntry(id, 1, 'MANUAL_SNAPSHOT_RECORDED', testSnapshot.observed_at_iso, 'IDLE', testSnapshot, testConfig, testEvaluation());
}
describe('activity event evidence', () => {
  it('retains distinct actions with identical values and ignores reprocessing of one ID', () => {
    const first = entry('one');
    const entries = appendLogEntryIdempotent([first], entry('two'));
    expect(entries).toHaveLength(2);
    expect(appendLogEntryIdempotent(entries, entry('one'))).toBe(entries);
  });
  it('takes independent copies of inputs, configuration and results', () => {
    const snapshot = structuredClone(testSnapshot), config = structuredClone(testConfig), evaluation = testEvaluation();
    const stored = createActivityLogEntry('one', 1, 'DEMO_INIT', snapshot.observed_at_iso, 'IDLE', snapshot, config, evaluation);
    snapshot.ground_5ft.temp_f = 99; config.profile.max_wind_mph = 100; evaluation.headline = 'changed';
    expect(stored.snapshot.ground_5ft.temp_f).toBe(64);
    expect(stored.rule_config.profile.max_wind_mph).toBe(10);
    expect(stored.evaluation.headline).toBe('Test checks passed');
  });
  it('persists and reloads full records, including configuration and multiple reasons', () => {
    const storage = memoryStorage(), entries = [entry('one'), entry('two')];
    expect(persistActivityLog(storage, entries)).toBeNull();
    expect(loadActivityLog(storage)).toEqual({ entries, warning: null });
  });
  it.each(['broken JSON', JSON.stringify({ schema_version: 1, entries: [{ event_id: 'malformed' }] })])('falls back safely for corrupt saved data', raw => {
    const storage = memoryStorage(); storage.setItem(ACTIVITY_LOG_KEY, raw);
    expect(loadActivityLog(storage).entries).toEqual([]);
    expect(loadActivityLog(storage).warning).toContain('could not be restored');
  });
  it('reports storage failures while leaving in-memory records intact', () => {
    const entries = [entry('one')];
    const storage = { ...memoryStorage(), setItem: () => { throw new Error('Quota exceeded'); } };
    expect(persistActivityLog(storage, entries)).toContain('export CSV');
    expect(entries).toHaveLength(1);
    expect(loadActivityLog(null).warning).toContain('unavailable');
  });
});

describe('CSV export', () => {
  it('escapes punctuation/newlines, preserves full evidence, and represents missing values', () => {
    const e = entry('csv');
    e.snapshot.scenario_label = 'Block "A", north\nSecond line';
    e.snapshot.canopy_30ft.temp_f = null;
    const csv = exportActivityLogsToCsv([e]);
    expect(csv.startsWith('\uFEFF"event_id"')).toBe(true);
    expect(csv).toContain('"Block ""A"", north\nSecond line"');
    expect(csv).toContain('"snapshot_json","rule_config_json","evaluation_json"');
    expect(csv).toContain('""temp_f"":null');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
  it('exports an empty log with headers and neutralizes spreadsheet formulas in text', () => {
    expect(exportActivityLogsToCsv([]).split('\r\n')).toHaveLength(2);
    const e = entry('formula'); e.evaluation.headline = '=HYPERLINK("https://example.com")';
    const csv = exportActivityLogsToCsv([e]);
    expect(csv).toContain('"\'=HYPERLINK(');
    expect(csv).toContain('"-2"'); // Numeric negative differences remain numeric.
  });
});

describe('notifications', () => {
  it('does not repeat a dismissed alert until severity or reason changes', () => {
    const evaluation = testEvaluation({ ...testSnapshot, ground_5ft: { ...testSnapshot.ground_5ft, temp_f: 90 } });
    const alert: AlertBannerState = {
      alert_id: 'one', source_event_id: 'one', triggered_at_sim_iso: testSnapshot.observed_at_iso,
      severity: 'STOP', headline: evaluation.headline, reason_signature: computeReasonSignature(evaluation), dismissed: true,
    };
    expect(shouldTriggerAlertToast(alert, evaluation)).toBe(false);
    evaluation.triggered_rules.push({ ...evaluation.triggered_rules[0], code: 'SPEED_SHEAR_STOP' });
    expect(shouldTriggerAlertToast(alert, evaluation)).toBe(true);
    expect(shouldTriggerAlertToast(null, testEvaluation())).toBe(false);
  });
});
