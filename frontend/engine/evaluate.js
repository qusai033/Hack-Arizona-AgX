import { assertWeatherInput, assertFresh, deltas, signed, STATUSES } from '../contract.js';
import { assessDataQuality } from './quality.js';
import { FRESHNESS_POLICY } from '../freshness-policy.js';
import { thresholdsFor } from './profiles.js';
import { wetBulbDepression } from './wet-bulb.js';
import { assertSession, monitorSession } from './session.js';
export const ENGINE_VERSION='1.1.0';
const rank=s=>STATUSES.indexOf(s);
const status=rules=>rules.reduce((s,r)=>rank(r.severity)>rank(s)?r.severity:s,'GO');
// Suppress only floating point representation noise at exact decimal boundaries.
const gt=(a,b)=>a-b>1e-10, ge=(a,b)=>a-b>=-1e-10;
// The provenance describes the *basis of the screening rule*, not weather
// data origin or product-label validation. Affected heights are explicit.
function withProvenance(rule) {
  const heights=rule.code.startsWith('GROUND_')?[5]:
    rule.code.startsWith('UPPER_')?[30]:[5,30];
  return {...rule,provenance:'ILLUSTRATIVE_THRESHOLD',
    source_heights:heights,is_upper_or_cross_height_hazard:heights.includes(30)};
}
const orderedRules=rules=>[...rules].sort((a,b)=>rank(b.severity)-rank(a.severity));

// Ground-only comparison is independently calculable when 5 ft readings are
// valid but the canopy observation is missing. No fabricated canopy is used.
function groundComparison(input,profile) {
  const r=input.readings.ground_5ft,limits=thresholdsFor(profile),reasons=[];
  if(gt(limits.minWind,r.wind_speed_mph))reasons.push(`Ground wind is below the ${limits.minWind} mph minimum.`);
  else if(gt(r.wind_speed_mph,limits.maxWind))reasons.push(`Ground wind exceeds the ${limits.maxWind} mph maximum.`);
  else if(gt(r.wind_speed_mph,limits.windCautionAbove))reasons.push(`Ground wind approaches the ${limits.maxWind} mph limit.`);
  if(gt(r.temp_f,85)&&gt(25,r.humidity_pct))reasons.push('Hot, dry ground air increases evaporation risk.');
  return {status:reasons.some(x=>x.includes('below')||x.includes('exceeds'))?'STOP':
    reasons.length?'CAUTION':'GO',
    reason:reasons.join(' ')||`The verified 5 ft reading passes its configured wind and evaporation checks; the unverified upper height is excluded.`};
}
function invalidEvaluation(error,quality,ground=null) {
  const affected=[['ground_5ft',5],['canopy_30ft',30]]
    .filter(([height])=>quality?.[height]?.status!=='VALID').map(([,ft])=>ft);
  const issue=String(error.message||error).slice(0,1800);
  return {single_station_5ft_status:ground?.status??'STOP',
    single_station_5ft_reason:ground?.reason??'Ground input or evaluation context cannot be verified; no ground-only clearance is available.',
    multi_height_status:'STOP',headline_reason:'Do not spray: input data or session context cannot be verified.',
    triggered_rules:[{code:'DATA_INVALID',severity:'STOP',metric:'Evaluation unavailable',
      explanation:issue,provenance:'SAFETY_FAILSAFE',source_heights:affected,
      is_upper_or_cross_height_hazard:false}],
    post_spray_volatility_risk:'UNKNOWN — Cannot verify conditions. Maintain required monitoring and label restrictions.',
    caught_hidden_risk:false,data_quality:quality??null};
}
/** Pure, synchronous, no network / timers / random values / implicit wall clock.
 * nowMs is optional explicit freshness context; never pass it for forecast rows.
 * evaluationTimeMs is an independent, explicitly supplied decision-clock instant.
 * It describes when the evaluation was performed (simulation clock for demos),
 * does not enforce observation freshness, and does not change any screening rule.
 * labelProhibitsInversion is external verified label context, not a new snapshot field.
 */
