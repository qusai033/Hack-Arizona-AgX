import { assertWeatherInput, assertFresh, deltas, signed, STATUSES } from '../contract.js';
import { thresholdsFor } from './profiles.js';
import { wetBulbDepression } from './wet-bulb.js';
import { assertSession, monitorSession } from './session.js';
export const ENGINE_VERSION='1.0.0';
const rank=s=>STATUSES.indexOf(s);
const status=rules=>rules.reduce((s,r)=>rank(r.severity)>rank(s)?r.severity:s,'GO');
// Suppress only floating point representation noise at exact decimal boundaries.
const gt=(a,b)=>a-b>1e-10, ge=(a,b)=>a-b>=-1e-10;
function invalidEvaluation(error) {
  return {single_station_5ft_status:'STOP',single_station_5ft_reason:'Input or context cannot be verified; no ground-station decision is available.',multi_height_status:'STOP',headline_reason:'Do not spray: input data or session context cannot be verified.',triggered_rules:[{code:'DATA_INVALID',severity:'STOP',metric:'Evaluation unavailable',explanation:String(error.message||error).slice(0,1800)}],post_spray_volatility_risk:'UNKNOWN — Cannot verify conditions. Maintain required monitoring and label restrictions.',caught_hidden_risk:false};
}
/** Pure, synchronous, no network / timers / random values / implicit wall clock.
 * nowMs is optional explicit freshness context; never pass it for forecast rows.
 * labelProhibitsInversion is external verified label context, not a new snapshot field.
 */
