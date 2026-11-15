import { assertProfile, assertSnapshot } from './contract.js';
import { evaluateDemo } from './demo.js';
import { forecastWindow, validateForecastIssuance } from './weather.js';

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
  // A profile switch is not a source refresh. Do not revive an expired NWS
  // issue by re-evaluating its already modeled height measurements.
  if(model.source==='nws'||model.source==='cached_nws') {
    if(!['updateTime','generatedAt','updated'].includes(model.issuance_source)) {
      throw new Error('NWS issuance provenance is missing.');
    }
    validateForecastIssuance({[model.issuance_source]:model.issued_at},nowMs);
  }
  const snapshots=model.snapshots.map(previous=>{
    const next=evaluateDemo(previous,profile,undefined,nowMs);
    assertSnapshot(next);
    const failure=next.evaluation.triggered_rules.find(rule=>rule.code==='DATA_INVALID');
    if(failure)throw new Error('Profile re-evaluation failed: '+failure.explanation);
    return next;
  });
  // The AZMET station check's anchored screening follows the same selected profile.
  const station=model.station?.anchored_snapshot?
    {station:{...model.station,anchored_snapshot:evaluateDemo(model.station.anchored_snapshot,profile,undefined,nowMs)}}:{};
  return {...model,...station,evaluation_context:{evaluationTimeMs:nowMs},snapshots,window:forecastWindow(snapshots,nowMs,model.time_zone)};
}

/** First still-valid period, or the earliest available period for the
 * caller to reject/label using the existing forecast timeline policy.
 */
export function currentForecastPeriod(model,nowMs=Date.now()){
  if(!model?.snapshots?.length || !Number.isFinite(nowMs) ||
     !Number.isFinite(model.interval_minutes) || model.interval_minutes<=0){
    throw new TypeError('A non-empty forecast with an interval and clock is required.');
  }
  const current=model.snapshots.find(row=>Date.parse(row.timestamp)+model.interval_minutes*60000>nowMs);
  if(!current)throw new Error('Forecast period coverage has expired; refresh weather data.');
  return current;
}