export function analyze(input,context={}) {
  let quality=assessDataQuality(input,context);
  try {
    if(!context||typeof context!=='object'||Array.isArray(context))throw new TypeError('Evaluation context must be an object.');
    for(const k of Object.keys(context))if(!['session','nowMs','maxAgeMs','labelProhibitsInversion','evaluationTimeMs'].includes(k))throw new TypeError(`Unknown evaluation context field: ${k}`);
    if(context.labelProhibitsInversion!==undefined&&typeof context.labelProhibitsInversion!=='boolean')throw new TypeError('labelProhibitsInversion must be boolean.');
    if(context.evaluationTimeMs!==undefined &&
       (!Number.isSafeInteger(context.evaluationTimeMs) || context.evaluationTimeMs<0 ||
        !Number.isFinite(new Date(context.evaluationTimeMs).getTime()))) {
      throw new TypeError('evaluationTimeMs must be a finite Unix millisecond timestamp.');
    }
    if(context.nowMs!==undefined){
      if(!Number.isFinite(context.nowMs)||!Number.isFinite(context.maxAgeMs??FRESHNESS_POLICY.observation.maxAgeMs)||
         (context.maxAgeMs??FRESHNESS_POLICY.observation.maxAgeMs)<=0)throw new TypeError('Invalid freshness context.');
    }else if(context.maxAgeMs!==undefined)throw new TypeError('maxAgeMs requires explicit nowMs.');
    if('session' in context)assertSession(context.session);
    // An in-progress application retains its actual applied profile.
    const profile=context.session?.state==='SPRAYING_IN_PROGRESS'?context.session.pesticide_profile:input?.pesticide_profile;
    const limits=thresholdsFor(profile);
    if(quality.overall_status!=='VALID') {
      const ground=quality.issues.length===0&&quality.ground_5ft.status==='VALID'?
        groundComparison(input,profile):null;
      const qualityIssues=[
        ...quality.issues,...quality.ground_5ft.issues,...quality.canopy_30ft.issues
      ];
      // Keep the approved #47 user-facing freshness limits in fail-safe
      // explanations while retaining the per-height diagnostics. This is
      // an explicit observation-clock check, never a forecast-validity check.
      if(context.nowMs!==undefined){
        try{assertFresh(input,context.nowMs,context.maxAgeMs??FRESHNESS_POLICY.observation.maxAgeMs);}
        catch(error){qualityIssues.unshift(error.message);}
      }
      const error=new TypeError('Unverified per-height input: '+qualityIssues.join('; '));
      return {evaluation:invalidEvaluation(error,quality,ground),
        diagnostics:{engine_version:ENGINE_VERSION,error:error.message,data_quality:quality}};
    }
    // Once independently checked, enforce the full shared input contract.
    assertWeatherInput(input);
    if(context.nowMs!==undefined)assertFresh(input,context.nowMs,context.maxAgeMs??FRESHNESS_POLICY.observation.maxAgeMs);
    const d=deltas(input),rules=[],groundRules=[];
    const add=(code,severity,metric,explanation,ground=false)=>{
      const r=withProvenance({code,severity,metric,explanation});
      rules.push(r);if(ground)groundRules.push(r);
    };
    const diagnostics={engine_version:ENGINE_VERSION,thresholds:limits,inversion_delta_f:d.temperature,speed_shear_mph:Math.abs(d.speed),signed_speed_delta_mph:d.speed,direction_shear_deg:d.direction,wet_bulb:{},session:null,data_quality:quality};
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
      if(diagnostics.session.alert)rules.push(withProvenance(diagnostics.session.alert));
      post=diagnostics.session.message;
    }else if(profile.volatility_class==='HIGH'&&gt(d.temperature,0))post=`HIGH — An inversion signal is present and may retain vapor from a volatile formulation. No prior treatment is recorded; potential vapor exposure is not measured.`;
    const sorted=orderedRules(rules);
    const multi=status(sorted),single=status(groundRules);
    const top=sorted.find(r=>r.code==='POST_SPRAY_VOLATILITY_ALERT')||sorted.find(r=>r.severity===multi);
    const headline=multi==='GO'?'No screening rules triggered. Verify the label and on-site conditions before spraying.':top.code==='POST_SPRAY_VOLATILITY_ALERT'?'Post-spray alert: an inversion is present over a recently treated block. Notify the supervisor.':`${multi==='STOP'?'Do not spray':'Pause and assess'}: ${top.explanation.split(/(?<=\.)\s+/)[0]}`;
    return {evaluation:{single_station_5ft_status:single,single_station_5ft_reason:groundRules.length?groundRules.map(r=>r.explanation).join(' '):`Ground wind is ${g.wind_speed_mph.toFixed(2)} mph, within the ${limits.minWind}–${limits.maxWind} mph screening range; no ground-only heat/humidity rule triggered. Upper-height conditions are unknown to this comparator.`,multi_height_status:multi,headline_reason:headline,triggered_rules:sorted,post_spray_volatility_risk:post,
      caught_hidden_risk:quality.overall_status==='VALID'&&single==='GO'&&multi==='STOP'&&
        sorted.some(r=>r.severity==='STOP'&&r.is_upper_or_cross_height_hazard),data_quality:quality},diagnostics};
  }catch(error){
    const rejected={...quality,overall_status:'INVALID_OR_STALE',
      issues:[...quality.issues,'INVALID_INPUT_OR_CONTEXT']};
    return {evaluation:invalidEvaluation(error,rejected),diagnostics:{
      engine_version:ENGINE_VERSION,error:String(error.message||error),data_quality:rejected}};
  }
}
export function evaluate(input,context={}) {return analyze(input,context).evaluation;}
/** Valid inputs produce a complete shared snapshot. Invalid input raises instead of
 * returning a malformed snapshot; evaluate() still returns a complete STOP object. */
export function evaluateSnapshot(input,context={}) {
  assertWeatherInput(input);
  return {...structuredClone(input),evaluation:evaluate(input,context)};
}
