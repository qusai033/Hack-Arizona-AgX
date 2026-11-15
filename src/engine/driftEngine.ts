// src/engine/driftEngine.ts

export type SeverityStatus = "GO" | "CAUTION" | "STOP";
export type VolatilityClass = "LOW" | "MEDIUM" | "HIGH";
export type DropletSizeClass = "COARSE" | "MEDIUM" | "FINE";
export type SpraySessionState =
  | "BEFORE_SPRAY"
  | "SPRAYING_IN_PROGRESS"
  | "POST_SPRAY_CURING";

export type PresetProfileId =
  | "STANDARD_FUNGICIDE"
  | "VOLATILE_ESTER"
  | "FINE_MIST_INSECTICIDE"
  | "DORMANT_OIL";

export interface HeightReading {
  temp_f: number;
  humidity_pct: number;
  wind_speed_mph: number;
  wind_dir_deg: number;
  wind_dir_cardinal: string;
}

export interface MultiHeightReadings {
  ground_5ft: HeightReading;
  canopy_30ft: HeightReading;
}

export interface PesticideProfile {
  id?: PresetProfileId | string;
  name: string;
  volatility_class: VolatilityClass;
  nozzle_droplet_size: DropletSizeClass;
  min_wind_mph: number;
  max_wind_mph: number;
  post_spray_monitor_hours: number;
  // Optional physics threshold overrides populated by presets
  caution_wind_mph?: number;
  inversion_stop_delta_f?: number;
  inversion_caution_delta_f?: number;
  speed_shear_caution_mph?: number;
  speed_shear_stop_mph?: number;
  dir_shear_caution_deg?: number;
  dir_shear_stop_deg?: number;
}

export interface ActiveSpraySession {
  state: SpraySessionState;
  hours_since_application?: number;
}

export interface TriggeredRule {
  code:
    | "INVERSION_DETECTED"
    | "UPPER_WIND_EXCEEDED"
    | "LOWER_WIND_EXCEEDED"
    | "UPPER_WIND_CAUTION"
    | "LOWER_WIND_CAUTION"
    | "WIND_TOO_CALM"
    | "VERTICAL_SPEED_SHEAR"
    | "DIRECTIONAL_WIND_SHEAR"
    | "HIGH_EVAPORATIVE_DELTA_T"
    | "POST_SPRAY_VOLATILITY_TRAP";
  severity: SeverityStatus;
  metric: string;
  explanation: string;
}

export interface ComputedDiagnostics {
  inversion_delta_t_f: number;
  wind_speed_shear_mph: number;
  wind_dir_shear_deg: number;
  evaporative_delta_t_5ft_f: number;
  evaporative_delta_t_30ft_f: number;
  wet_bulb_5ft_f: number;
  wet_bulb_30ft_f: number;
}

export interface DriftEvaluation {
  single_station_5ft_status: SeverityStatus;
  single_station_5ft_reason: string;
  multi_height_status: SeverityStatus;
  caught_hidden_risk: boolean;
  headline_reason: string;
  triggered_rules: TriggeredRule[];
  post_spray_volatility_risk: string;
  diagnostics?: ComputedDiagnostics;
}

export interface CanopyGuardPayload {
  timestamp: string;
  scenario_name: string;
  orchard_block: string;
  readings: MultiHeightReadings;
  pesticide_profile: PesticideProfile;
  active_spray_session?: ActiveSpraySession;
  evaluation: DriftEvaluation;
}

/**
 * STRETCH GOAL 1: Built-in Library of 4 Realistic Orchard Spray Profiles
 */
