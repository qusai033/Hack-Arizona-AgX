import { deltas, escapeHTML as esc } from './contract.js';
import { thresholdsFor } from './engine/profiles.js';

// Sources explain established physical mechanisms and the need to obey labels.
// They DO NOT establish CanopyGuard's numerical inversion, shear, humidity,
// profile-specific or post-spray thresholds as regulatory or validated limits.
export const DECISION_SOURCES=Object.freeze([
  Object.freeze({id:'EPA_MANUAL',name:'EPA — National Pesticide Applicator Certification Core Manual',
    url:'https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P1017DIK.TXT',
    supports:'Inversion physics, lateral drift, application context and volatile formulations.'}),
  Object.freeze({id:'EPA_LABELS',name:'EPA — Improving Labels to Reduce Pesticide Drift',
    url:'https://www.epa.gov/reducing-pesticide-drift/improving-labels-reduce-pesticide-drift',
    supports:'The actual product label may set wind, droplet, release-height and buffer requirements.'}),
  Object.freeze({id:'UNL',name:'University of Nebraska–Lincoln Extension — Spray Drift of Pesticides',
    url:'https://extensionpubs.unl.edu/publication/g1773/2019/html/view',
    supports:'Wind, atmospheric stability, droplet-size effects and hot/dry evaporation.'}),
  Object.freeze({id:'IFAS',name:'University of Florida IFAS Extension — Managing Pesticide Drift',
    url:'https://ask.ifas.ufl.edu/publication/PI232',
    supports:'General wind screening context, inversions, hot/dry conditions and droplet physics.'}),
  Object.freeze({id:'UMN',name:'University of Minnesota Extension — Avoiding Herbicide Drift',
    url:'https://extension.umn.edu/agriculture/crop-production/weed-management/avoiding-herbicide-drift',
    supports:'On-site wind/direction checks, inversions, sensitive areas and label priority.'})
]);
const byId=Object.fromEntries(DECISION_SOURCES.map(source=>[source.id,source]));
const sourceLink=id=>{
  const source=byId[id];
  return `<a href="${source.url}" target="_blank" rel="noopener noreferrer">${esc(source.name)}</a>`;
};
const val=x=>Number.isFinite(x)?Number(x).toFixed(1):'unavailable';
const statusOf=rules=>rules.some(r=>r.severity==='STOP')?'STOP':
  rules.some(r=>r.severity==='CAUTION')?'CAUTION':'NO RULE';
const rulesFor=(rules,codes)=>rules.filter(r=>codes.includes(r.code));
function check(label,measured,configured,relevantRules,sources,note){
  const result=statusOf(relevantRules);
  const statusText=result==='NO RULE'?'No rule triggered':result;
  const references=sources.map(sourceLink).join(' · ');
  return `<article class="evidence-check" data-evidence-check="${esc(label)}" data-evidence-status="${result}">
    <div class="evidence-check-head"><h4>${esc(label)}</h4><span class="evidence-check-status ${result==='NO RULE'?'NEUTRAL':result}">${statusText}</span></div>
    <p class="evidence-measured"><strong>Input:</strong> ${esc(measured)}</p>
    <p><strong>Screening rule:</strong> ${esc(configured)}</p>
    <p class="evidence-note">${esc(note)}</p>
    <div class="evidence-references">Evidence for the physical concern: ${references}</div>
  </article>`;
}
const decisionTitle={GO:'Configured checks passed',CAUTION:'One or more caution rules triggered',STOP:'One or more stop rules or input-integrity checks triggered'};
function verdict(e){
  const stop=e.triggered_rules.filter(r=>r.severity==='STOP').length;
  const caution=e.triggered_rules.filter(r=>r.severity==='CAUTION').length;
  return `${decisionTitle[e.multi_height_status]||'Evaluation supplied'}.
    Actual triggered rules: ${stop} STOP and ${caution} CAUTION. The most severe rule determines the overall status (STOP > CAUTION > GO).
    GO means only that no configured rule fired; it never certifies that spraying is safe or label-compliant.`;
}
/** Render an explanation derived from the exact evaluated snapshot, not a
 * second decision engine. All dynamic weather/profile text is escaped.
 * Only the built-in demo or forecast evaluator may disclose its numeric policy.
 * Live/imported adapters have no verified built-in threshold attribution.
 */
