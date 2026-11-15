export type Status = 'GO' | 'CAUTION' | 'STOP';
export interface Reading {
  temp_f: number;
  humidity_pct: number;
  wind_speed_mph: number;
  /** Meteorological direction FROM, clockwise from north. */
  wind_dir_deg: number;
  wind_dir_cardinal: string;
}
export interface PesticideProfile {
  name: string;
  volatility_class: 'LOW' | 'MEDIUM' | 'HIGH';
  nozzle_droplet_size: 'COARSE' | 'MEDIUM' | 'FINE';
  min_wind_mph: number;
  max_wind_mph: number;
  post_spray_monitor_hours: number;
}
export interface CanopySnapshot {
  timestamp: string;
  scenario_name: string;
  orchard_block: string;
  readings: { ground_5ft: Reading; canopy_30ft: Reading };
  pesticide_profile: PesticideProfile;
  evaluation: {
    single_station_5ft_status: Status;
    single_station_5ft_reason: string;
    multi_height_status: Status;
    headline_reason: string;
    triggered_rules: { code: string; severity: Status; metric: string; explanation: string }[];
    post_spray_volatility_risk: string;
    /** v1.1: engine always emits this; optional only for legacy v1 imports. */
    caught_hidden_risk?: boolean;
  };
}
export type WeatherInput = Omit<CanopySnapshot, 'evaluation'> & {evaluation?: CanopySnapshot['evaluation']};
export interface SpraySession {
  state: 'BEFORE_SPRAY' | 'SPRAYING_IN_PROGRESS' | 'POST_SPRAY_CURING';
  orchard_block: string;
  /** Frozen profile actually applied; independent of the current selector. */
  pesticide_profile: PesticideProfile;
  started_at: string | null;
  ended_at: string | null;
  inversion_at_end_f: number | null;
}
export interface EvaluationContext {
  session?: SpraySession;
  nowMs?: number;
  maxAgeMs?: number;
  labelProhibitsInversion?: boolean;
}
/** Assigned once at the action boundary; recorded_at is real UTC, not simulation time. */
export interface ActionEvent<Type extends string = string, Payload = Record<string, unknown>> {
  event_id: string;
  event_type: Type;
  recorded_at: string;
  payload: Payload;
}
export type DemoEvent =
  | ActionEvent<'SCENARIO_SELECTED', {name: 'trap' | 'marginal' | 'clear' | 'calm' | 'evaporation' | 'afternoon'}>
  | ActionEvent<'FRAME_SELECTED', {minute: number}>
  | ActionEvent<'PROFILE_CHANGED', {profile: PesticideProfile}>
  | ActionEvent<'READING_CHANGED', {height: 'ground_5ft' | 'canopy_30ft'; field: 'temp_f' | 'humidity_pct' | 'wind_speed_mph' | 'wind_dir_deg'; value: number}>
  | ActionEvent<'DEMO_RESET' | 'SIMULATION_STEP' | 'SIMULATION_TICK' | 'OVERRIDES_RESET' | 'SESSION_STARTED' | 'SESSION_FINISHED' |
      'SESSION_RESET' | 'SESSION_EXAMPLE' | 'MANUAL_SNAPSHOT_RECORDED'>;
export interface AuditRecord {
  id: string;
  /** Optional only for legacy records. For new records this equals id. */
  event_id?: string;
  sequence_number?: number;
  recorded_at: string;
  event: string;
  source: string;
  /** Present only for explicitly owned demo activity; reset never infers ownership. */
  demo_run_id?: string;
  session: SpraySession | null;
  snapshot: CanopySnapshot;
}
/** Forecast entries are the same shared contract, one per evenly spaced interval. */
export interface DashboardAdapter {
  mode: 'live';
  timeZone?: string;
  pollMs?: number;
  maxAgeMs?: number;
  forecastIntervalMinutes?: number;
  loadSnapshot(): Promise<CanopySnapshot>;
  evaluateProfile?(snapshot: CanopySnapshot, profile: PesticideProfile): Promise<CanopySnapshot>;
  /** Must evaluate forecasts for this profile. NWS alone is not a multi-height measurement. */
  loadForecast?(profile: PesticideProfile): Promise<CanopySnapshot[]>;
}

/** Audit v2: evidence is stored in addition to the immutable snapshot/result.
 * Older v1 records load with evidence=null, never invented diagnostics.
 */
export interface AuditEvidenceV2 {
  schema_version: 2;
  evaluator_kind: 'canopyguard_builtin' | 'external_or_unverified';
  engine_version: string | null;
  /** Frozen policy applied to the exact evaluated record; null for external engines. */
  effective_thresholds: Record<string, number> | null;
  effective_profile: PesticideProfile;
  evaluation_context: EvaluationContext;
  diagnostics: Record<string, unknown> | null;
  reproduced_with_current_engine: boolean;
  provenance: Record<string, unknown> | null;
  times: {
    recorded_at: string | null;
    snapshot_at: string;
    snapshot_time_role: string;
    simulation_clock_at: string | null;
    forecast_valid_at: string | null;
    observation_at: string | null;
    evaluated_at: string | null;
  };
}
export interface AuditRecordV2 {
  schema_version: 2;
  id: string;
  event_id: string;
  sequence_number: number;
  recorded_at: string;
  event: string;
  source: string;
  /** Only explicitly identified demo runs can be reset. */
  demo_run_id?: string;
  session: SpraySession | null;
  snapshot: CanopySnapshot;
  evidence: AuditEvidenceV2;
}
export interface HistoricalAuditRecordV1 {
  schema_version: 1;
  id: string;
  recorded_at: string;
  source: string;
  snapshot: CanopySnapshot;
  /** Older sessions can be incomplete; do not manufacture missing times. */
  session?: Partial<SpraySession> | null;
  evidence: null;
}
