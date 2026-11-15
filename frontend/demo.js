import { evaluateSnapshot } from './engine/evaluate.js';
import { getProfile } from './engine/profiles.js';

// Only observations/forecasts are simulated; every evaluation uses the shared engine.
const input = {
  timestamp: '2026-11-15T14:45:00Z', // 6:45 AM PST
  scenario_name: 'Demo Trap: False Ground Calm with Upper Inversion',
  orchard_block: 'Block 4B - Nonpareil Almonds (Fresno, CA)',
  readings: {
    ground_5ft: { temp_f: 64, humidity_pct: 68, wind_speed_mph: 4.8, wind_dir_deg: 0, wind_dir_cardinal: 'N' },
    canopy_30ft: { temp_f: 68.5, humidity_pct: 52, wind_speed_mph: 12.4, wind_dir_deg: 95, wind_dir_cardinal: 'E' }
  },
  pesticide_profile: getProfile('contact_fungicide')
};
export const example = evaluateSnapshot(input);
export function evaluateDemo(snapshot,profile=snapshot.pesticide_profile,session) {
  return evaluateSnapshot({...structuredClone(snapshot),pesticide_profile:{...profile}},session?{session}:{});
}
export function scenario(name,profile) {
  if(!['trap','marginal','clear'].includes(name))throw new Error('Unknown demo scenario');
  const s=structuredClone(input);
  if(name==='marginal'){
    s.scenario_name='Demo: Marginal canopy wind and speed shear';
    Object.assign(s.readings.ground_5ft,{temp_f:78,wind_speed_mph:3.5,wind_dir_deg:90,wind_dir_cardinal:'E'});
    Object.assign(s.readings.canopy_30ft,{temp_f:76,wind_speed_mph:8.3,wind_dir_deg:100,wind_dir_cardinal:'E'});
  }
  if(name==='clear'){
    s.scenario_name='Demo: No atmospheric screening flags';
    Object.assign(s.readings.ground_5ft,{temp_f:69,wind_speed_mph:4.5,wind_dir_deg:90,wind_dir_cardinal:'E'});
    Object.assign(s.readings.canopy_30ft,{temp_f:67.5,wind_speed_mph:5.2,wind_dir_deg:100,wind_dir_cardinal:'E'});
  }
  return evaluateDemo(s,profile||s.pesticide_profile);
}
export function demoForecast(profile) {
  return Array.from({length:48},(_,i)=>{
    const hour=6+i/2;
    const name=hour>=9&&hour<13.5?'clear':hour>=13.5&&hour<17?'marginal':'trap';
    const s=scenario(name,profile);
    s.timestamp=new Date(Date.parse('2026-11-15T14:00:00Z')+i*1800000).toISOString();
    return s;
  });
}