export function decisionExplanation(snapshot,{mode='demo'}={}){
  const e=snapshot?.evaluation;
  if(!e)return '<p>No evaluated decision is available to explain.</p>';
  if(mode!=='demo'&&mode!=='forecast'){
    return `<p class="evidence-summary">${esc(e.headline_reason)} The current decision was supplied by an external/imported source.</p>
      <p><strong>Calculation and thresholds unverified:</strong> CanopyGuard cannot independently attribute this result to its internal rule engine.
      Review the original data provider, product label and on-site conditions. The references below describe general drift science only.</p>
      <p>${sourceLink('EPA_LABELS')} · ${sourceLink('EPA_MANUAL')}</p>`;
  }
  const g=snapshot.readings.ground_5ft,c=snapshot.readings.canopy_30ft;
  const d=deltas(snapshot),t=thresholdsFor(snapshot.pesticide_profile),rules=e.triggered_rules;
  const quality=e.data_quality;
  const context=mode==='forecast'?'Regional NWS heights are MODELED estimates, not measured orchard observations.':
    'SIMULATED demo readings, not measured orchard observations.';
  const inputNote=quality?.assessment==='STRUCTURE_ONLY'?'Input structure checked; observation freshness NOT assessed.':
    quality?.assessment==='STRUCTURE_AND_AGE'?'Input structure and explicitly clocked observation age checked.':
    'Input quality or observation freshness not verified.';
  const qualityText=quality?`${quality.overall_status}; 5 ft: ${quality.ground_5ft.status}; 30 ft: ${quality.canopy_30ft.status}`:'Unavailable';
  const qualityRules=rulesFor(rules,['DATA_INVALID']);
  const cards=[
    check('Input validity',qualityText,'Invalid or stale decision inputs fail closed as STOP.',qualityRules,
      ['EPA_LABELS'],'Data VALID means input checks passed—not calibrated accuracy, observed sensors, or safe application.'),
    check('Wind at both heights',`5 ft ${val(g.wind_speed_mph)} mph; 30 ft ${val(c.wind_speed_mph)} mph`,
      `Wind below ${val(t.minWind)} mph or above ${val(t.maxWind)} mph: STOP; wind above ${val(t.windCautionAbove)} mph: CAUTION where no STOP applies.`,
      rulesFor(rules,['GROUND_WIND_TOO_CALM','GROUND_WIND_EXCEEDED','GROUND_WIND_CAUTION','UPPER_WIND_TOO_CALM','UPPER_WIND_EXCEEDED','UPPER_WIND_CAUTION']),
      ['UNL','IFAS'],'3–10 mph is a frequently discussed general range; the selected profile and product label govern actual restrictions.'),
    check('Temperature gradient / inversion signal',`30 ft minus 5 ft = ${val(d.temperature)}°F`,
      `Positive gradient: inversion CAUTION signal; greater than ${val(t.inversionStopAbove)}°F: illustrative STOP, or STOP with verified label inversion prohibition.`,
      rulesFor(rules,['INVERSION_DETECTED']),['EPA_MANUAL','UMN'],
      'Warm air above cooler air can indicate stability. Two heights cannot establish the full inversion structure; the STOP cutoff is unvalidated project policy.'),
    check('Wind-speed shear',`Absolute speed difference = ${val(Math.abs(d.speed))} mph`,
      `Difference at least ${val(t.speedShearCautionAt)} mph: CAUTION; at least ${val(t.speedShearStopAt)} mph: STOP.`,
      rulesFor(rules,['VERTICAL_WIND_SHEAR']),['EPA_MANUAL','UNL'],
      'Different wind speeds at 5 ft and 30 ft can expose a ground-only blind spot. These numeric cutoffs are project policy, not published regulatory limits.'),
    check('Wind-direction shear',`Shortest bearing difference = ${val(d.direction)}°`,
      `Shift at least ${val(t.directionCautionAt)}°: CAUTION; at least ${val(t.directionStopAt)}° with upper wind above ${val(t.directionStopMinUpperWind)} mph: STOP.`,
      rulesFor(rules,['DIRECTIONAL_WIND_SHEAR']),['UMN','UNL'],
      'The shift is calculated from wind-FROM bearings; no downwind receptor, plume direction or field boundary has been assessed. Numeric cutoffs are illustrative.'),
    check('Hot and dry conditions',`5 ft ${val(g.temp_f)}°F / ${val(g.humidity_pct)}% RH; 30 ft ${val(c.temp_f)}°F / ${val(c.humidity_pct)}% RH`,
      'For either height: temperature above 85°F AND relative humidity below 25% triggers CAUTION.',
      rulesFor(rules,['GROUND_EVAPORATIVE_RISK','UPPER_EVAPORATIVE_RISK']),['UNL','IFAS'],
      'Hot, dry air can shrink droplets. The precise 85°F/25% combination is an illustrative CanopyGuard cutoff, not a universal research-validated limit.')
  ];
  if(rules.some(r=>r.code==='POST_SPRAY_VOLATILITY_ALERT')){
    cards.push(check('Recorded post-spray inversion alert','High-volatility demo treatment context',
      'STOP when the configured post-spray alert rule detects a qualifying inversion during monitoring.',
      rulesFor(rules,['POST_SPRAY_VOLATILITY_ALERT']),['EPA_MANUAL','EPA_LABELS'],
      'Vapor concentration is not measured. Monitoring duration is neither a safe re-entry period nor a label requirement.'));
  }
  const caught=e.caught_hidden_risk===true?
    'The ground-only comparator reported GO while validated upper/cross-height rules produced STOP. This is a screening contrast, not a measured drift incident.':
    'No qualifying hidden upper-height STOP was credited for this evaluation.';
  return `<p class="evidence-summary">${esc(verdict(e))}</p>
    <p class="evidence-data-note">${esc(context)} ${esc(inputNote)}</p>
    <div class="evidence-check-grid">${cards.join('')}</div>
    <p class="evidence-hidden"><strong>Why compare 5 ft and 30 ft?</strong> ${esc(caught)}</p>
    <p class="evidence-limit"><strong>Important:</strong> Sources above establish environmental drift mechanisms; they DO NOT validate the project's inversion, shear, heat/humidity or treatment-monitoring cutoff values. These are transparent, configurable illustrative screening assumptions. Actual product label restrictions, sensitive receptors, gusts, nozzle setup, buffers and field verification are outside this evaluation. A modeled or demo GO is never spray clearance.</p>`;
}
