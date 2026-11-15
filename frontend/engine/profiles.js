import { assertProfile } from '../contract.js';

// Generic screening presets, not registrations, product labels, or tank-mix advice.
// No active ingredient is inferred to be volatile from its chemical family alone.
const preset = (name,volatility_class,nozzle_droplet_size,max_wind_mph,post_spray_monitor_hours) => Object.freeze({name,volatility_class,nozzle_droplet_size,min_wind_mph:3,max_wind_mph,post_spray_monitor_hours});
export const PROFILES = Object.freeze({
  contact_fungicide:preset('Standard Contact Fungicide','LOW','COARSE',10,6),
  volatile_formulation:preset('Volatile Ester / Volatile Formulation (Generic)','HIGH','MEDIUM',8,12),
  fine_airblast:preset('Fine-Mist Airblast Insecticide','LOW','FINE',10,6),
  dormant_oil:preset('Dormant Horticultural Oil','LOW','COARSE',10,6)
});
export function getProfile(id) {
  if (!Object.hasOwn(PROFILES,id)) throw new TypeError(`Unknown profile: ${id}`);
  return {...PROFILES[id]};
}
export function thresholdsFor(profile) {
  assertProfile(profile);
  const limits={
    // Presets never loosen a stricter supplied label-derived limit.
    minWind:Math.max(3,profile.min_wind_mph),
    maxWind:Math.min(profile.volatility_class==='HIGH'?8:10,profile.max_wind_mph),
    windCautionAbove:8,
    inversionStopAbove:profile.volatility_class==='HIGH'?0.2:1,
    speedShearCautionAt:4,
    speedShearStopAt:profile.nozzle_droplet_size==='FINE'?4.5:6,
    directionCautionAt:45,
    directionStopAt:75,
    directionStopMinUpperWind:4,
    monitorHours:profile.volatility_class==='HIGH'?Math.max(12,profile.post_spray_monitor_hours):profile.post_spray_monitor_hours
  };
  if(limits.minWind>limits.maxWind)throw new TypeError('Profile minimum exceeds the effective maximum wind limit.');
  return Object.freeze(limits);
}
