/** Test doubles for teammate 4 integration. These do not implement agronomic rules. */
import type { CanopyPorts } from '../hooks/useCanopyGuard';
import type { EvaluationResult, RuleConfig, WeatherSnapshot } from '../types/canopy';
import type { StoragePort } from '../services/activityLogger';

export const testConfig: RuleConfig = {
  rule_version: 'test', stale_after_seconds: 300, max_forecast_issue_age_seconds: 7200,
  caution_wind_buffer_mph: 1.5, caution_dir_shear_deg: 45, min_wind_for_dir_shear_mph: 3,
  profile: {
    id: 'standard_orchard', label: 'Test profile (Illustrative)', is_illustrative: true,
    provenance_note: 'Only for orchestration tests', volatility_level: 'LOW',
    min_wind_mph: 3, max_wind_mph: 10, max_inversion_delta_f: 1,
    caution_inversion_delta_f: 0, max_speed_shear_mph: 6, max_dir_shear_deg: 75, post_spray_watch_hours: 2,
  },
};
export const testSnapshot: WeatherSnapshot = {
  snapshot_id: 'fixture', scenario_id: 'hidden_inversion_trap', scenario_label: 'Test scenario', tick_index: 0,
  observed_at_iso: '2026-11-15T14:00:00.000Z', source: 'SIMULATED_SCENARIO', simulated_stale: false, assumption_disclosure: null,
  ground_5ft: { height_ft: 5, temp_f: 64, wind_speed_mph: 4, wind_dir_deg: 0, humidity_pct: 50 },
  canopy_30ft: { height_ft: 30, temp_f: 62, wind_speed_mph: 5, wind_dir_deg: 10, humidity_pct: 50 },
};
export function testEvaluation(snapshot = testSnapshot, config = testConfig, time = snapshot.observed_at_iso): EvaluationResult {
  const stopped = snapshot.ground_5ft.temp_f === null || snapshot.ground_5ft.temp_f >= 80;
  return {
    evaluated_at_iso: time, rule_version: config.rule_version, profile_id: config.profile.id,
    status: stopped ? 'STOP' : 'GO', headline: stopped ? 'Test hazard' : 'Test checks passed',
    data_quality: { overall_status: 'VALID', ground_5ft_valid: true, canopy_30ft_valid: true, age_seconds: 0, is_stale: false, issues: [] },
    metrics: { temp_delta_f: -2, wind_speed_shear_mph: 1, wind_dir_shear_deg: 10 },
    triggered_rules: stopped ? [{
      code: 'INVERSION_STOP', severity: 'STOP', provenance: 'ILLUSTRATIVE_THRESHOLD', source_heights: [5, 30],
      is_upper_or_cross_height_hazard: true, metric_summary: 'Test threshold', plain_reason: 'Synthetic test rule only',
    }] : [],
    ground_only_baseline: { status: 'GO', data_quality: 'VALID', headline: 'Test baseline', evaluated_checks: [], unobservable_checks: [] },
    hidden_risk_caught: stopped,
  };
}
export function makePorts(): CanopyPorts {
  return {
    profiles: [testConfig.profile, { ...testConfig.profile, id: 'second_profile' }],
    getScenarioList: () => ['hidden_inversion_trap', 'second_scenario'].map(id => ({ id, label: id, description: '', default_tick_index: 0, frames: [structuredClone(testSnapshot)] })),
    getScenarioSnapshot: (id, tick, time) => ({ ...structuredClone(testSnapshot), scenario_id: id, scenario_label: id, snapshot_id: `${id}:${tick}:${time}`, tick_index: tick, observed_at_iso: time }),
    applyManualOverrides: (base, height, patch) => ({ ...base, [height === 5 ? 'ground_5ft' : 'canopy_30ft']: { ...(height === 5 ? base.ground_5ft : base.canopy_30ft), ...patch }, source: 'MANUAL_OVERRIDE' }),
    buildRuleConfig: id => ({ ...structuredClone(testConfig), profile: { ...testConfig.profile, id } }),
    evaluateSprayConditions: (snapshot, config, _session, time) => testEvaluation(snapshot, config, time),
  };
}
export function memoryStorage(): StoragePort {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
