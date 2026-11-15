/** TEAMMATE 2 STUB. Always STOP/pending. Replace with the agreed pure risk evaluator. */
import type { EvaluationResult, RuleConfig, SpraySessionState, WeatherSnapshot } from '../types/canopy';

export function computeAngularDifferenceDeg(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function evaluateSprayConditions(
  _snapshot: WeatherSnapshot, config: RuleConfig,
  _sessionState: SpraySessionState, evaluationTimeIso: string,
): EvaluationResult {
  return {
    evaluated_at_iso: evaluationTimeIso, rule_version: config.rule_version, profile_id: config.profile.id,
    status: 'STOP', headline: 'Risk evaluation pending — integration preview only',
    data_quality: {
      overall_status: 'INVALID_OR_STALE', ground_5ft_valid: false, canopy_30ft_valid: false,
      age_seconds: 0, is_stale: false, issues: ['The teammate 2 risk evaluator has not been connected. Data quality is not assessed.'],
    },
    metrics: { temp_delta_f: null, wind_speed_shear_mph: null, wind_dir_shear_deg: null },
    triggered_rules: [], hidden_risk_caught: false,
    ground_only_baseline: {
      status: 'STOP', data_quality: 'INVALID_OR_STALE', headline: 'Evaluation pending',
      evaluated_checks: [], unobservable_checks: ['30 ft temperature', 'Upper-canopy wind', 'Vertical wind shear'],
    },
  };
}
