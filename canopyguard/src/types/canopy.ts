/** Shared contract. Teammate 4 owns changes; coordinate before changing an export. */
export type RiskStatus = 'GO' | 'CAUTION' | 'STOP';
export type DataSource = 'SIMULATED_SCENARIO' | 'MANUAL_OVERRIDE' | 'NWS_REGIONAL_ESTIMATE';
export type SpraySessionState = 'IDLE' | 'ACTIVE_SPRAY' | 'POST_SPRAY_WATCH';
export type DataQualityStatus = 'VALID' | 'INVALID_OR_STALE';
export type MeasurementHeight = 5 | 30;
export type RuleProvenance = 'ILLUSTRATIVE_THRESHOLD' | 'SAFETY_FAILSAFE';
export type RuleCode =
  | 'DATA_MISSING_OR_INVALID' | 'DATA_STALE' | 'FORECAST_ISSUANCE_STALE'
  | 'INVERSION_STOP' | 'INVERSION_CAUTION'
  | 'WIND_5FT_TOO_LOW' | 'WIND_5FT_TOO_HIGH' | 'WIND_5FT_NEAR_LIMIT'
  | 'WIND_30FT_TOO_LOW' | 'WIND_30FT_TOO_HIGH' | 'WIND_30FT_NEAR_LIMIT'
  | 'SPEED_SHEAR_STOP' | 'DIRECTIONAL_SHEAR_STOP'
  | 'DIRECTIONAL_SHEAR_CAUTION' | 'POST_SPRAY_VOLATILITY_WATCH';
export type LogEventType =
  | 'DEMO_INIT' | 'SIMULATION_TICK' | 'SCENARIO_CHANGED'
  | 'MANUAL_OVERRIDE_APPLIED' | 'PROFILE_CHANGED'
  | 'SESSION_STATE_CHANGED' | 'MANUAL_SNAPSHOT_RECORDED';

export interface HeightReading {
  height_ft: MeasurementHeight;
  temp_f: number | null;
  wind_speed_mph: number | null;
  wind_dir_deg: number | null;
  humidity_pct: number | null;
}
export interface WeatherSnapshot {
  snapshot_id: string;
  scenario_id: string;
  scenario_label: string;
  tick_index: number;
  observed_at_iso: string;
  source: DataSource;
  simulated_stale: boolean;
  assumption_disclosure: string | null;
  ground_5ft: HeightReading;
  canopy_30ft: HeightReading;
}
export interface ApplicationProfile {
  id: string;
  label: string;
  is_illustrative: true;
  provenance_note: string;
  volatility_level: 'LOW' | 'MODERATE' | 'HIGH';
  min_wind_mph: number;
  max_wind_mph: number;
  max_inversion_delta_f: number;
  caution_inversion_delta_f: number;
  max_speed_shear_mph: number;
  max_dir_shear_deg: number;
  post_spray_watch_hours: number;
}
export interface RuleConfig {
  rule_version: string;
  stale_after_seconds: number;
  max_forecast_issue_age_seconds: number;
  caution_wind_buffer_mph: number;
  caution_dir_shear_deg: number;
  min_wind_for_dir_shear_mph: number;
  profile: ApplicationProfile;
}
export interface TriggeredRule {
  code: RuleCode;
  severity: RiskStatus;
  provenance: RuleProvenance;
  source_heights: MeasurementHeight[];
  is_upper_or_cross_height_hazard: boolean;
  metric_summary: string;
  plain_reason: string;
}
export interface DataQualityReport {
  overall_status: DataQualityStatus;
  ground_5ft_valid: boolean;
  canopy_30ft_valid: boolean;
  age_seconds: number;
  is_stale: boolean;
  issues: string[];
}
export interface GroundOnlyBaseline {
  status: RiskStatus;
  data_quality: DataQualityStatus;
  headline: string;
  evaluated_checks: string[];
  unobservable_checks: string[];
}
export interface EvaluationResult {
  evaluated_at_iso: string;
  rule_version: string;
  profile_id: string;
  data_quality: DataQualityReport;
  status: RiskStatus;
  headline: string;
  metrics: {
    temp_delta_f: number | null;
    wind_speed_shear_mph: number | null;
    wind_dir_shear_deg: number | null;
  };
  triggered_rules: TriggeredRule[];
  ground_only_baseline: GroundOnlyBaseline;
  hidden_risk_caught: boolean;
}
export interface ActivityLogEntry {
  event_id: string;
  sequence_number: number;
  event_type: LogEventType;
  recorded_at_sim_iso: string;
  session_state: SpraySessionState;
  snapshot: WeatherSnapshot;
  rule_config: RuleConfig;
  evaluation: EvaluationResult;
  reason_signature: string;
}
export interface AlertBannerState {
  alert_id: string;
  source_event_id: string;
  triggered_at_sim_iso: string;
  severity: 'CAUTION' | 'STOP';
  headline: string;
  reason_signature: string;
  dismissed: boolean;
}
export interface ForecastSnapshot {
  issued_at_iso: string;
  valid_at_iso: string;
  location_label: string;
  snapshot: WeatherSnapshot;
}
export interface CandidateForecastWindow {
  issued_at_iso: string;
  start_valid_iso: string;
  end_valid_iso: string;
  status: RiskStatus;
  requires_local_confirmation: true;
  assumption_disclosure: string;
  note: string;
}
/** Centralized to avoid a data/service type dependency cycle. */
export interface ScenarioDefinition {
  id: string;
  label: string;
  description: string;
  default_tick_index: number;
  frames: WeatherSnapshot[];
}
export type ReadingPatch = Partial<Omit<HeightReading, 'height_ft'>>;
