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
  };
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