export const PESTICIDE_PROFILE_LIBRARY: Record<PresetProfileId, PesticideProfile> = {
  STANDARD_FUNGICIDE: {
    id: "STANDARD_FUNGICIDE",
    name: "Standard Contact Fungicide (Low Volatility / Coarse Nozzle)",
    volatility_class: "LOW",
    nozzle_droplet_size: "COARSE",
    min_wind_mph: 3.0,
    max_wind_mph: 10.0,
    caution_wind_mph: 8.0,
    post_spray_monitor_hours: 0,
    inversion_caution_delta_f: 0.0,
    inversion_stop_delta_f: 1.0,
    speed_shear_caution_mph: 4.0,
    speed_shear_stop_mph: 6.0,
    dir_shear_caution_deg: 45,
    dir_shear_stop_deg: 75,
  },
  VOLATILE_ESTER: {
    id: "VOLATILE_ESTER",
    name: "Volatile Ester Herbicide / Organophosphate (High Volatility / Medium Nozzle)",
    volatility_class: "HIGH",
    nozzle_droplet_size: "MEDIUM",
    min_wind_mph: 3.0,
    max_wind_mph: 8.0, // Tightened max wind limit
    caution_wind_mph: 6.5,
    post_spray_monitor_hours: 12, // 12-hour post-spray volatilization monitoring
    inversion_caution_delta_f: 0.0,
    inversion_stop_delta_f: 0.2, // Triggers STOP on any inversion ΔT > 0.2°F
    speed_shear_caution_mph: 4.0,
    speed_shear_stop_mph: 6.0,
    dir_shear_caution_deg: 45,
    dir_shear_stop_deg: 75,
  },
  FINE_MIST_INSECTICIDE: {
    id: "FINE_MIST_INSECTICIDE",
    name: "Fine-Mist Airblast Insecticide (Low Volatility / Fine Canopy Mist)",
    volatility_class: "LOW",
    nozzle_droplet_size: "FINE",
    min_wind_mph: 3.0,
    max_wind_mph: 10.0,
    caution_wind_mph: 8.0,
    post_spray_monitor_hours: 2,
    inversion_caution_delta_f: 0.0,
    inversion_stop_delta_f: 1.0,
    speed_shear_caution_mph: 3.0, // Heightened sensitivity to vertical shear
    speed_shear_stop_mph: 4.5, // Lowered vertical speed shear STOP threshold to 4.5 mph
    dir_shear_caution_deg: 35,
    dir_shear_stop_deg: 60,
  },
  DORMANT_OIL: {
    id: "DORMANT_OIL",
    name: "Dormant Horticultural Oil (Low Volatility / Coarse Droplets)",
    volatility_class: "LOW",
    nozzle_droplet_size: "COARSE",
    min_wind_mph: 2.0,
    max_wind_mph: 12.0, // Most forgiving baseline comparison profile
    caution_wind_mph: 10.0,
    post_spray_monitor_hours: 0,
    inversion_caution_delta_f: 0.5,
    inversion_stop_delta_f: 1.5,
    speed_shear_caution_mph: 5.0,
    speed_shear_stop_mph: 7.5,
    dir_shear_caution_deg: 60,
    dir_shear_stop_deg: 90,
  },
};

/**
 * Helper: Round to 1 decimal place for clean agronomic metrics
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Helper: Format signed delta values (e.g., "+4.5°F" or "-1.2°F")
 */
