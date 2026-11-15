/** TEAMMATE 1 STUB: static fixture adapter for integration; no evolving weather model. */
import { SCENARIO_DEFINITIONS } from '../data/scenarios';
import type { HeightReading, MeasurementHeight, ReadingPatch, WeatherSnapshot } from '../types/canopy';
export type { ScenarioDefinition } from '../types/canopy';

export function getScenarioList() { return structuredClone(SCENARIO_DEFINITIONS); }

export function getScenarioSnapshot(scenarioId: string, tickIndex: number, simNowIso: string): WeatherSnapshot {
  const scenario = SCENARIO_DEFINITIONS.find(item => item.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  const frame = structuredClone(scenario.frames[tickIndex % scenario.frames.length]);
  return { ...frame, snapshot_id: `${scenarioId}:${tickIndex}:${simNowIso}`, tick_index: tickIndex, observed_at_iso: simNowIso };
}

export function applyManualOverrides(base: WeatherSnapshot, height: MeasurementHeight, patch: ReadingPatch, simNowIso: string): WeatherSnapshot {
  const key = height === 5 ? 'ground_5ft' : 'canopy_30ft';
  const values = Object.fromEntries(Object.entries(patch).map(([name, value]) => [name,
    typeof value === 'number' && Number.isFinite(value) ? value : null,
  ]));
  return {
    ...base, [key]: { ...base[key], ...values }, source: 'MANUAL_OVERRIDE',
    snapshot_id: `${base.snapshot_id}:manual:${height}:${JSON.stringify(values)}`,
    observed_at_iso: simNowIso,
    // Editing one height must not silently rehabilitate stale data at the other height.
    simulated_stale: base.simulated_stale,
  };
}

export function validateHeightReading(reading: HeightReading) {
  const issues: string[] = [];
  for (const key of ['temp_f', 'wind_speed_mph', 'wind_dir_deg'] as const) {
    if (typeof reading[key] !== 'number' || !Number.isFinite(reading[key])) issues.push(`${key} is missing or invalid`);
  }
  if (reading.wind_speed_mph !== null && reading.wind_speed_mph < 0) issues.push('Wind speed must be nonnegative');
  if (reading.wind_dir_deg !== null && (reading.wind_dir_deg < 0 || reading.wind_dir_deg >= 360)) issues.push('Direction must be in [0, 360)');
  if (reading.humidity_pct !== null && (!Number.isFinite(reading.humidity_pct) || reading.humidity_pct < 0 || reading.humidity_pct > 100)) issues.push('Humidity must be in [0, 100]');
  return { valid: issues.length === 0, issues };
}
