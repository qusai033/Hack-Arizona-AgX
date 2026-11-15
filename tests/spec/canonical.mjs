// Independently transcribed from the final handoff, sections 2.1, 2.2 and Team 1.
// Never derive these expected inputs/results from the implementation under test.
export const SOURCE = {
  title: 'CanopyGuard — Final Canonical Implementation Plan & Handoff',
  file: 'Apply a final consistency patch to your latest Ca....pdf',
  sha256: 'bb296edcb1bee6cc224af91fff59b07458e259d7dd2d3ce412339343f5490e46',
  scope: 'Final Gemini handoff supplied by the user; the original challenge brief is unavailable.'
};
export const SPEC_TIME = '2026-11-15T14:00:00.000Z';
export const CONFIG = {
  rule_version: '1.0.0-demo', stale_after_seconds: 300,
  max_forecast_issue_age_seconds: 7200, caution_wind_buffer_mph: 1.5,
  caution_dir_shear_deg: 45, min_wind_for_dir_shear_mph: 3
};
export const PROFILES = [
  {
    id: 'standard_orchard', appId: 'contact_fungicide',
    label: 'Standard Contact Spray (Illustrative Demo Profile)',
    is_illustrative: true,
    provenance_note: 'Illustrative demo thresholds reflecting common 3-10 mph wind windows and positive temperature gradient inversion physics; not a product label.',
    volatility_level: 'LOW', min_wind_mph: 3, max_wind_mph: 10,
    max_inversion_delta_f: 1, caution_inversion_delta_f: 0,
    max_speed_shear_mph: 6, max_dir_shear_deg: 75, post_spray_watch_hours: 2
  },
  {
    id: 'high_volatility_demo', appId: 'volatile_formulation',
    label: 'High-Volatility Application (Illustrative Demo Profile)',
    is_illustrative: true,
    provenance_note: 'Illustrative tightened demo thresholds modeling heightened vapor drift sensitivity during temperature inversions; not a product label.',
    volatility_level: 'HIGH', min_wind_mph: 3, max_wind_mph: 8,
    max_inversion_delta_f: 0.2, caution_inversion_delta_f: -0.3,
    max_speed_shear_mph: 5, max_dir_shear_deg: 60, post_spray_watch_hours: 6
  },
  {
    id: 'fine_mist_canopy', appId: 'fine_airblast',
    label: 'Fine-Mist Canopy Airblast (Illustrative Demo Profile)',
    is_illustrative: true,
    provenance_note: 'Illustrative demo thresholds reflecting increased off-target drift susceptibility of fine droplets to upper-canopy wind shear.',
    volatility_level: 'MODERATE', min_wind_mph: 3.5, max_wind_mph: 9,
    max_inversion_delta_f: 0.8, caution_inversion_delta_f: 0,
    max_speed_shear_mph: 4.5, max_dir_shear_deg: 60, post_spray_watch_hours: 4
  }
];
const reading = (temp_f, wind_speed_mph, wind_dir_deg, humidity_pct) =>
  ({ temp_f, wind_speed_mph, wind_dir_deg, humidity_pct });
const rule = (code, severity = 'STOP') => ({ code, severity });
export const CASES = [
  {
    id: 'hidden_inversion_trap', appId: 'trap',
    ground: reading(64, 4.8, 355, 68), canopy: reading(68.5, 12.4, 85, 52),
    expected: { ground: 'GO', multi: 'STOP', hidden: true, rules: [
      rule('INVERSION_STOP'), rule('WIND_30FT_TOO_HIGH'),
      rule('SPEED_SHEAR_STOP'), rule('DIRECTIONAL_SHEAR_STOP')
    ] }
  },
  {
    id: 'favorable_mixing', appId: 'clear',
    ground: reading(72, 5.5, 310, 48), canopy: reading(70.2, 6.8, 320, 46),
    expected: { ground: 'GO', multi: 'GO', hidden: false, rules: [] }
  },
  {
    id: 'excessive_upper_wind', appId: 'excessive_upper_wind',
    ground: reading(69, 7.5, 180, 45), canopy: reading(67.4, 13.2, 190, 43),
    expected: { ground: 'GO', multi: 'STOP', hidden: true, rules: [rule('WIND_30FT_TOO_HIGH')] }
  },
  {
    id: 'threshold_boundary', appId: 'threshold_boundary',
    ground: reading(65, 3, 270, 55), canopy: reading(65.5, 9, 315, 52),
    expected: { ground: 'GO', multi: 'STOP', hidden: true, rules: [
      rule('SPEED_SHEAR_STOP'), rule('INVERSION_CAUTION', 'CAUTION'),
      rule('WIND_30FT_NEAR_LIMIT', 'CAUTION'), rule('DIRECTIONAL_SHEAR_CAUTION', 'CAUTION')
    ] }
  },
  {
    id: 'missing_stale_sensor', appId: 'missing_stale_sensor',
    ground: reading(66, 5, 200, 50), canopy: reading(null, 8, 210, 48),
    expected: { ground: 'GO', multi: 'STOP', hidden: false, rules: [rule('DATA_MISSING_OR_INVALID')] }
  }
];

// These normalize names only. They do not change inputs, limits, severity, or results.
export function ruleName(rule) {
  const names = {
    GROUND_WIND_TOO_CALM: 'WIND_5FT_TOO_LOW', UPPER_WIND_TOO_CALM: 'WIND_30FT_TOO_LOW',
    GROUND_WIND_EXCEEDED: 'WIND_5FT_TOO_HIGH', UPPER_WIND_EXCEEDED: 'WIND_30FT_TOO_HIGH',
    GROUND_WIND_CAUTION: 'WIND_5FT_NEAR_LIMIT', UPPER_WIND_CAUTION: 'WIND_30FT_NEAR_LIMIT',
    DATA_INVALID: 'DATA_MISSING_OR_INVALID', POST_SPRAY_VOLATILITY_ALERT: 'POST_SPRAY_VOLATILITY_WATCH'
  };
  if (rule.code === 'INVERSION_DETECTED') return `INVERSION_${rule.severity}`;
  if (rule.code === 'VERTICAL_WIND_SHEAR') return `SPEED_SHEAR_${rule.severity}`;
  if (rule.code === 'DIRECTIONAL_WIND_SHEAR') return `DIRECTIONAL_SHEAR_${rule.severity}`;
  return names[rule.code] ?? rule.code;
}
export const sortRules = rules => [...rules].sort((a, b) => a.code.localeCompare(b.code));
export function resultView(evaluation) {
  return {
    ground: evaluation.single_station_5ft_status,
    multi: evaluation.multi_height_status,
    hidden: evaluation.caught_hidden_risk,
    rules: sortRules(evaluation.triggered_rules.map(rule => ({ code: ruleName(rule), severity: rule.severity })))
  };
}
