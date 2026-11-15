// src/engine/demoScenarios.ts
import {
  evaluateCanopyConditions,
  PESTICIDE_PROFILE_LIBRARY,
  CanopyGuardPayload,
} from "./driftEngine";

// Scenario A: Shared Data Contract Demo Trap
export function runSharedContractDemoTrap(): CanopyGuardPayload {
  const readings = {
    ground_5ft: {
      temp_f: 64.0,
      humidity_pct: 68.0,
      wind_speed_mph: 4.8,
      wind_dir_deg: 0,
      wind_dir_cardinal: "N",
    },
    canopy_30ft: {
      temp_f: 68.5,
      humidity_pct: 52.0,
      wind_speed_mph: 12.4,
      wind_dir_deg: 95,
      wind_dir_cardinal: "E",
    },
  };

  const pesticide_profile = {
    name: "Chlorpyrifos / High-Volatility Ester",
    volatility_class: "HIGH" as const,
    nozzle_droplet_size: "FINE" as const,
    min_wind_mph: 3.0,
    max_wind_mph: 10.0,
    post_spray_monitor_hours: 6,
  };

  const orchard_block = "Block 4B - Nonpareil Almonds (Fresno, CA)";

  return {
    timestamp: "2026-11-15T06:45:00Z",
    scenario_name: "Demo Trap: False Ground Calm with Upper Inversion",
    orchard_block,
    readings,
    pesticide_profile,
    active_spray_session: {
      state: "BEFORE_SPRAY",
    },
    evaluation: evaluateCanopyConditions(
      readings,
      pesticide_profile,
      orchard_block,
      { state: "BEFORE_SPRAY" }
    ),
  };
}

// Scenario B: Post-Spray Curing Volatility Trap (2 Hours After Spraying)
export function runPostSprayCuringTrap(): CanopyGuardPayload {
  const readings = {
    ground_5ft: {
      temp_f: 61.2,
      humidity_pct: 74.0,
      wind_speed_mph: 2.4,
      wind_dir_deg: 180,
      wind_dir_cardinal: "S",
    },
    canopy_30ft: {
      temp_f: 65.0, // +3.8°F inversion formed 2 hours after application
      humidity_pct: 58.0,
      wind_speed_mph: 3.5,
      wind_dir_deg: 210,
      wind_dir_cardinal: "SSW",
    },
  };

  const pesticide_profile = PESTICIDE_PROFILE_LIBRARY.VOLATILE_ESTER;
  const orchard_block = "Block 4B - Nonpareil Almonds (Fresno, CA)";
  const active_spray_session = {
    state: "POST_SPRAY_CURING" as const,
    hours_since_application: 2,
  };

  return {
    timestamp: "2026-11-15T18:30:00Z",
    scenario_name: "Post-Spray Trap: Evening Inversion Over Curing Block",
    orchard_block,
    readings,
    pesticide_profile,
    active_spray_session,
    evaluation: evaluateCanopyConditions(
      readings,
      pesticide_profile,
      orchard_block,
      active_spray_session
    ),
  };
}
