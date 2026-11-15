import { assertSnapshot, deltas, signed } from './contract.js';

// Presentation fixtures ONLY. These thresholds are not validated pesticide guidance.
// Live mode always consumes the team's evaluation; it never calls evaluateDemo.
export const example = {
  timestamp: '2026-11-15T06:45:00Z',
  scenario_name: 'Demo Trap: False Ground Calm with Upper Inversion',
  orchard_block: 'Block 4B - Nonpareil Almonds (Fresno, CA)',
  readings: {
    ground_5ft: { temp_f: 64, humidity_pct: 68, wind_speed_mph: 4.8, wind_dir_deg: 0, wind_dir_cardinal: 'N' },
    canopy_30ft: { temp_f: 68.5, humidity_pct: 52, wind_speed_mph: 12.4, wind_dir_deg: 95, wind_dir_cardinal: 'E' }
  },
  pesticide_profile: { name: 'Chlorpyrifos / High-Volatility Ester', volatility_class: 'HIGH', nozzle_droplet_size: 'FINE', min_wind_mph: 3, max_wind_mph: 10, post_spray_monitor_hours: 6 },
  evaluation: {
    single_station_5ft_status: 'GO',
    single_station_5ft_reason: 'Ground wind is 4.8 mph (within 3–10 mph demo range) and temperature is 64°F.',
    multi_height_status: 'STOP',
    headline_reason: 'Warm air is trapping spray. Winds above the trees exceed the profile limit.',
    triggered_rules: [
      { code: 'INVERSION_DETECTED', severity: 'STOP', metric: '+4.5°F (30ft: 68.5°F vs 5ft: 64.0°F)', explanation: 'Warm air above the canopy can trap fine droplets below it, increasing lateral drift risk.' },
      { code: 'UPPER_WIND_EXCEEDED', severity: 'STOP', metric: '12.4 mph at 30ft (Limit: 10.0 mph)', explanation: 'Above-canopy winds exceed the demo profile limit even though ground wind is within range.' },
      { code: 'DIRECTIONAL_WIND_SHEAR', severity: 'CAUTION', metric: '95° shift (5ft: N vs 30ft: E)', explanation: 'Wind direction changes between the ground and tree tops.' }
    ],
    post_spray_volatility_risk: 'HIGH — Inversion may trap vapor; halt application and monitor prior blocks.'
  }
};

export function evaluateDemo(snapshot, profile = snapshot.pesticide_profile) {
  const s = structuredClone(snapshot);
  s.pesticide_profile = structuredClone(profile);
  const { ground_5ft:g, canopy_30ft:c } = s.readings, d = deltas(s), rules = [];
  const add = (code,severity,metric,explanation) => rules.push({code,severity,metric,explanation});
  const groundOK = g.wind_speed_mph >= profile.min_wind_mph && g.wind_speed_mph <= profile.max_wind_mph;
  if (d.temperature > 0) add('INVERSION_DETECTED','STOP',`${signed(d.temperature)}°F (30ft: ${c.temp_f.toFixed(1)}°F vs 5ft: ${g.temp_f.toFixed(1)}°F)`,'Warm air above the canopy can trap fine droplets below it, increasing lateral drift risk.');
  if (c.wind_speed_mph > profile.max_wind_mph) add('UPPER_WIND_EXCEEDED','STOP',`${c.wind_speed_mph.toFixed(1)} mph at 30ft (Limit: ${profile.max_wind_mph.toFixed(1)} mph)`,'Above-canopy winds exceed the demo profile limit even though ground wind may be within range.');
  if (!groundOK) add('GROUND_WIND_OUTSIDE_RANGE','STOP',`${g.wind_speed_mph.toFixed(1)} mph at 5ft`,'Ground wind is outside this demo profile’s range.');
  if (d.direction >= 45) add('DIRECTIONAL_WIND_SHEAR','CAUTION',`${Math.round(d.direction)}° shift (5ft: ${g.wind_dir_cardinal} vs 30ft: ${c.wind_dir_cardinal})`,'Wind direction changes between the ground and tree tops.');
  if (profile.volatility_class === 'HIGH' && c.temp_f >= 75) add('DEMO_VOLATILITY','CAUTION',`High volatility · ${c.temp_f.toFixed(1)}°F`,'In this demo, a high-volatility profile adds caution in warmer air.');
  if (profile.nozzle_droplet_size === 'FINE' && c.wind_speed_mph >= 7) add('DEMO_FINE_DROPLETS','CAUTION',`Fine droplets · ${c.wind_speed_mph.toFixed(1)} mph`,'In this demo, fine droplets add caution at this wind speed.');
  const status = rules.some(r=>r.severity==='STOP') ? 'STOP' : rules.length ? 'CAUTION' : 'GO';
  s.evaluation = {
    single_station_5ft_status: groundOK ? 'GO' : 'STOP',
    single_station_5ft_reason: `Ground wind is ${g.wind_speed_mph.toFixed(1)} mph (${groundOK?'within':'outside'} the ${profile.min_wind_mph}–${profile.max_wind_mph} mph demo range).`,
    multi_height_status:status,
    headline_reason:status==='STOP' ? (d.temperature>0 ? 'Warm air is trapping spray. Wait for conditions to improve.' : 'Wind exceeds the demo profile range. Wait for conditions to improve.') : status==='CAUTION' ? 'Conditions are marginal for this pesticide and nozzle combination.' : 'Both sensor heights are within this demo profile’s checks.',
    triggered_rules:rules,
    post_spray_volatility_risk:profile.volatility_class==='HIGH' ? 'HIGH — Continue checking conditions after application.' : `${profile.volatility_class} — Continue post-spray monitoring for the selected profile.`
  };
  return assertSnapshot(s);
}

export function scenario(name, profile) {
  const s = structuredClone(example);
  if (name === 'trap' && !profile) return s;
  if (name === 'marginal') {
    s.scenario_name = 'Demo: Marginal afternoon conditions';
    Object.assign(s.readings.ground_5ft, { temp_f:78, wind_speed_mph:5, wind_dir_deg:90, wind_dir_cardinal:'E' });
    Object.assign(s.readings.canopy_30ft, { temp_f:76, wind_speed_mph:8, wind_dir_deg:100, wind_dir_cardinal:'E' });
  }
  if (name === 'clear') {
    s.scenario_name = 'Demo: Well-mixed morning';
    Object.assign(s.readings.ground_5ft, { temp_f:69, wind_speed_mph:4.5, wind_dir_deg:90, wind_dir_cardinal:'E' });
    Object.assign(s.readings.canopy_30ft, { temp_f:67.5, wind_speed_mph:5.2, wind_dir_deg:100, wind_dir_cardinal:'E' });
  }
  return evaluateDemo(s, profile || s.pesticide_profile);
}

export function demoForecast(profile) {
  // 24 hours from 06:00 PST, half-hour slots. GO window 09:00–13:30.
  return Array.from({length:48}, (_,i) => {
    const hour = 6 + i / 2;
    const name = hour>=9 && hour<13.5 ? 'clear' : hour>=13.5 && hour<17 ? 'marginal' : 'trap';
    const s = scenario(name,profile);
    s.timestamp = new Date(Date.parse('2026-11-15T14:00:00Z') + i*1800000).toISOString();
    return s;
  });
}
