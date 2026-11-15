import { assertReading } from '../contract.js';

const heights=['ground_5ft','canopy_30ft'];
const iso=value=>typeof value==='string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
  Number.isFinite(Date.parse(value));

/**
 * Inspect each height independently using the *same* field constraints as
 * assertWeatherInput. Temporal quality is evaluated only against explicit
 * context.nowMs (observation freshness); evaluationTimeMs is independent and
 * must not be used to make future-valid NWS forecasts look stale.
 *
 * VALID means the supplied input passed structural and (when provided) age
 * checks. It does NOT assert an on-site sensor, field accuracy, or product label.
 */
export function assessDataQuality(input,context={}) {
  const at=iso(input?.timestamp)?Date.parse(input.timestamp):null;
  const clock=Number.isFinite(context?.nowMs)?context.nowMs:null;
  const maxAge=Number.isFinite(context?.maxAgeMs)&&context.maxAgeMs>0?context.maxAgeMs:300000;
  const age=at===null||clock===null?null:clock-at;
  const issues=[];
  if(at===null)issues.push('INVALID_OBSERVATION_TIMESTAMP');
  if(context?.nowMs!==undefined&&!Number.isFinite(context.nowMs))issues.push('INVALID_FRESHNESS_CLOCK');
  if(context?.maxAgeMs!==undefined&&(!Number.isFinite(context.maxAgeMs)||context.maxAgeMs<=0))issues.push('INVALID_MAX_AGE');
  if(context?.maxAgeMs!==undefined&&context?.nowMs===undefined)issues.push('MISSING_FRESHNESS_CLOCK');
  const result={overall_status:'VALID',assessment:clock===null?'STRUCTURE_ONLY':'STRUCTURE_AND_AGE',
    age_ms:age,evaluated_at:Number.isSafeInteger(context?.evaluationTimeMs)&&context.evaluationTimeMs>=0&&
      Number.isFinite(new Date(context.evaluationTimeMs).getTime())?
      new Date(context.evaluationTimeMs).toISOString():null,
    issues,ground_5ft:null,canopy_30ft:null};
  for(const height of heights){
    const layer={status:'VALID',age_ms:age,issues:[]};
    try { assertReading(input?.readings?.[height],height); }
    catch(error){layer.status='INVALID';layer.issues.push(String(error.message||error).slice(0,240));}
    if(at===null){layer.status='INVALID';layer.issues.push('INVALID_OBSERVATION_TIMESTAMP');}
    if(layer.status==='VALID' && age!==null){
      if(age>maxAge){layer.status='STALE';layer.issues.push('OBSERVATION_STALE');}
      else if(age < -60000){layer.status='FUTURE';layer.issues.push('OBSERVATION_IN_FUTURE');}
    }
    result[height]=layer;
  }
  if(issues.length||heights.some(h=>result[h].status!=='VALID'))result.overall_status='INVALID_OR_STALE';
  return result;
}