function formatSigned(value: number, unit = ""): string {
  const rounded = round1(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)}${unit}`;
}

/**
 * Helper: Shortest angular difference between two compass bearings (0-180 degrees)
 */
export function calculateDirectionalShearDeg(dirA: number, dirB: number): number {
  const diff = Math.abs(((dirA - dirB + 540) % 360) - 180);
  return Math.round(diff);
}

/**
 * Helper: Stull (2011) empirical psychrometric formula for Wet-Bulb Temperature
 * Returns Wet-Bulb Temperature (F) and Evaporative Delta-T (Dry Bulb - Wet Bulb in F).
 */
export function calculateEvaporativeDeltaT(
  tempF: number,
  rhPct: number
): { wetBulbF: number; deltaTF: number } {
  const rh = Math.max(1, Math.min(100, rhPct));
  const tempC = ((tempF - 32) * 5) / 9;

  const wetBulbC =
    tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tempC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035;

  const wetBulbF = (wetBulbC * 9) / 5 + 32;
  const deltaTF = Math.max(0, tempF - wetBulbF);

  return {
    wetBulbF: round1(wetBulbF),
    deltaTF: round1(deltaTF),
  };
}

/**
 * Resolves full threshold configuration by merging incoming pesticide_profile
 * with matching preset defaults or standard agronomic rules.
 */
export function resolveProfileThresholds(profile: PesticideProfile): Required<PesticideProfile> {
  const preset =
    profile.id && profile.id in PESTICIDE_PROFILE_LIBRARY
      ? PESTICIDE_PROFILE_LIBRARY[profile.id as PresetProfileId]
      : PESTICIDE_PROFILE_LIBRARY.STANDARD_FUNGICIDE;

  const maxWind = profile.max_wind_mph ?? preset.max_wind_mph;
  const defaultCautionWind =
    profile.caution_wind_mph ??
    (maxWind <= 8.0 ? round1(maxWind - 1.5) : 8.0);

  return {
    id: profile.id ?? preset.id ?? "CUSTOM_PROFILE",
    name: profile.name,
    volatility_class: profile.volatility_class,
    nozzle_droplet_size: profile.nozzle_droplet_size,
    min_wind_mph: profile.min_wind_mph ?? preset.min_wind_mph,
    max_wind_mph: maxWind,
    caution_wind_mph: defaultCautionWind,
    post_spray_monitor_hours:
      profile.post_spray_monitor_hours ?? preset.post_spray_monitor_hours,
    inversion_caution_delta_f:
      profile.inversion_caution_delta_f ?? preset.inversion_caution_delta_f ?? 0.0,
    inversion_stop_delta_f:
      profile.inversion_stop_delta_f ?? preset.inversion_stop_delta_f ?? 1.0,
    speed_shear_caution_mph:
      profile.speed_shear_caution_mph ??
      (profile.nozzle_droplet_size === "FINE" ? 3.0 : preset.speed_shear_caution_mph ?? 4.0),
    speed_shear_stop_mph:
      profile.speed_shear_stop_mph ??
      (profile.nozzle_droplet_size === "FINE" ? 4.5 : preset.speed_shear_stop_mph ?? 6.0),
    dir_shear_caution_deg:
      profile.dir_shear_caution_deg ?? preset.dir_shear_caution_deg ?? 45,
    dir_shear_stop_deg:
      profile.dir_shear_stop_deg ?? preset.dir_shear_stop_deg ?? 75,
  };
}

/**
 * Evaluates what a traditional 5 ft single weather station would conclude on its own
 * (blind to 30 ft upper-canopy winds and vertical thermal inversions).
 */
function evaluateSingleStation5ft(
  g5: HeightReading,
  thresholds: Required<PesticideProfile>
): { status: SeverityStatus; reason: string } {
  const evap5 = calculateEvaporativeDeltaT(g5.temp_f, g5.humidity_pct);

  if (g5.wind_speed_mph > thresholds.max_wind_mph) {
    return {
      status: "STOP",
      reason: `Ground wind at 5 ft is ${g5.wind_speed_mph.toFixed(1)} mph, exceeding the ${thresholds.max_wind_mph.toFixed(1)} mph label limit.`,
    };
  }

  if (g5.wind_speed_mph < thresholds.min_wind_mph) {
    return {
      status: "STOP",
      reason: `Ground wind at 5 ft is ${g5.wind_speed_mph.toFixed(1)} mph (below ${thresholds.min_wind_mph.toFixed(1)} mph minimum threshold), indicating stagnant air.`,
    };
  }

  if (g5.wind_speed_mph > thresholds.caution_wind_mph) {
    return {
      status: "CAUTION",
      reason: `Ground wind at 5 ft is ${g5.wind_speed_mph.toFixed(1)} mph, approaching the ${thresholds.max_wind_mph.toFixed(1)} mph upper limit.`,
    };
  }

  if (g5.temp_f > 85.0 && g5.humidity_pct < 25.0) {
    return {
      status: "CAUTION",
      reason: `High evaporative demand at 5 ft (${g5.temp_f.toFixed(1)}°F, ${g5.humidity_pct.toFixed(0)}% RH, Delta-T ${evap5.deltaTF.toFixed(1)}°F) risks droplet shrinkage.`,
    };
  }

  return {
    status: "GO",
    reason: `Ground wind is ${g5.wind_speed_mph.toFixed(1)} mph (within ${thresholds.min_wind_mph.toFixed(0)}-${thresholds.max_wind_mph.toFixed(0)} mph safe range) and temperature is ${g5.temp_f.toFixed(0)}°F.`,
  };
}

/**
 * MAIN ENGINE: Evaluates multi-height orchard telemetry + pesticide profile + session state
 * and returns the complete DriftEvaluation object conforming to the Shared JSON Contract.
 */
export function evaluateCanopyConditions(
  readings: MultiHeightReadings,
  rawProfile: PesticideProfile,
  orchardBlock = "Orchard Block",
  session: ActiveSpraySession = { state: "BEFORE_SPRAY" }
): DriftEvaluation {
  const thresholds = resolveProfileThresholds(rawProfile);
  const g5 = readings.ground_5ft;
  const c30 = readings.canopy_30ft;

  const triggeredRules: TriggeredRule[] = [];

  // ---------------------------------------------------------------------------
  // 1. TEMPERATURE INVERSION DETECTION (ΔT = Temp_30ft - Temp_5ft)
  // ---------------------------------------------------------------------------
  const inversionDeltaT = round1(c30.temp_f - g5.temp_f);

  if (inversionDeltaT > thresholds.inversion_stop_delta_f) {
    triggeredRules.push({
      code: "INVERSION_DETECTED",
      severity: "STOP",
      metric: `${formatSigned(inversionDeltaT, "°F")} (30ft: ${c30.temp_f.toFixed(1)}°F vs 5ft: ${g5.temp_f.toFixed(1)}°F)`,
      explanation: `Active temperature inversion detected: air at 30 ft is ${inversionDeltaT.toFixed(1)}°F warmer than at 5 ft. Warm air cap at 30 ft traps spray droplets near the ground; high lateral drift risk.`,
    });
  } else if (inversionDeltaT > thresholds.inversion_caution_delta_f) {
    triggeredRules.push({
      code: "INVERSION_DETECTED",
      severity: "CAUTION",
      metric: `${formatSigned(inversionDeltaT, "°F")} (30ft: ${c30.temp_f.toFixed(1)}°F vs 5ft: ${g5.temp_f.toFixed(1)}°F)`,
      explanation: `Air temperatures at 5 ft and 30 ft are equalizing (${formatSigned(inversionDeltaT, "°F")}). Thermal inversion is forming; prepare to halt spraying.`,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. MULTI-HEIGHT WIND SPEED CHECK (Evaluated at BOTH 5 ft and 30 ft)
  // ---------------------------------------------------------------------------
  // Check 30 ft canopy wind
  if (c30.wind_speed_mph > thresholds.max_wind_mph) {
    triggeredRules.push({
      code: "UPPER_WIND_EXCEEDED",
      severity: "STOP",
      metric: `${c30.wind_speed_mph.toFixed(1)} mph at 30ft (Limit: ${thresholds.max_wind_mph.toFixed(1)} mph)`,
      explanation:
        g5.wind_speed_mph <= thresholds.caution_wind_mph
          ? `Wind at 30 ft is ${c30.wind_speed_mph.toFixed(1)} mph, exceeding the ${thresholds.max_wind_mph.toFixed(1)} mph safe application limit despite calm ground air.`
          : `Wind at 30 ft is ${c30.wind_speed_mph.toFixed(1)} mph, exceeding the ${thresholds.max_wind_mph.toFixed(1)} mph safe application limit.`,
    });
  } else if (c30.wind_speed_mph > thresholds.caution_wind_mph) {
    triggeredRules.push({
      code: "UPPER_WIND_CAUTION",
      severity: "CAUTION",
      metric: `${c30.wind_speed_mph.toFixed(1)} mph at 30ft (Limit: ${thresholds.max_wind_mph.toFixed(1)} mph)`,
      explanation: `Wind at 30 ft is ${c30.wind_speed_mph.toFixed(1)} mph, approaching the ${thresholds.max_wind_mph.toFixed(1)} mph upper limit.`,
    });
  } else if (c30.wind_speed_mph < thresholds.min_wind_mph) {
    triggeredRules.push({
      code: "WIND_TOO_CALM",
      severity: inversionDeltaT > 0 ? "STOP" : "CAUTION",
      metric: `${c30.wind_speed_mph.toFixed(1)} mph at 30ft (Min: ${thresholds.min_wind_mph.toFixed(1)} mph)`,
      explanation: `Wind at 30 ft is ${c30.wind_speed_mph.toFixed(1)} mph (below ${thresholds.min_wind_mph.toFixed(1)} mph threshold). Very light winds often accompany inversions and move spray clouds unpredictably.`,
    });
  }

  // Check 5 ft ground wind
  if (g5.wind_speed_mph > thresholds.max_wind_mph) {
    triggeredRules.push({
      code: "LOWER_WIND_EXCEEDED",
      severity: "STOP",
      metric: `${g5.wind_speed_mph.toFixed(1)} mph at 5ft (Limit: ${thresholds.max_wind_mph.toFixed(1)} mph)`,
      explanation: `Wind at 5 ft is ${g5.wind_speed_mph.toFixed(1)} mph, exceeding the ${thresholds.max_wind_mph.toFixed(1)} mph safe application limit.`,
    });
  } else if (g5.wind_speed_mph > thresholds.caution_wind_mph) {
    triggeredRules.push({
      code: "LOWER_WIND_CAUTION",
      severity: "CAUTION",
      metric: `${g5.wind_speed_mph.toFixed(1)} mph at 5ft (Limit: ${thresholds.max_wind_mph.toFixed(1)} mph)`,
      explanation: `Wind at 5 ft is ${g5.wind_speed_mph.toFixed(1)} mph, approaching the ${thresholds.max_wind_mph.toFixed(1)} mph upper limit.`,
    });
  } else if (g5.wind_speed_mph < thresholds.min_wind_mph) {
    triggeredRules.push({
      code: "WIND_TOO_CALM",
      severity: inversionDeltaT > 0 ? "STOP" : "CAUTION",
      metric: `${g5.wind_speed_mph.toFixed(1)} mph at 5ft (Min: ${thresholds.min_wind_mph.toFixed(1)} mph)`,
      explanation: `Wind at 5 ft is ${g5.wind_speed_mph.toFixed(1)} mph (below ${thresholds.min_wind_mph.toFixed(1)} mph threshold). Very light winds often accompany inversions and move spray clouds unpredictably.`,
    });
  }

  // ---------------------------------------------------------------------------
  // 3. VERTICAL WIND SPEED SHEAR & DIRECTIONAL SHEAR (5 ft vs. 30 ft)
  // ---------------------------------------------------------------------------
  const speedShearMph = round1(Math.abs(c30.wind_speed_mph - g5.wind_speed_mph));
  const signedSpeedShear = round1(c30.wind_speed_mph - g5.wind_speed_mph);

  if (speedShearMph >= thresholds.speed_shear_stop_mph) {
    triggeredRules.push({
      code: "VERTICAL_SPEED_SHEAR",
      severity: "STOP",
      metric: `${formatSigned(signedSpeedShear, " mph")} shear (30ft: ${c30.wind_speed_mph.toFixed(1)} mph vs 5ft: ${g5.wind_speed_mph.toFixed(1)} mph)`,
      explanation: `Ground air feels calm (${g5.wind_speed_mph.toFixed(1)} mph), but wind above the canopy is ${c30.wind_speed_mph.toFixed(1)} mph (${formatSigned(signedSpeedShear, " mph")} shear). Plume tops will shear off and drift off-target.`,
    });
  } else if (speedShearMph >= thresholds.speed_shear_caution_mph) {
    triggeredRules.push({
      code: "VERTICAL_SPEED_SHEAR",
      severity: "CAUTION",
      metric: `${formatSigned(signedSpeedShear, " mph")} shear (30ft: ${c30.wind_speed_mph.toFixed(1)} mph vs 5ft: ${g5.wind_speed_mph.toFixed(1)} mph)`,
      explanation: `Ground air feels calm (${g5.wind_speed_mph.toFixed(1)} mph), but wind above the canopy is ${c30.wind_speed_mph.toFixed(1)} mph (${formatSigned(signedSpeedShear, " mph")} shear).`,
    });
  }

  const dirShearDeg = calculateDirectionalShearDeg(c30.wind_dir_deg, g5.wind_dir_deg);
  if (c30.wind_speed_mph > 4.0) {
    if (dirShearDeg >= thresholds.dir_shear_stop_deg) {
      triggeredRules.push({
        code: "DIRECTIONAL_WIND_SHEAR",
        severity: "STOP",
        metric: `${dirShearDeg}° shift (5ft: ${g5.wind_dir_cardinal} vs 30ft: ${c30.wind_dir_cardinal})`,
        explanation: `Wind direction shifts ${dirShearDeg}° between the orchard floor (${g5.wind_dir_cardinal}) and canopy top (${c30.wind_dir_cardinal}), creating severe cross-canopy drift toward unintended areas.`,
      });
    } else if (dirShearDeg >= thresholds.dir_shear_caution_deg) {
      triggeredRules.push({
        code: "DIRECTIONAL_WIND_SHEAR",
        severity: "CAUTION",
        metric: `${dirShearDeg}° shift (5ft: ${g5.wind_dir_cardinal} vs 30ft: ${c30.wind_dir_cardinal})`,
        explanation: `Wind direction shifts ${dirShearDeg}° between the orchard floor (${g5.wind_dir_cardinal}) and canopy top (${c30.wind_dir_cardinal}), creating cross-canopy drift toward unintended areas.`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. EVAPORATIVE / DELTA-T CHECK (Wet-Bulb Depression & Desiccation)
  // ---------------------------------------------------------------------------
  const evap5 = calculateEvaporativeDeltaT(g5.temp_f, g5.humidity_pct);
  const evap30 = calculateEvaporativeDeltaT(c30.temp_f, c30.humidity_pct);

  const hottestTemp = Math.max(g5.temp_f, c30.temp_f);
  const lowestRh = Math.min(g5.humidity_pct, c30.humidity_pct);
  const maxEvapDeltaT = Math.max(evap5.deltaTF, evap30.deltaTF);

  if (hottestTemp > 85.0 && lowestRh < 25.0) {
    const isExtremeFineMist =
      hottestTemp > 95.0 &&
      lowestRh < 15.0 &&
      thresholds.nozzle_droplet_size === "FINE";

    triggeredRules.push({
      code: "HIGH_EVAPORATIVE_DELTA_T",
      severity: isExtremeFineMist ? "STOP" : "CAUTION",
      metric: `Temp ${hottestTemp.toFixed(1)}°F / RH ${lowestRh.toFixed(0)}% (Evap Delta-T: ${maxEvapDeltaT.toFixed(1)}°F)`,
      explanation: `High evaporative demand (Temp ${hottestTemp.toFixed(1)}°F, RH ${lowestRh.toFixed(0)}%, wet-bulb depression ${maxEvapDeltaT.toFixed(1)}°F) shrinks spray droplets mid-air into drift-prone fines.`,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. STRETCH GOAL 3: DURING & AFTER SPRAY ACTIVE SESSION MONITOR
  // ---------------------------------------------------------------------------
  let postSprayVolatilityRisk = "LOW - Standard curing conditions.";
  const hoursElapsed = session.hours_since_application ?? 2;

  if (
    session.state === "POST_SPRAY_CURING" &&
    thresholds.volatility_class === "HIGH" &&
    hoursElapsed <= thresholds.post_spray_monitor_hours
  ) {
    if (inversionDeltaT > 1.0) {
      const shortBlock = orchardBlock.split(" - ")[0] || orchardBlock;
      postSprayVolatilityRisk = `WARNING: ${shortBlock} was treated ${hoursElapsed} hrs ago with a High-Volatility product. A ${formatSigned(inversionDeltaT, "°F")} inversion has formed, trapping chemical vapor. Alert nearby workers and restrict re-entry.`;

      triggeredRules.push({
        code: "POST_SPRAY_VOLATILITY_TRAP",
        severity: "STOP",
        metric: `${formatSigned(inversionDeltaT, "°F")} inversion (${hoursElapsed} hrs post-spray)`,
        explanation: postSprayVolatilityRisk,
      });
    } else if (inversionDeltaT > 0.0) {
      postSprayVolatilityRisk = `MODERATE-HIGH - Block treated ${hoursElapsed} hrs ago with High-Volatility product; near-isothermal layer (${formatSigned(inversionDeltaT, "°F")}) forming during ${thresholds.post_spray_monitor_hours}-hr curing window.`;
    } else {
      postSprayVolatilityRisk = `MODERATE - Active ${thresholds.post_spray_monitor_hours}-hr vapor monitoring window (${hoursElapsed} hrs elapsed). Normal vertical mixing (${formatSigned(inversionDeltaT, "°F")}).`;
    }
  } else if (thresholds.volatility_class === "HIGH") {
    if (inversionDeltaT > thresholds.inversion_stop_delta_f) {
      postSprayVolatilityRisk =
        "HIGH - Inversion traps vapor; halt application and monitor prior blocks.";
    } else if (inversionDeltaT > 0.0 || hottestTemp > 85.0) {
      postSprayVolatilityRisk =
        "ELEVATED - High-volatility formulation requires strict post-spray monitoring for 12 hours.";
    } else {
      postSprayVolatilityRisk = `MODERATE - Monitor block for ${thresholds.post_spray_monitor_hours} hours post-application for secondary vapor drift.`;
    }
  }

  // ---------------------------------------------------------------------------
  // 6. AGGREGATE MULTI-HEIGHT STATUS & HEADLINE GENERATION
  // ---------------------------------------------------------------------------
  const hasStop = triggeredRules.some((r) => r.severity === "STOP");
  const hasCaution = triggeredRules.some((r) => r.severity === "CAUTION");

  const multiHeightStatus: SeverityStatus = hasStop
    ? "STOP"
    : hasCaution
      ? "CAUTION"
      : "GO";

  const headlineReason = buildHeadlineReason(
    multiHeightStatus,
    inversionDeltaT,
    signedSpeedShear,
    dirShearDeg,
    c30,
    g5,
    thresholds,
    triggeredRules
  );

  // ---------------------------------------------------------------------------
  // 7. TIEBREAKER EVALUATOR: Single 5ft Station vs. CanopyGuard Multi-Height
  // ---------------------------------------------------------------------------
  const singleStation = evaluateSingleStation5ft(g5, thresholds);
  const caughtHiddenRisk =
    singleStation.status === "GO" && multiHeightStatus === "STOP";

  return {
    single_station_5ft_status: singleStation.status,
    single_station_5ft_reason: singleStation.reason,
    multi_height_status: multiHeightStatus,
    caught_hidden_risk: caughtHiddenRisk,
    headline_reason: headlineReason,
    triggered_rules: triggeredRules,
    post_spray_volatility_risk: postSprayVolatilityRisk,
    diagnostics: {
      inversion_delta_t_f: inversionDeltaT,
      wind_speed_shear_mph: speedShearMph,
      wind_dir_shear_deg: dirShearDeg,
      evaporative_delta_t_5ft_f: evap5.deltaTF,
      evaporative_delta_t_30ft_f: evap30.deltaTF,
      wet_bulb_5ft_f: evap5.wetBulbF,
      wet_bulb_30ft_f: evap30.wetBulbF,
    },
  };
}

/**
 * Generates an executive, tractor-cab-readable headline summarizing the primary decision drivers.
 */
function buildHeadlineReason(
  status: SeverityStatus,
  inversionDeltaT: number,
  signedSpeedShear: number,
  dirShearDeg: number,
  c30: HeightReading,
  g5: HeightReading,
  thresholds: Required<PesticideProfile>,
  rules: TriggeredRule[]
): string {
  if (status === "GO") {
    return `GO: Safe vertical mixing (${formatSigned(inversionDeltaT, "°F")} lapse) and steady winds (${g5.wind_speed_mph.toFixed(1)} mph at 5 ft, ${c30.wind_speed_mph.toFixed(1)} mph at 30 ft).`;
  }

  const parts: string[] = [];

  const invRule = rules.find((r) => r.code === "INVERSION_DETECTED");
  if (invRule) {
    parts.push(
      invRule.severity === "STOP"
        ? `Severe Temperature Inversion (${formatSigned(inversionDeltaT, "°F")} at 30 ft)`
        : `Forming Thermal Inversion (${formatSigned(inversionDeltaT, "°F")} at 30 ft)`
    );
  }

  const hasShearOrUpperWind = rules.some((r) =>
    ["UPPER_WIND_EXCEEDED", "VERTICAL_SPEED_SHEAR", "DIRECTIONAL_WIND_SHEAR"].includes(
      r.code
    )
  );
  if (hasShearOrUpperWind) {
    parts.push(
      `High Wind Shear (${formatSigned(signedSpeedShear, " mph")} / ${dirShearDeg}° shift above canopy)`
    );
  }

  const calmRule = rules.find((r) => r.code === "WIND_TOO_CALM");
  if (calmRule) {
    parts.push(`Stagnant Air (${ calmRule.metric })`);
  }

  const evapRule = rules.find((r) => r.code === "HIGH_EVAPORATIVE_DELTA_T");
  if (evapRule) {
    parts.push(`High Evaporative Delta-T (${evapRule.metric})`);
  }

  const postSprayRule = rules.find((r) => r.code === "POST_SPRAY_VOLATILITY_TRAP");
  if (postSprayRule && parts.length === 0) {
    parts.push(`Post-Spray Vapor Inversion Trap (${postSprayRule.metric})`);
  }

  if (parts.length === 0) {
    parts.push(rules[0]?.explanation ?? "Threshold exceeded.");
  }

  return `${status}: ${parts.join(" AND ")}.`;
}
