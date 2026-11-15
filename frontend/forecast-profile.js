import { assertProfile, assertSnapshot } from './contract.js';
import { evaluateDemo } from './demo.js';
import { forecastWindow } from './weather.js';

/**
 * Re-screen already sourced NWS hourly weather using the exact selected profile.
 * This never makes a network request or changes the underlying weather, NWS
 * issue/retrieval timestamps, cache, or modeled-height provenance.
 */
export function reevaluateForecastModel(model, profile, nowMs=Date.now()) {
  assertProfile(profile);
  if(!model || !Array.isArray(model.snapshots) || !model.snapshots.length ||
     model.interval_minutes!==60 || typeof model.time_zone!=='string' ||
     !Number.isFinite(nowMs)) {
    throw new TypeError('A valid NWS hourly forecast is required for profile screening.');
  }
  const snapshots=model.snapshots.map(previous=>{
    const next=evaluateDemo(previous,profile);
    assertSnapshot(next);
    const failure=next.evaluation.triggered_rules.find(rule=>rule.code==='DATA_INVALID');
    if(failure)throw new Error('Profile re-evaluation failed: '+failure.explanation);
    return next;
  });
  return {...model,snapshots,window:forecastWindow(snapshots,nowMs,model.time_zone)};
}

/** First still-valid period, or the earliest available period for the
 * caller to reject/label using the existing forecast timeline policy.
 */
export function currentForecastPeriod(model,nowMs=Date.now()){
  if(!model?.snapshots?.length || !Number.isFinite(nowMs) ||
     !Number.isFinite(model.interval_minutes) || model.interval_minutes<=0){
    throw new TypeError('A non-empty forecast with an interval and clock is required.');
  }
  return model.snapshots.find(row=>Date.parse(row.timestamp)+model.interval_minutes*60000>nowMs) ||
    model.snapshots[0];
}