export function analyze(input,context={}) {
  try {
    assertWeatherInput(input);
    if(!context||typeof context!=='object'||Array.isArray(context))throw new TypeError('Evaluation context must be an object.');
    for(const k of Object.keys(context))if(!['session','nowMs','maxAgeMs','labelProhibitsInversion'].includes(k))throw new TypeError(`Unknown evaluation context field: ${k}`);
    if(context.labelProhibitsInversion!==undefined&&typeof context.labelProhibitsInversion!=='boolean')throw new TypeError('labelProhibitsInversion must be boolean.');
    if(context.nowMs!==undefined){
      if(!Number.isFinite(context.nowMs)||!Number.isFinite(context.maxAgeMs??300000)||(context.maxAgeMs??300000)<=0)throw new TypeError('Invalid freshness context.');
      assertFresh(input,context.nowMs,context.maxAgeMs??300000);
    }else if(context.maxAgeMs!==undefined)throw new TypeError('maxAgeMs requires explicit nowMs.');
    if('session' in context)assertSession(context.session);
    // A recorded in-progress treatment keeps its original application profile.
    const profile=context.session?.state==='SPRAYING_IN_PROGRESS'?context.session.pesticide_profile:input.pesticide_profile;
    const limits=thresholdsFor(profile),d=deltas(input),rules=[],groundRules=[];
    const add=(code,severity,metric,explanation,ground=false)=>{
      const r={code,severity,metric,explanation};rules.push(r);if(ground)groundRules.push(r);
    };
    const diagnostics={engine_version:ENGINE_VERSION,thresholds:limits,inversion_delta_f:d.temperature,speed_shear_mph:Math.abs(d.speed),signed_speed_delta_mph:d.speed,direction_shear_deg:d.direction,wet_bulb:{},session:null};
    for(const [key,height] of [['ground_5ft','5 ft'],['canopy_30ft','30 ft']]){
      const r=input.readings[key],ground=key==='ground_5ft',prefix=ground?'GROUND':'UPPER';
      if(gt(limits.minWind,r.wind_speed_mph))add(`${prefix}_WIND_TOO_CALM`,'STOP',`${r.wind_speed_mph.toFixed(2)} mph at ${height} (minimum ${limits.minWind} mph)`,`Wind at ${height} is below the ${limits.minWind} mph screening minimum. Very light winds can accompany inversions and allow unpredictable drift; pause and check on-site conditions.`,ground);
      else if(gt(r.wind_speed_mph,limits.maxWind))add(`${prefix}_WIND_EXCEEDED`,'STOP',`${r.wind_speed_mph.toFixed(2)} mph at ${height} (limit ${limits.maxWind} mph)`,`Wind at ${height} exceeds the effective ${limits.maxWind} mph profile limit. Halt application.`,ground);
      else if(gt(r.wind_speed_mph,limits.windCautionAbove))add(`${prefix}_WIND_CAUTION`,'CAUTION',`${r.wind_speed_mph.toFixed(2)} mph at ${height}`,`Wind at ${height} is approaching the effective ${limits.maxWind} mph upper limit. Watch for gusts and changing direction.`,ground);
      const wet=wetBulbDepression(r.temp_f,r.humidity_pct);diagnostics.wet_bulb[key]=wet;
      if(gt(r.temp_f,85)&&gt(25,r.humidity_pct))add(`${prefix}_EVAPORATIVE_RISK`,'CAUTION',`${r.temp_f.toFixed(1)}°F · ${r.humidity_pct.toFixed(1)}% RH · ${wet.available?`wet-bulb depression ${wet.depression_c.toFixed(1)}°C (${wet.depression_f.toFixed(1)}°F)`:'wet-bulb estimate unavailable'}`,`Hot, dry air at ${height} can shrink droplets through evaporation, increasing drift-prone fines. Review label-compatible droplet size and timing.`,ground);
    }
    if(gt(d.temperature,0)){
      const stop=context.labelProhibitsInversion||gt(d.temperature,limits.inversionStopAbove);
      add('INVERSION_DETECTED',stop?'STOP':'CAUTION',`${signed(d.temperature,2)}°F (30ft: ${input.readings.canopy_30ft.temp_f.toFixed(2)}°F vs 5ft: ${input.readings.ground_5ft.temp_f.toFixed(2)}°F)`,stop?`Positive temperature gradient: air at 30 ft is ${d.temperature.toFixed(2)}°F warmer than at 5 ft. Suspended fine droplets may remain concentrated and move sideways. ${context.labelProhibitsInversion?'The supplied label context prohibits spraying during an inversion.':'This exceeds the profile’s inversion STOP threshold; halt application.'}`:`Weak positive temperature gradient (+${d.temperature.toFixed(2)}°F). A weak inversion may be present; pause and verify on-site conditions. CAUTION does not override any label prohibition on inversions.`);
    }
    const shear=Math.abs(d.speed),g=input.readings.ground_5ft,c=input.readings.canopy_30ft;
    if(ge(shear,limits.speedShearCautionAt))add('VERTICAL_WIND_SHEAR',ge(shear,limits.speedShearStopAt)?'STOP':'CAUTION',`${shear.toFixed(2)} mph absolute shear (${signed(d.speed,2)} mph upper minus ground)`,`Wind is ${g.wind_speed_mph.toFixed(2)} mph at 5 ft and ${c.wind_speed_mph.toFixed(2)} mph at 30 ft. This ${shear.toFixed(2)} mph speed difference means the ground reading alone misses conditions above the trees.`);
    if(ge(d.direction,limits.directionCautionAt))add('DIRECTIONAL_WIND_SHEAR',ge(d.direction,limits.directionStopAt)&&gt(c.wind_speed_mph,limits.directionStopMinUpperWind)?'STOP':'CAUTION',`${d.direction.toFixed(1)}° shift (5ft: ${g.wind_dir_cardinal} / ${g.wind_dir_deg}° vs 30ft: ${c.wind_dir_cardinal} / ${c.wind_dir_deg}°)`,`Wind direction shifts ${d.direction.toFixed(1)}° between the orchard floor and canopy top. Different wind directions can carry spray toward unintended areas. Directions are bearings wind comes FROM; no receptor location is inferred.`);
    let post=`${profile.volatility_class} volatility screening profile. Monitor for ${limits.monitorHours} hours after treatment; this duration is not a restricted-entry interval.`;
    if(context.session){
      diagnostics.session=monitorSession(input,context.session);
      if(diagnostics.session.alert)rules.push(diagnostics.session.alert);
      post=diagnostics.session.message;
    }else if(profile.volatility_class==='HIGH'&&gt(d.temperature,0))post=`HIGH — An inversion signal is present and may retain vapor from a volatile formulation. No prior treatment is recorded; potential vapor exposure is not measured.`;
    const multi=status(rules),single=status(groundRules);
    const top=rules.find(r=>r.code==='POST_SPRAY_VOLATILITY_ALERT')||rules.find(r=>r.severity===multi);
    const headline=multi==='GO'?'No screening rules triggered. Verify the label and on-site conditions before spraying.':top.code==='POST_SPRAY_VOLATILITY_ALERT'?'Post-spray alert: an inversion is present over a recently treated block. Notify the supervisor.':`${multi==='STOP'?'Do not spray':'Pause and assess'}: ${top.explanation.split(/(?<=\.)\s+/)[0]}`;
    return {evaluation:{single_station_5ft_status:single,single_station_5ft_reason:groundRules.length?groundRules.map(r=>r.explanation).join(' '):`Ground wind is ${g.wind_speed_mph.toFixed(2)} mph, within the ${limits.minWind}–${limits.maxWind} mph screening range; no ground-only heat/humidity rule triggered. Upper-height conditions are unknown to this comparator.`,multi_height_status:multi,headline_reason:headline,triggered_rules:rules,post_spray_volatility_risk:post,caught_hidden_risk:single==='GO'&&multi==='STOP'},diagnostics};
  }catch(error){return {evaluation:invalidEvaluation(error),diagnostics:{engine_version:ENGINE_VERSION,error:String(error.message||error)}};}
}
export function evaluate(input,context={}) {return analyze(input,context).evaluation;}
/** Valid inputs produce a complete shared snapshot. Invalid input raises instead of
 * returning a malformed snapshot; evaluate() still returns a complete STOP object. */
export function evaluateSnapshot(input,context={}) {
  assertWeatherInput(input);
  return {...structuredClone(input),evaluation:evaluate(input,context)};
}
