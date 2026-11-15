/** TEAMMATE 1 STUB: agreed frame-zero fixtures only; replace with evolving scenarios. */
import type { HeightReading, ScenarioDefinition } from '../types/canopy';

const definitions = [
  ['hidden_inversion_trap', 'Hidden canopy risk', 'Warm upper air and stronger canopy wind.',
    [64, 4.8, 355, 68], [68.5, 12.4, 85, 52]],
  ['favorable_mixing', 'Favorable conditions', 'Reference fixture for favorable conditions.',
    [72, 5.5, 310, 48], [70.2, 6.8, 320, 46]],
  ['excessive_upper_wind', 'Upper wind', 'Stronger wind above the canopy.',
    [69, 7.5, 180, 45], [67.4, 13.2, 190, 43]],
  ['threshold_boundary', 'Threshold boundaries', 'Exact thresholds for engine integration.',
    [65, 3, 270, 55], [65.5, 9, 315, 52]],
  ['missing_stale_sensor', 'Missing canopy reading', 'A missing reading must not become a detected hazard.',
    [66, 5, 200, 50], [null, 8, 210, 48]],
] as const;

export const SCENARIO_DEFINITIONS: ScenarioDefinition[] = definitions.map(
  ([id, label, description, ground, canopy]) => {
    const reading = (height: 5 | 30, values: readonly (number | null)[]): HeightReading => ({
      height_ft: height, temp_f: values[0], wind_speed_mph: values[1],
      wind_dir_deg: values[2], humidity_pct: values[3],
    });
    return {
      id, label, description, default_tick_index: 0,
      frames: [{
        snapshot_id: `${id}:0`, scenario_id: id, scenario_label: label, tick_index: 0,
        observed_at_iso: '2026-11-15T14:00:00.000Z', source: 'SIMULATED_SCENARIO',
        simulated_stale: false, assumption_disclosure: 'Static scaffold fixture; playback model pending teammate 1.',
        ground_5ft: reading(5, ground), canopy_30ft: reading(30, canopy),
      }],
    };
  },
);
