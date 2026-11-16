import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionExplanation, DECISION_SOURCES} from '../frontend/decision-explanation.js';
import {evaluateSnapshot} from '../frontend/engine/evaluate.js';
import {getProfile} from '../frontend/engine/profiles.js';

const reading=(temp_f,humidity_pct,wind_speed_mph,wind_dir_deg,wind_dir_cardinal)=>({
  temp_f,humidity_pct,wind_speed_mph,wind_dir_deg,wind_dir_cardinal
});
const base=()=>({
  timestamp:'2026-11-15T20:00:00.000Z',scenario_name:'Screening example',orchard_block:'Block 4B',
  readings:{
    ground_5ft:reading(70,50,5,0,'N'),
    canopy_30ft:reading(69,50,5,0,'N')
  },
  pesticide_profile:getProfile('contact_fungicide')
});
const evaluated=input=>evaluateSnapshot(input,{evaluationTimeMs:Date.parse(input.timestamp)});
const inputCard=html=>html.match(/<article[^>]*data-evidence-check="Input validity"[\s\S]*?<\/article>/)?.[0];

test('valid inputs explicitly pass even when weather rules produce STOP',()=>{
  const input=base();input.readings.canopy_30ft.temp_f=75;
  const snapshot=evaluated(input);
  assert.equal(snapshot.evaluation.multi_height_status,'STOP');
  const card=inputCard(decisionExplanation(snapshot));
  assert.match(card,/data-evidence-status="PASSED"/);
  assert.match(card,/Input checks passed/);
  assert.match(card,/5 ft: checks passed; 30 ft: checks passed/);
  assert.doesNotMatch(card,/No rule triggered|Screening rule:|Data VALID/);
  assert.match(card,/<details class="evidence-input-policy">/);
  assert.match(card,/does not verify sensor calibration, on-site measurements, or application safety/);
});

test('stale observations show the actual STOP failure and per-height states',()=>{
  const input=base();
  const snapshot=evaluateSnapshot(input,{nowMs:Date.parse(input.timestamp)+360000});
  const card=inputCard(decisionExplanation(snapshot));
  assert.match(card,/data-evidence-status="STOP"/);
  assert.match(card,/Input checks failed/);
  assert.match(card,/Overall decision: STOP/);
  assert.match(card,/5 ft: stale data; 30 ft: stale data/);
  assert.ok(card.includes(snapshot.evaluation.triggered_rules[0].explanation));
  assert.doesNotMatch(card,/Input checks passed/);
});

test('invalid evaluation context cannot be labeled passed when both readings are valid',()=>{
  const input=base();
  const snapshot=evaluateSnapshot(input,{evaluationTimeMs:-1});
  const card=inputCard(decisionExplanation(snapshot));
  assert.match(card,/Input checks failed/);
  assert.match(card,/evaluationTimeMs must be a finite Unix millisecond timestamp/);
  assert.match(card,/5 ft: checks passed; 30 ft: checks passed/);
  assert.doesNotMatch(card,/Input checks passed/);
});

test('missing or incomplete quality assessments never claim input checks passed',()=>{
  for(const quality of [undefined,{overall_status:'VALID'},{overall_status:'VALID',
    ground_5ft:{status:'VALID'},canopy_30ft:{status:'VALID'}}]){
    const snapshot=evaluated(base());snapshot.evaluation.data_quality=quality;
    const card=inputCard(decisionExplanation(snapshot));
    assert.match(card,/data-evidence-status="UNVERIFIED"/);
    assert.match(card,/Input checks unverified/);
    assert.doesNotMatch(card,/Input checks passed/);
  }
});

test('input-validation failure details are escaped',()=>{
  const input=base();
  const snapshot=evaluateSnapshot(input,{evaluationTimeMs:-1});
  snapshot.evaluation.triggered_rules[0].explanation='<script>untrusted</script>';
  const card=inputCard(decisionExplanation(snapshot));
  assert.doesNotMatch(card,/<script>/);
  assert.match(card,/&lt;script&gt;untrusted&lt;\/script&gt;/);
});

