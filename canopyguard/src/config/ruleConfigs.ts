/** TEAMMATE 2 SEED: exact illustrative values agreed in the handoff. */
import type { ApplicationProfile, RuleConfig } from '../types/canopy';

export const DEFAULT_RULE_VERSION = '1.0.0-demo';
export const DEFAULT_RULE_CONFIG_BASE: Omit<RuleConfig, 'profile'> = {
  rule_version: DEFAULT_RULE_VERSION, stale_after_seconds: 300,
  max_forecast_issue_age_seconds: 7200, caution_wind_buffer_mph: 1.5,
  caution_dir_shear_deg: 45, min_wind_for_dir_shear_mph: 3,
};
export const ILLUSTRATIVE_PROFILES: ApplicationProfile[] = [
  {
    id: 'standard_orchard', label: 'Standard Contact Spray (Illustrative Demo Profile)',
    is_illustrative: true, provenance_note: 'Illustrative demo thresholds; not a pesticide product label.',
    volatility_level: 'LOW', min_wind_mph: 3, max_wind_mph: 10,
    max_inversion_delta_f: 1, caution_inversion_delta_f: 0,
    max_speed_shear_mph: 6, max_dir_shear_deg: 75, post_spray_watch_hours: 2,
  },
  {
    id: 'high_volatility_demo', label: 'High-Volatility Application (Illustrative Demo Profile)',
    is_illustrative: true, provenance_note: 'Illustrative tightened thresholds; not a validated volatility model.',
    volatility_level: 'HIGH', min_wind_mph: 3, max_wind_mph: 8,
    max_inversion_delta_f: 0.2, caution_inversion_delta_f: -0.3,
    max_speed_shear_mph: 5, max_dir_shear_deg: 60, post_spray_watch_hours: 6,
  },
  {
    id: 'fine_mist_canopy', label: 'Fine-Mist Canopy Airblast (Illustrative Demo Profile)',
    is_illustrative: true, provenance_note: 'Illustrative fine-droplet thresholds; not a product label.',
    volatility_level: 'MODERATE', min_wind_mph: 3.5, max_wind_mph: 9,
    max_inversion_delta_f: 0.8, caution_inversion_delta_f: 0,
    max_speed_shear_mph: 4.5, max_dir_shear_deg: 60, post_spray_watch_hours: 4,
  },
];
export function buildRuleConfig(profileId: string): RuleConfig {
  const profile = ILLUSTRATIVE_PROFILES.find(item => item.id === profileId);
  if (!profile) throw new Error(`Unknown profile: ${profileId}`);
  return structuredClone({ ...DEFAULT_RULE_CONFIG_BASE, profile });
}
