import { assertProfile, assertWeatherInput, deltas, signed } from '../contract.js';
import { thresholdsFor } from './profiles.js';
export const SESSION_STATES=Object.freeze(['BEFORE_SPRAY','SPRAYING_IN_PROGRESS','POST_SPRAY_CURING']);
const iso = value => {
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw new TypeError('Session time must be ISO 8601 with timezone.');
  return Date.parse(value);
};
function freeze(session) {return Object.freeze({...session,pesticide_profile:Object.freeze({...session.pesticide_profile})});}
export function createSession(block,profile) {
  if(typeof block!=='string'||!block.trim()||block.length>2000)throw new TypeError('Session block is required.');
  assertProfile(profile);
  return freeze({state:'BEFORE_SPRAY',orchard_block:block,pesticide_profile:profile,started_at:null,ended_at:null,inversion_at_end_f:null});
}
export function assertSession(s) {
  if(!s||typeof s!=='object'||!SESSION_STATES.includes(s.state))throw new TypeError('Unknown spray-session state.');
  const keys=['state','orchard_block','pesticide_profile','started_at','ended_at','inversion_at_end_f'];
  if(Object.keys(s).some(k=>!keys.includes(k))||keys.some(k=>!(k in s)))throw new TypeError('Invalid session fields.');
  createSession(s.orchard_block,s.pesticide_profile);
  if(s.state==='BEFORE_SPRAY'){
    if(s.started_at!==null||s.ended_at!==null||s.inversion_at_end_f!==null)throw new TypeError('Unstarted session cannot contain treatment times.');
  }else{
    const start=iso(s.started_at);
    if(s.state==='SPRAYING_IN_PROGRESS'){
      if(s.ended_at!==null||s.inversion_at_end_f!==null)throw new TypeError('Active spraying cannot contain an end time.');
    }else{
      if(iso(s.ended_at)<start)throw new TypeError('Session ends before it starts.');
      if(s.inversion_at_end_f!==null&&!Number.isFinite(s.inversion_at_end_f))throw new TypeError('Invalid end-of-spray temperature difference.');
    }
  }
  return s;
}
export function startSpray(session,at) {
  assertSession(session);iso(at);
  if(session.state!=='BEFORE_SPRAY')throw new Error('Only a BEFORE_SPRAY session can start.');
  return freeze({...session,state:'SPRAYING_IN_PROGRESS',started_at:at});
}
export function finishSpray(session,at,endObservation) {
  assertSession(session);const end=iso(at);
  if(session.state!=='SPRAYING_IN_PROGRESS')throw new Error('Only an active spray session can finish.');
  if(end<iso(session.started_at))throw new Error('Session cannot end before it starts.');
  let delta=null;
  if(endObservation){
    assertWeatherInput(endObservation);
    if(endObservation.orchard_block!==session.orchard_block||iso(endObservation.timestamp)!==end)throw new Error('End observation must match the session block and end time.');
    delta=deltas(endObservation).temperature;
  }
  return freeze({...session,state:'POST_SPRAY_CURING',ended_at:at,inversion_at_end_f:delta});
}
export function monitorSession(input,session) {
  assertWeatherInput(input);assertSession(session);
  if(session.orchard_block!==input.orchard_block)throw new Error('Session block does not match the observed orchard block.');
  const now=iso(input.timestamp),p=session.pesticide_profile,hours=thresholdsFor(p).monitorHours;
  if(session.started_at&&now<iso(session.started_at))throw new Error('Observation precedes the spray session.');
  if(session.state!=='POST_SPRAY_CURING')return {state:session.state,monitoring:false,expired:false,elapsed_hours:null,monitor_hours:hours,alert:null,message:session.state==='BEFORE_SPRAY'?'No spray treatment has been recorded.':'Spraying is in progress. Reassess both heights continuously.'};
  const elapsed=(now-iso(session.ended_at))/3600000;
  if(elapsed<0)throw new Error('Observation precedes the end of spraying.');
  const monitoring=elapsed<hours,d=deltas(input).temperature;
  let alert=null;
  if(monitoring&&p.volatility_class==='HIGH'&&d>1){
    const changed=session.inversion_at_end_f!==null&&session.inversion_at_end_f<=1;
    alert={code:'POST_SPRAY_VOLATILITY_ALERT',severity:'STOP',metric:`${Number(elapsed.toFixed(2))} hrs since treatment · ${signed(d,2)}°F inversion`,explanation:`WARNING: ${session.orchard_block} was treated ${Number(elapsed.toFixed(2))} hrs ago with the recorded high-volatility profile. A ${signed(d,2)}°F inversion ${changed?'has developed since treatment':'is present'} and may retain chemical vapor. Notify the supervisor and nearby workers; follow product-label re-entry restrictions and site procedures. Vapor concentration is not measured.`};
  }
  return {state:session.state,monitoring,expired:!monitoring,elapsed_hours:elapsed,monitor_hours:hours,alert,message:alert?.explanation||(monitoring?`Post-spray monitoring: ${Number(elapsed.toFixed(2))} of ${hours} hours elapsed. No specialized inversion alert at this observation; this does not establish safe re-entry.`:'Configured monitoring period ended. This is not a clearance for re-entry or proof that residues or vapor are absent.')};
}