test('GO explanation shows actual wind, gradient, zero triggered rules and no clearance claim',()=>{
  const html=decisionExplanation(evaluated(base()),{mode:'demo'});
  assert.match(html,/Configured checks passed/);
  assert.match(html,/Actual triggered rules: 0 STOP and 0 CAUTION/);
  assert.match(html,/5 ft 5\.0 mph; 30 ft 5\.0 mph/);
  assert.match(html,/30 ft minus 5 ft = −?\-?1\.0°F/);
  assert.match(html,/No rule triggered/);
  assert.match(html,/never certifies that spraying is safe/);
  assert.match(html,/SIMULATED demo readings/);
  assert.match(html,/observation freshness NOT assessed/);
  assert.match(html,/illustrative CanopyGuard cutoff/);
});

test('STOP explanation derives actual triggered severity and upper height values from evaluator',()=>{
  const input=base();Object.assign(input.readings.ground_5ft,{temp_f:64,humidity_pct:68,wind_speed_mph:4.8,wind_dir_deg:355,wind_dir_cardinal:'N'});
  Object.assign(input.readings.canopy_30ft,{temp_f:68.5,humidity_pct:52,wind_speed_mph:12.4,wind_dir_deg:85,wind_dir_cardinal:'E'});
  const s=evaluated(input),html=decisionExplanation(s,{mode:'demo'});
  assert.equal(s.evaluation.multi_height_status,'STOP');
  assert.equal(s.evaluation.caught_hidden_risk,true);
  assert.match(html,/12\.4 mph/);
  assert.match(html,/30 ft minus 5 ft = 4\.5°F/);
  assert.match(html,/Absolute speed difference = 7\.6 mph/);
  assert.match(html,/Shortest bearing difference = 90\.0°/);
  assert.match(html,/one or more stop rules or input-integrity checks/i);
  assert.match(html,/data-evidence-status="STOP"/);
  assert.match(html,/ground-only comparator reported GO/);
  assert.match(html,/not a measured drift incident/);
  assert.match(html,/The most severe rule determines the overall status/);
});

test('CAUTION explains weak inversion and configured thresholds without claiming regulatory proof',()=>{
  const input=base();input.readings.canopy_30ft.temp_f=70.5;
  const s=evaluated(input),html=decisionExplanation(s,{mode:'forecast'});
  assert.equal(s.evaluation.multi_height_status,'CAUTION');
  assert.match(html,/1 CAUTION/);
  assert.match(html,/MODELED estimates/);
  assert.match(html,/greater than 1\.0°F/);
  assert.match(html,/data-evidence-status="CAUTION"/);
  assert.match(html,/NOT validate the project's inversion, shear/);
});

test('profile-sensitive wind and speed-shear limits are read from selected effective policy',()=>{
  const fine=base();fine.pesticide_profile=getProfile('fine_airblast');
  const html=decisionExplanation(evaluated(fine),{mode:'demo'});
  assert.match(html,/at least 4\.5 mph: STOP/);
  const volatile=base();volatile.pesticide_profile=getProfile('volatile_formulation');
  const other=decisionExplanation(evaluated(volatile),{mode:'demo'});
  assert.match(other,/above 8\.0 mph: STOP/);
  assert.match(other,/greater than 0\.2°F: illustrative STOP/);
});

test('external/imported evaluations do not inherit internal thresholds or evidence attribution',()=>{
  const s=evaluated(base());
  s.evaluation.headline_reason='<script>untrusted</script>';
  const html=decisionExplanation(s,{mode:'imported'});
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;script&gt;untrusted&lt;\/script&gt;/);
  assert.match(html,/Calculation and thresholds unverified/);
  assert.doesNotMatch(html,/at least 4\.0 mph/);
  assert.doesNotMatch(html,/data-evidence-check=/);
});

test('sources are verifiable official and university extension pages, distinct from threshold authority',()=>{
  assert.equal(DECISION_SOURCES.length,5);
  for(const source of DECISION_SOURCES){
    assert.match(source.url,/^https:\/\//);
    assert.ok(source.supports);
  }
  const html=decisionExplanation(evaluated(base()));
  assert.match(html,/epa\.gov\/reducing-pesticide-drift/);
  assert.match(html,/extensionpubs\.unl\.edu/);
  assert.match(html,/ask\.ifas\.ufl\.edu/);
  assert.match(html,/nepis\.epa\.gov/);
  assert.match(html,/rel="noopener noreferrer"/);
  assert.match(html,/numeric cutoffs are project policy/);
  assert.match(html,/product label restrictions/);
});
