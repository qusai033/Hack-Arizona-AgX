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
/** Input completeness/freshness, not evidence of an on-site sensor or agronomic accuracy. */
export interface HeightInputQuality {
  status: 'VALID' | 'INVALID' | 'STALE' | 'FUTURE';
  /** Observation age from context.nowMs, null if no freshness clock was supplied. */
  age_ms: number | null;
  issues: string[];
}
export interface InputQuality {
  overall_status: 'VALID' | 'INVALID_OR_STALE';
  assessment: 'STRUCTURE_ONLY' | 'STRUCTURE_AND_AGE';
  age_ms: number | null;
  /** Explicit evaluator boundary time; never inferred from forecast-valid time. */
  evaluated_at: string | null;
  issues: string[];
  ground_5ft: HeightInputQuality;
  canopy_30ft: HeightInputQuality;
}
export interface TriggeredRule {
  code: string;
  severity: Status;
  metric: string;
  explanation: string;
  /** Absent in historical/imported evaluations; when present, policy provenance
   * must never imply a registered product label or a verified field measurement.
   */
  provenance?: 'ILLUSTRATIVE_THRESHOLD' | 'SAFETY_FAILSAFE';
  /** Height(s) involved in the screening rule, in feet. */
  source_heights?: (5 | 30)[];
  is_upper_or_cross_height_hazard?: boolean;
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
    triggered_rules: TriggeredRule[];
    /** Optional for historical v1/v2 records and externally supplied results. */
    data_quality?: InputQuality;
    post_spray_volatility_risk: string;
    /** A valid, qualified upper/cross-height STOP that ground-only checks missed.
     * Never credit a data-integrity fail-safe; optional for historical imports.
     */
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
  /** Explicit evaluation-boundary Unix time, independent of nowMs freshness checks.
   * For demo this is the deterministic simulation clock; for NWS the
   * screening execution clock, not the future forecast-valid time.
   */
  evaluationTimeMs?: number;
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
    /** Timestamp from evaluation_context.evaluationTimeMs when built-in and
     * supplied. Older v2 and externally evaluated records remain null.
     * It is never inferred from recorded_at or snapshot_at.
     */
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
