import { mountAudit } from './audit-ui.js';
import { loadOrchardForecast, forecastWindow, locations, presetTimeOfDay } from './weather.js';
import { assertSnapshot, assertFresh, deltas, escapeHTML as esc, signed } from './contract.js';
import { evaluateDemo, demoForecast } from './demo.js';
import { reevaluateForecastModel, currentForecastPeriod } from './forecast-profile.js';
import { orchardSVG } from './visualizer.js';
import { validateForecast, nextWindow, formatTime } from './timeline.js';
import { PROFILES, getProfile, thresholdsFor } from './engine/profiles.js';
import { wetBulbDepression } from './engine/wet-bulb.js';
import { monitorSession } from './engine/session.js';
import { assertEvent, createEvent } from './events.js';
import { createDemoState, reduceDemoState, lastFrame, AFTERNOON_REPLAY_TIME } from './demo-controller.js';
import {createPlayback} from './playback.js';
import { mountCanopyView } from './canopy-view.js';

mountCanopyView(document.getElementById('canopy-view-slot'));
const $ = id => document.getElementById(id);
const titles = { GO:'GO — configured weather checks passed', CAUTION:'CAUTION — MARGINAL DRIFT RISK', STOP:'DO NOT SPRAY — HIGH DRIFT RISK' };
const icons = { GO:'✓', CAUTION:'!', STOP:'×' };
const ruleNames = { INVERSION_DETECTED:'Temperature inversion', UPPER_WIND_EXCEEDED:'Upper wind exceeds limit', GROUND_WIND_EXCEEDED:'Ground wind exceeds limit', DIRECTIONAL_WIND_SHEAR:'Wind direction shift', VERTICAL_WIND_SHEAR:'Vertical wind shear', GROUND_WIND_TOO_CALM:'Ground wind too calm', UPPER_WIND_TOO_CALM:'Upper wind too calm', GROUND_WIND_CAUTION:'Ground wind near limit', UPPER_WIND_CAUTION:'Upper wind near limit', GROUND_EVAPORATIVE_RISK:'Ground evaporation risk', UPPER_EVAPORATIVE_RISK:'Canopy evaporation risk', POST_SPRAY_VOLATILITY_ALERT:'Post-spray volatility alert', DATA_INVALID:'Evaluation unavailable' };
let snapshot, mode='unavailable', activeScenario='trap', selectedHeight='canopy_30ft', adapter=null;
// Keep the selected NWS screening profile independent of the currently loaded
// city and weather snapshot. It survives fetches, city changes and stale replies.
let forecastProfile=getProfile('contact_fungicide');
let forecast=[], intervalMinutes=30, timeZone='America/Los_Angeles', revision=0, timer, busy=false, invalid=false;
let audit;
let judgeGroundOnly=false;
let session=null, simulationMinute=0, overrides={}, weatherForecast=null, weatherRequest;
let forecastRequestId=0, forecastPoll=null;
const stationMemo=new Map(); // limits AZMET requests across the 30-second forecast refresh
const explicitDemo = new URLSearchParams(window.location.search).get('mode') === 'demo';
const selectedLocation = () => locations[$('weather-location').value];
let demoState=null, judgeReplay=null;
const currentDemo = () => judgeReplay ?? demoState;
const replayTreatment = () => mode==='demo' && currentDemo()?.session_source==='replay';
function applyDemoState(next) {
  if(judgeReplay)judgeReplay=next;else demoState=next;
  snapshot=next.snapshot;session=next.session;activeScenario=next.scenario;
  simulationMinute=next.minute;overrides=next.overrides;
}
function updateProfileForecast() {
  if(weatherForecast){
    weatherForecast.snapshots=weatherForecast.snapshots.map(row=>evaluateDemo(row,snapshot.pesticide_profile));
    weatherForecast.window=forecastWindow(weatherForecast.snapshots,Date.now(),weatherForecast.time_zone);
    forecast=weatherForecast.snapshots;
    const station=weatherForecast.station;
    if(station?.anchored_snapshot)station.anchored_snapshot=evaluateDemo(station.anchored_snapshot,snapshot.pesticide_profile);
  }else{
    intervalMinutes=30;forecast=demoForecast(snapshot.pesticide_profile);
  }
}
function auditSourceProvenance(){
  if(mode!=='forecast'||!weatherForecast)return null;
  return {kind:'nws_regional_modeled_heights',
    forecast_source:weatherForecast.source,location_id:weatherForecast.location_id,
    location_label:weatherForecast.location_label,time_zone:weatherForecast.time_zone,
    issued_at:weatherForecast.issued_at??null,issuance_source:weatherForecast.issuance_source??null,
    fetched_at:weatherForecast.fetched_at??null};
}
function publishSnapshot(action,{record=true,forceAlert=false,silentAlert=false}={}) {
  try{
    assertSnapshot(snapshot);
    renderSnapshot();
    // The source evaluator owns this context. Never substitute the later
    // action/recording wall clock for a paused or replayed evaluation.
    const evaluationContext=mode==='demo'?currentDemo()?.evaluationContext??{}:
      mode==='forecast'?weatherForecast?.evaluation_context??{}:{};
    if(record&&!judgeGroundOnly)audit?.accept(snapshot,{source:mode,session,action,forceAlert,silentAlert,evaluationContext,provenance:auditSourceProvenance(),
      ...(mode==='demo'?{demo_run_id:demoState.demo_run_id}:{})});
  }catch(error){fail(error);return false;}
  if(forecast.length)try{renderForecast();}catch(error){clearForecast(`Forecast unavailable: ${error.message}`);}
  return true;
}
function dispatchDemoEvent(action) {
  if(mode!=='demo')throw new Error('Demo events require demo mode.');
  try{
    assertEvent(action);
    if(audit?.hasEvent(action.event_id))return false;
    if(action.event_type==='SIMULATION_STEP'&&playback.isPlaying())return false;
    const resetting=action.event_type==='DEMO_RESET';
    const previous=resetting&&judgeReplay?{...demoState,
      handled_events:new Set([...demoState.handled_events,...judgeReplay.handled_events])}:currentDemo();
    const next=reduceDemoState(previous,action);
    if(next===previous)return false;
    if(resetting){
      resetPlayback();stopForecastPolling();++revision;clearInterval(timer);adapter=null;busy=false;
      exitJudge({restore:false});
      audit.resetDemoRun(demoState.demo_run_id);
      selectedHeight='canopy_30ft';timeZone='America/Los_Angeles';intervalMinutes=30;
      weatherForecast=null;$('weather-location').value='fresno';$('weather-network').textContent='';
    }
    applyDemoState(next);
    if(resetting||action.event_type==='PROFILE_CHANGED')updateProfileForecast();
    return publishSnapshot(resetting?{...action,event_type:'DEMO_INIT'}:action,{silentAlert:resetting});
  }catch(error){fail(error);return false;}
}
let paused=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function controls() {
  const enabled=!busy&&!invalid&&(mode==='demo'||(mode==='forecast'&&!!weatherForecast)||!!adapter?.evaluateProfile)&&session?.state!=='SPRAYING_IN_PROGRESS';
  $('volatility').disabled=!enabled; $('nozzle').disabled=!enabled;
  $('profile-preset').disabled=!enabled;
  $('profile-hint').textContent=busy ? 'Updating the evaluation…' :
    mode==='demo' ? 'Generic screening presets, not product labels. Try “Hot and dry” to see evaporation and wind warnings.' :
    mode==='forecast' ? 'NWS-derived heights are MODELED, not measured. Changes re-screen this forecast using CanopyGuard’s built-in engine; confirm on-site conditions and the product label.' :
    mode==='unavailable' ? 'Screening controls are unavailable until a qualified NWS forecast is loaded. No current measurements are connected.' :
    adapter?.evaluateProfile ? 'Profile changes are evaluated by the connected risk engine.' :
    mode==='imported' ? 'Imported snapshots are read-only. Use the interactive demo to explore profile settings.' :
    'Profile changes require a connected evaluator; this sensor snapshot is read-only.';
  if(mode==='demo'||mode==='forecast')$('profile-hint').textContent+=' Illustrative thresholds only; not product-label limits or application clearance.';
  $('session-start').disabled=mode!=='demo'||replayTreatment()||invalid||busy||session?.state==='SPRAYING_IN_PROGRESS'||session?.state==='POST_SPRAY_CURING'||snapshot?.evaluation.multi_height_status!=='GO';
  $('session-finish').disabled=mode!=='demo'||replayTreatment()||invalid||session?.state!=='SPRAYING_IN_PROGRESS';
  $('session-example').disabled=mode!=='demo'||replayTreatment()||invalid||session?.state==='SPRAYING_IN_PROGRESS';
  $('session-reset').disabled=mode!=='demo'||replayTreatment()||!session;
  $('weather-step').disabled=mode!=='demo'||invalid||busy||playback.isPlaying()||simulationMinute>=lastFrame(activeScenario);
  $('weather-play').disabled=mode!=='demo'||invalid||busy;
  $('demo-reset').disabled=mode!=='demo';
  document.querySelectorAll('[data-scenario]').forEach(b=>b.setAttribute('aria-pressed',String(mode==='demo'&&b.dataset.scenario===activeScenario)));
}
function source() {
  const badges={demo:'◉ DEMO · SIMULATED DATA',live:'◉ CONNECTED SENSOR DATA',imported:'◉ IMPORTED SNAPSHOT · NOT LIVE',
    forecast:weatherForecast?.source==='cached_nws'?'◉ CACHED NWS · MODELED HEIGHTS':'◉ NWS FORECAST · MODELED HEIGHTS',unavailable:'◉ CURRENT SENSOR DATA UNAVAILABLE'};
  $('source-badge').textContent=badges[mode]||badges.unavailable;
  $('footer-demo').textContent=mode==='demo'?'Hackathon demonstration · Not validated for application decisions':
    mode==='forecast'?'NWS regional weather modeled at 5 ft and 30 ft · NOT orchard sensor measurements':
    mode==='imported'?'Imported snapshot · Not a live sensor connection':
    mode==='live'?'Connected data · Verify on-site conditions and product label':'No connected observations · Do not spray based on unavailable data';
  $('demo-controls').hidden=mode!=='demo';
  $('weather-panel').hidden=mode!=='demo';
  $('judge-bar').hidden=mode!=='demo';
  $('session-panel').hidden=mode!=='demo'&&!session;
  $('demo-session-actions').hidden=mode!=='demo';
  $('session-demo-disclaimer').hidden=mode!=='demo';
  $('forecast-session-notice').hidden=mode==='demo';
  $('demo-entry').hidden=mode==='demo';
  $('forecast-entry').hidden=mode!=='demo';
}
function readings(r) {
  return `<div><div class="reading-value">${r.temp_f.toFixed(1)}<span class="reading-unit">°F</span></div><div class="reading-label">Air temperature</div></div><div><div class="reading-value">${r.wind_speed_mph.toFixed(1)}<span class="reading-unit">mph</span></div><div class="reading-label">Wind from <span class="direction-pill">${r.wind_speed_mph===0?'Calm':esc(r.wind_dir_cardinal)}</span></div></div><div><div class="reading-value">${r.humidity_pct.toFixed(0)}<span class="reading-unit">%</span></div><div class="reading-label">Humidity</div></div>`;
}
function renderSensor() {
  const r=snapshot.readings[selectedHeight], upper=selectedHeight==='canopy_30ft';
  $('orchard-svg').innerHTML=orchardSVG(snapshot,selectedHeight);
  $('sensor-title').textContent=upper?'Above canopy':'Inside the orchard';
  $('sensor-details').innerHTML=[['Temperature',`${r.temp_f.toFixed(1)}°F`],['Wind speed',`${r.wind_speed_mph.toFixed(1)} mph`],['Wind from',r.wind_speed_mph===0?'Calm':`${r.wind_dir_cardinal} · ${Math.round(r.wind_dir_deg)}°`],['Humidity',`${r.humidity_pct.toFixed(0)}%`]].map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  const wet=wetBulbDepression(r.temp_f,r.humidity_pct);
  $('sensor-details').insertAdjacentHTML('beforeend',`<div><dt>Wet-bulb depression<br><small>Approx. at sea level</small></dt><dd>${wet.available?`${wet.depression_c.toFixed(1)}°C`:'N/A'}</dd></div>`);
  $('layer-note').textContent=deltas(snapshot).temperature>0?'Warm air sits above cooler ground air. The animation illustrates lateral drift beneath that cap.':'The upper sensor is no warmer than the lower sensor. Review every risk rule before acting.';
  document.querySelectorAll('[data-height]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.height===selectedHeight)));
}
function renderSnapshot() {
  invalid=false;
  $('error-message').hidden=true;
  const e=snapshot.evaluation,s=e.multi_height_status,d=deltas(snapshot);
  source();
  $('block-name').textContent=snapshot.orchard_block;
  $('scenario-name').textContent=snapshot.scenario_name;
  $('observation-time').textContent=`${mode==='demo'?'Demo observation':mode==='forecast'?'Forecast valid time':mode==='imported'?'Imported timestamp':'Observed'} · ${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone,timeZoneName:'short'}).format(new Date(snapshot.timestamp))}`;
  $('decision').className=`decision ${s}`;
  $('decision-icon').textContent=icons[s];
  $('decision-label').textContent=`${mode==='forecast'?'MODELED FORECAST SCREENING':'PROTOTYPE SCREENING STATUS'} · ${s}`;
  $('decision-title').textContent=titles[s];
  $('headline').textContent=e.headline_reason;
  $('decision-note').textContent=mode==='forecast'?'Estimated 5 ft/30 ft conditions from regional NWS forecast. NOT measured orchard conditions. Never treat forecast GO as spray clearance.':
    `Based on both heights · ${mode==='demo'?'Demonstration only':mode==='imported'?'Imported snapshot only':'Check on-site conditions before application'}`;
  $('rules').innerHTML=e.triggered_rules.length?e.triggered_rules.map(r=>`<li class="rule-card ${r.severity}"><div class="rule-head"><h3>• ${esc(ruleNames[r.code]||r.code.replaceAll('_',' '))}</h3><span class="mini-status">${r.severity}</span></div><p class="rule-metric">${esc(r.metric)}</p><p>${esc(r.explanation)}</p></li>`).join(''):`<li class="rule-empty">${s==='GO'?'✓ No risk rules triggered in this evaluation.':'Review the headline recommendation; no individual rules were supplied.'}</li>`;
  $('ground-readings').innerHTML=readings(snapshot.readings.ground_5ft);
  $('canopy-readings').innerHTML=readings(snapshot.readings.canopy_30ft);
  $('ground-status').className=`result-badge ${e.single_station_5ft_status}`;
  $('ground-status').textContent=`${icons[e.single_station_5ft_status]} ${mode==='forecast'?'Modeled Ground Screening':'Ground-only comparison'}: ${e.single_station_5ft_status}`;
  $('ground-reason').textContent=e.single_station_5ft_reason;
  const caught=e.caught_hidden_risk??(e.single_station_5ft_status==='GO'&&s==='STOP');
  $('canopy-status').className=`result-badge ${s}`;
  $('canopy-status').textContent=`${icons[s]} ${mode==='forecast'?'Modeled Multi-Height Screening':'Prototype multi-height screening'}: ${s}${caught?' (Hidden Drift Risk Caught!)':''}`;
  $('delta-chips').innerHTML=`<span class="${d.temperature>0?'hot':''}">${signed(d.temperature)}°F ${d.temperature>0?'Inversion':'temperature difference'}</span><span>${signed(d.speed)} mph / ${Math.round(d.direction)}° Wind Shear</span>`;
  $('volatility').value=snapshot.pesticide_profile.volatility_class;
  $('nozzle').value=snapshot.pesticide_profile.nozzle_droplet_size;
  $('profile-name').textContent=snapshot.pesticide_profile.name+
    (mode==='demo'||mode==='forecast'?' · Illustrative screening preset':' · Connected/imported profile (not label-verified)');
  const p=snapshot.pesticide_profile;
  $('profile-preset').value=Object.entries(PROFILES).find(([,v])=>Object.keys(v).every(k=>v[k]===p[k]))?.[0]||'custom';
  try {const limits=thresholdsFor(p);
    $('effective-limits').textContent=mode==='demo'||mode==='forecast'
      ? `${mode==='forecast'?'Modeled screening limits · ':''}Wind ${limits.minWind}–${limits.maxWind} mph · Inversion STOP >${limits.inversionStopAbove}°F · Speed-shear STOP ≥${limits.speedShearStopAt} mph`
      : `Supplied profile wind range: ${p.min_wind_mph}–${p.max_wind_mph} mph. Evaluation comes from the connected source.`;
  }catch{$('effective-limits').textContent='Profile limits conflict with the built-in screening policy. Review the evaluation.';}
  $('monitor-title').textContent='After the spray, keep watch.';
  $('monitor-risk').textContent=e.post_spray_volatility_risk;
  renderSession();renderSensor(); controls();syncWeatherControls();
}
function renderSession() {
  $('session-panel').classList.remove('has-alert');
  if(!session){
    $('session-state').textContent=mode==='demo'?'BEFORE SPRAY':'NOT CONNECTED';
    $('session-summary').textContent=mode==='demo'
      ? 'No treatment recorded. Session controls are simulated for the demonstration.'
      : mode==='forecast'||mode==='unavailable'
        ? 'No treatment session connected. This forecast cannot verify actual spraying or provide post-application monitoring.'
        : 'No treatment session connected. Treatment events must be provided by an integrated monitoring system.';
    return;
  }
  const monitor=monitorSession(snapshot,session);
  $('session-state').textContent=session.state.replaceAll('_',' ');
  $('session-summary').textContent=`Recorded treatment: ${session.pesticide_profile.name}. ${monitor.message}`;
  $('session-panel')?.classList.toggle('has-alert',!!monitor.alert);
}
function clearForecast(message='No forecast connected. Awaiting the team’s forecast module.') {
  weatherForecast=null; forecast=[]; $('timeline').replaceChildren(); $('timeline-labels').replaceChildren();
  $('next-window').textContent='Next forecast GO window: unavailable';
  $('forecast-detail').textContent=message;
  $('forecast-source').textContent='FORECAST UNAVAILABLE';
  renderStationCheck();
}
/** AZMET station observation beside the regional model. Informational: it is not the
 * recorded decision, and nothing here is a measured 30 ft reading. */
function renderStationCheck() {
  const box=$('station-check'), station=weatherForecast?.station, problem=weatherForecast?.station_error;
  box.hidden=!station&&!problem;
  if(box.hidden){box.replaceChildren();return;}
  const line=(text,tag='p')=>{const node=document.createElement(tag);node.textContent=text;return node;};
  if(!station){
    box.replaceChildren(line('AZMET station check','h3'),line(`Station observation unavailable: ${problem}. The forecast shown is NWS-modeled only.`));
    return;
  }
  const zone=weatherForecast.time_zone, m=station.measured, h=station.heights;
  const size=(value,unit,more,less)=>Math.abs(value)<0.05?`the same${unit==='°F'?' temperature':' speed'}`:`${Math.abs(value).toFixed(1)}${unit} ${value>0?more:less}`;
  const lines=[line(`AZMET station check · ${station.station_name} (${station.station_id})`,'h3'),
    line(`Measured ${Math.round(station.age_minutes)} min ago (${formatTime(station.observed_at,zone)}): ${m.temp_f.toFixed(1)}°F and ${m.humidity_pct.toFixed(0)}% RH at ${h.temperature_ft} ft · ${m.wind_speed_mph.toFixed(1)} mph ${m.wind_speed_mph>0?'from '+m.wind_dir_cardinal:'(calm)'} at ${h.wind_ft} ft.`)];
  if(station.modeled_ground){
    // Differences are taken from the rounded values shown, so the sentence agrees with itself.
    const g=station.modeled_ground,round1=value=>Number(value.toFixed(1));
    const versus=(...args)=>size(...args)+(Math.abs(args[0])<0.05?' as the station':' than the station');
    const d={temp_f:round1(g.temp_f)-round1(m.temp_f),wind_speed_mph:round1(g.wind_speed_mph)-round1(m.wind_speed_mph)};
    lines.push(line(`NWS model for this hour estimates ${g.temp_f.toFixed(1)}°F and ${g.wind_speed_mph.toFixed(1)} mph near the ground: ${versus(d.temp_f,'°F','warmer','cooler')}, ${versus(d.wind_speed_mph,' mph','stronger','lighter')}.`));
  }else lines.push(line('No NWS model period covers this observation, so no comparison is shown.'));
  if(station.near_surface_gradient_f!==null){
    const g=station.near_surface_gradient_f;
    lines.push(line(`Measured between ${h.low_temperature_ft} ft and ${h.temperature_ft} ft: air is ${size(g,'°F','warmer','cooler')} above${g>0?' — a measured near-surface inversion signal.':'; no near-surface inversion signal.'}`));
  }
  if(station.anchored_snapshot){
    const e=station.anchored_snapshot.evaluation;
    const status=line(`Station-anchored screening: ${e.multi_height_status}. ${e.headline_reason}`);
    status.className=`station-status ${e.multi_height_status}`;
    lines.push(status,line('Uses the measured ground reading with the model’s vertical differences for 30 ft. Not a measured 30 ft reading and not the recorded decision above.','small'));
  }
  box.replaceChildren(...lines);
}
function renderForecast() {
  renderStationCheck();
  const forecastZone=weatherForecast?.time_zone??timeZone;
  validateForecast(forecast,intervalMinutes);
  const replayForecast=document.body.classList.contains('judge-forecast') && !weatherForecast;
  const now=replayForecast?Date.parse(forecast[0].timestamp):mode==='live'||weatherForecast?Date.now():Date.parse(snapshot.timestamp);
  const upcoming=forecast.filter(s=>Date.parse(s.timestamp)+intervalMinutes*60000>now).slice(0,Math.ceil(1440/intervalMinutes));
  if (!upcoming.length) return clearForecast('All supplied forecast periods are in the past.');
  const window=nextWindow(upcoming,intervalMinutes,now);
  $('forecast-title').textContent=`Your next ${Math.min(24,upcoming.length*intervalMinutes/60)} hours.`;
  $('forecast-source').textContent=weatherForecast?
    `${weatherForecast.location_label} · ${({nws:'NWS · MODELED HEIGHTS',cached_nws:'CACHED NWS · MODELED HEIGHTS',synthetic:'OFFLINE SIMULATION · NO LIVE NWS'})[weatherForecast.source]}`:
    mode==='demo'?'SIMULATED FORECAST · NOT NWS':mode==='imported'?'IMPORTED FORECAST · NOT LIVE':'CONNECTED FORECAST';
  $('next-window').innerHTML=window?`<span class="window-icon" aria-hidden="true">◷</span><div>${weatherForecast?'Next modeled GO window':mode==='demo'?'Next demo GO window':'Next forecast GO window'}: ${formatTime(window.start,forecastZone)} – ${formatTime(window.end,forecastZone)} (${Number(window.hours.toFixed(1))} hrs)<small>${replayForecast?'Bundled morning replay · ':mode==='demo'&&!weatherForecast?'Illustrative GO window · ': 'Forecast GO window; recheck on-site · '}${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:forecastZone}).format(new Date(window.start))}</small></div>`:'No GO window in the supplied forecast. Check again before your next pass.';
  $('timeline').innerHTML=upcoming.map((s,i)=>{const label=`${formatTime(s.timestamp,forecastZone)}: ${s.evaluation.multi_height_status}`;return `<button type="button" class="${s.evaluation.multi_height_status}" data-period="${i}" aria-label="${esc(label)}" title="${esc(label)}" aria-pressed="false"></button>`;}).join('');
  const start=Date.parse(upcoming[0].timestamp),end=Date.parse(upcoming.at(-1).timestamp)+intervalMinutes*60000;
  $('timeline-labels').innerHTML=Array.from({length:7},(_,i)=>`<span>${formatTime(start+(end-start)*i/6,forecastZone)}</span>`).join('');
  $('forecast-zone').textContent=`${forecastZone.replaceAll('_',' ')} · ${intervalMinutes}-minute periods`;
  const inversion=upcoming.find(s=>deltas(s).temperature>0 && Date.parse(s.timestamp)>=(window?.end||now));
  $('forecast-detail').textContent=inversion?`${mode==='demo'?'Demo warning':'Modeled forecast warning'} for ${weatherForecast?.location_label||'selected site'}: Thermal inversion at ${formatTime(inversion.timestamp,forecastZone)}. Select a period to inspect its recommendation.`:'Select a period to inspect its recommendation. Heights are modeled, not measured.';
  $('timeline').querySelectorAll('button').forEach((button,i)=>button.addEventListener('click',()=>{
    $('timeline').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    const s=upcoming[i];
    $('forecast-detail').textContent=`${formatTime(s.timestamp,forecastZone)} – ${formatTime(Date.parse(s.timestamp)+intervalMinutes*60000,forecastZone)} · ${s.evaluation.multi_height_status} · ${s.evaluation.headline_reason}`;
  }));
}
function fail(error) {
  resetPlayback();
  audit?.suspend();
  source();
  $('block-name').textContent=selectedLocation()?.label||'Selected orchard';
  $('scenario-name').textContent='No verified on-site readings';
  $('observation-time').textContent='Current observations unavailable';
  invalid=true;busy=false;
  $('decision').className='decision STOP'; $('decision-icon').textContent='!';
  $('decision-title').textContent='DATA UNAVAILABLE — DO NOT SPRAY';
  $('decision-label').textContent='CANOPYGUARD · NO VERIFIED OBSERVATIONS';
  $('headline').textContent='A current recommendation cannot be verified.';
  $('decision-note').textContent='No valid spray decision is available.';
  $('error-message').textContent=error.message||String(error); $('error-message').hidden=false;
  $('rules').replaceChildren();
  for(const id of ['ground-readings','canopy-readings','ground-reason','delta-chips','sensor-details','monitor-risk']) $(id).replaceChildren();
  for(const id of ['ground-status','canopy-status']) {$(id).className='result-badge STOP';$(id).textContent='Unavailable — check data';}
  $('orchard-svg').textContent='Visualization paused: valid readings are required.';
  $('layer-note').textContent='Check the data connection before proceeding.';
  clearForecast('No valid current readings; forecast is not a substitute for on-site measurements.');controls();
}
function checkProfile(result,profile) {
  assertSnapshot(result);
  if (JSON.stringify(result.pesticide_profile)!==JSON.stringify(profile)) {
    for(const k of Object.keys(profile)) if(result.pesticide_profile[k]!==profile[k]) throw new Error('Evaluator returned a different pesticide profile.');
  }
  if(mode==='live') assertFresh(result,Date.now(),adapter?.maxAgeMs||300000);
  return result;
}
async function fetchForecast(ticket) {
  clearForecast(adapter?.loadForecast?'Loading forecast…':undefined);
  if(!adapter?.loadForecast) return;
  try {
    const periods=await adapter.loadForecast(structuredClone(snapshot.pesticide_profile));
    if(ticket!==revision) return;
    validateForecast(periods,intervalMinutes);
    periods.forEach(s=>{for(const key of Object.keys(snapshot.pesticide_profile)) if(s.pesticide_profile[key]!==snapshot.pesticide_profile[key]) throw new Error('Forecast profile does not match the active pesticide profile.');});
    forecast=structuredClone(periods);renderForecast();
  } catch(error) {if(ticket===revision) clearForecast(`Forecast unavailable: ${error.message}`);}
}
async function refresh() {
  if(!adapter||busy) return;
  const action=createEvent('LIVE_OBSERVATION');
  const ticket=++revision; busy=true;controls();
  try {
    const next=assertSnapshot(await adapter.loadSnapshot());
    if(ticket!==revision)return;
    assertFresh(next,Date.now(),adapter.maxAgeMs||300000);
    snapshot=structuredClone(next);busy=false;
    if(publishSnapshot(action))await fetchForecast(ticket);
  } catch(error) {if(ticket===revision)fail(error);}
}
async function changeProfile(preset) {
  if(invalid||busy)return;
  const profile=preset||{...snapshot.pesticide_profile,name:'Custom screening profile',volatility_class:$('volatility').value,nozzle_droplet_size:$('nozzle').value};
  const action=createEvent('PROFILE_CHANGED',{profile});
  const ticket=++revision;
  if(mode==='demo') {
    dispatchDemoEvent(action);return;
  }
  if(mode==='forecast' && weatherForecast) {
    try {
      // A network reply captured under the previous profile must not replace
      // this selection. Preserve the issued/retrieved weather metadata.
      ++forecastRequestId;
      weatherRequest?.abort();
      weatherRequest=null;
      const nowMs=Date.now();
      const updated=reevaluateForecastModel(weatherForecast,profile,nowMs);
      const current=currentForecastPeriod(updated,nowMs);
      assertSnapshot(current);
      forecastProfile=structuredClone(profile);
      weatherForecast=updated;
      forecast=updated.snapshots;
      snapshot=current;
      publishSnapshot(action); // Exact profile, decisions and thresholds go to v2 audit.
    }catch(error){fail(error);}
    return;
  }
  if(!adapter?.evaluateProfile)return;
  audit?.suspend();
  busy=true;controls();clearForecast('Updating forecast for the selected profile…');
  // Remove the previous GO while the new combination is being evaluated.
  $('decision').className='decision CAUTION';$('decision-icon').textContent='…';
  $('decision-title').textContent='WAIT — UPDATING EVALUATION';
  $('decision-label').textContent='NEW PROFILE · EVALUATION PENDING';
  $('headline').textContent='Wait for the updated recommendation before proceeding.';
  $('rules').replaceChildren();
  for(const id of ['ground-status','canopy-status']) {$(id).className='result-badge CAUTION';$(id).textContent='Evaluation pending';}
  try {
    const result=await adapter.evaluateProfile(structuredClone(snapshot),profile);
    if(ticket!==revision)return;
    snapshot=structuredClone(checkProfile(result,profile));busy=false;
    if(publishSnapshot(action))await fetchForecast(ticket);
  } catch(error) {if(ticket===revision)fail(error);}
}
function useDemo(name='trap') {
  const continuing=mode==='demo'&&demoState!==null;
  const action=createEvent(continuing?'SCENARIO_SELECTED':'DEMO_INIT',{name});
  let next;
  try{next=continuing?reduceDemoState(demoState,action):createDemoState({scenario:name,demo_run_id:action.event_id});}
  catch(error){fail(error);throw error;}
  stopForecastPolling();
  exitJudge({restore:false});
  ++revision;clearInterval(timer);adapter=null;mode='demo';busy=false;
  timeZone='America/Los_Angeles';intervalMinutes=30;
  weatherForecast=null;weatherRequest?.abort();resetPlayback();$('weather-network').textContent='';
  applyDemoState(next);
  forecast=demoForecast(snapshot.pesticide_profile);
  publishSnapshot(action);
}
function setSnapshot(data) {
  const action=createEvent('SNAPSHOT_IMPORTED');
  stopForecastPolling();
  exitJudge({restore:false});resetPlayback();weatherRequest?.abort();
  ++revision;clearInterval(timer);adapter=null;mode='imported';busy=false;session=null;source();
  try {snapshot=structuredClone(assertSnapshot(data));clearForecast();publishSnapshot(action);}
  catch(error){fail(error);throw error;}
}
async function connect(config) {
  if(config?.mode!=='live'||typeof config.loadSnapshot!=='function')throw new Error('A live adapter with loadSnapshot is required.');
  const zone=config.timeZone||'America/Los_Angeles';new Intl.DateTimeFormat('en-US',{timeZone:zone});
  if(config.maxAgeMs!==undefined&&(!Number.isFinite(config.maxAgeMs)||config.maxAgeMs<=0))throw new Error('maxAgeMs must be positive.');
  if(config.pollMs!==undefined&&(!Number.isFinite(config.pollMs)||config.pollMs<1000))throw new Error('pollMs must be at least 1000.');
  stopForecastPolling();
  exitJudge({restore:false});resetPlayback();weatherRequest?.abort();
  ++revision;clearInterval(timer);adapter=config;mode='live';busy=false;session=null;timeZone=zone;intervalMinutes=config.forecastIntervalMinutes||30;source();
  fail(new Error('Connecting to orchard sensors…'));
  await refresh();
  if(adapter!==config)return;
  let lastPoll=Date.now();
  timer=setInterval(()=>{
    if(!invalid&&snapshot)try{assertFresh(snapshot,Date.now(),adapter.maxAgeMs||300000);}catch(error){++revision;fail(error);}
    if(Date.now()-lastPoll >= (config.pollMs||30000)){lastPoll=Date.now();refresh();}
  },1000);
}
document.querySelectorAll('[data-scenario]').forEach(b=>b.addEventListener('click',()=>useDemo(b.dataset.scenario)));
document.querySelectorAll('[data-height]').forEach(b=>b.addEventListener('click',()=>{if(invalid)return;selectedHeight=b.dataset.height;renderSensor();}));
$('volatility').addEventListener('change',()=>changeProfile());$('nozzle').addEventListener('change',()=>changeProfile());
$('profile-preset').addEventListener('change',()=>changeProfile(getProfile($('profile-preset').value)));
for(const [id,type] of [['session-start','SESSION_STARTED'],['session-finish','SESSION_FINISHED'],
  ['session-reset','SESSION_RESET'],['session-example','SESSION_EXAMPLE']]){
  $(id).addEventListener('click',()=>{if(!$(id).disabled)dispatchDemoEvent(createEvent(type));});
}
function motion(){document.body.classList.toggle('paused',paused);$('motion-toggle').setAttribute('aria-pressed',String(paused));$('motion-toggle').textContent=paused?'Resume animation ▷':'Pause animation Ⅱ';}
$('motion-toggle').addEventListener('click',()=>{paused=!paused;motion();});motion();
$('import-button').addEventListener('click',()=>$('json-file').click());
$('json-file').addEventListener('change',async(event)=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>1000000)throw new Error('JSON file is too large (1 MB maximum).');setSnapshot(JSON.parse(await file.text()));}
  catch(error){++revision;clearInterval(timer);adapter=null;mode='imported';source();fail(error);}
  finally{event.target.value='';}
});
window.CanopyGuard=Object.freeze({connect,refresh,setSnapshot,useDemo,dispatchDemoEvent,
  resetDemo:()=>mode==='demo'&&dispatchDemoEvent(createEvent('DEMO_RESET')),
  stepDemo:()=>playback.step(),
  getSession:()=>session?structuredClone(session):null,setForecast(data,options={}){
  if(invalid)throw new Error('A valid snapshot is required before forecasts.');
  intervalMinutes=options.intervalMinutes||30;
  validateForecast(data,intervalMinutes);
  for(const s of data)for(const k of Object.keys(snapshot.pesticide_profile))if(s.pesticide_profile[k]!==snapshot.pesticide_profile[k])throw new Error('Forecast profile does not match current selection.');
  forecast=structuredClone(data);renderForecast();
}});
const sliderFields = [
  ['temp_f','Temperature (°F)',-20,125,0.1],['wind_speed_mph','Wind (mph)',0,50,0.1],
  ['wind_dir_deg','Wind from (°)',0,360,1],['humidity_pct','Relative humidity (%)',0,100,1]
];
const playback=createPlayback({
  canAdvance:()=>mode==='demo'&&!invalid&&!busy&&simulationMinute<lastFrame(activeScenario),
  tick:()=>dispatchDemoEvent(createEvent('SIMULATION_TICK')),
  step:()=>dispatchDemoEvent(createEvent('SIMULATION_STEP')),
  onChange:playing=>{$('weather-play').textContent=playing?'Pause':'Play';controls();}
});
function resetPlayback(){playback.pause();}
for(const [height, title] of [['ground_5ft','5 ft ground'],['canopy_30ft','30 ft canopy']]){
  const panel=document.createElement('fieldset');
  panel.innerHTML=`<legend>${title}</legend>`;
  for(const [field,label,min,max,step] of sliderFields){
    const wrapper=document.createElement('label');
    wrapper.innerHTML=`${label} <output></output><input type="range" min="${min}" max="${max}" step="${step}" data-height-key="${height}" data-field="${field}">`;
    const slider=wrapper.querySelector('input');
    slider.addEventListener('input',()=>{
      dispatchDemoEvent(createEvent('READING_CHANGED',{height,field,value:Number(slider.value)}));
    });
    panel.append(wrapper);
  }
  $('weather-sliders').append(panel);
}
function syncWeatherControls(){
  $('weather-panel').hidden=mode!=='demo';
  if(mode!=='demo'||!snapshot)return;
  $('weather-step').disabled=playback.isPlaying()||invalid||simulationMinute>=lastFrame(activeScenario);
  $('weather-minute').max=lastFrame(activeScenario);
  $('weather-minute').value=simulationMinute;
  // The slider scrubs the scenario's own day from its anchor time. The simulation clock stays
  // separate and only moves forward, so audit and treatment times are never backdated.
  const preset=activeScenario==='marginal'?'evaporation':activeScenario, last=lastFrame(activeScenario);
  $('weather-start').textContent=presetTimeOfDay(preset);
  $('weather-end').textContent=presetTimeOfDay(preset,last)+(last>=1440?' next day':'');
  $('weather-minute').setAttribute('aria-valuetext',presetTimeOfDay(preset,simulationMinute));
  $('weather-clock').textContent=`Conditions for ${presetTimeOfDay(preset,simulationMinute)} · simulation clock ${formatTime(snapshot.timestamp,'America/Los_Angeles')}`;
  for(const slider of $('weather-sliders').querySelectorAll('input')){
    const {heightKey,field}=slider.dataset;
    const value=overrides[heightKey]?.[field]??snapshot.readings[heightKey][field];
    slider.value=value;slider.previousElementSibling.value=value.toFixed(field==='wind_dir_deg'?0:1);
  }
}
$('weather-minute').addEventListener('input',event=>dispatchDemoEvent(createEvent('FRAME_SELECTED',{minute:Number(event.target.value)})));
$('weather-reset').addEventListener('click',()=>dispatchDemoEvent(createEvent('OVERRIDES_RESET')));
$('weather-step').addEventListener('click',()=>playback.step());
$('demo-reset').addEventListener('click',()=>window.CanopyGuard.resetDemo());
$('weather-play').addEventListener('click',()=>{
  if(playback.isPlaying())return resetPlayback();
  playback.start(activeScenario==='afternoon'?80:40);
});
// Keep this list synchronized with the service registry; IDs are used for cache isolation.
for (const [id,place] of Object.entries(locations)) {
  const option=document.createElement('option');
  option.value=id;option.textContent=place.label;
  $('weather-location').append(option);
}
$('weather-location').value='fresno';

function stopForecastPolling() {
  if(forecastPoll!==null){clearInterval(forecastPoll);forecastPoll=null;}
  forecastRequestId++;
  weatherRequest?.abort();
  weatherRequest=null;
}
async function requestOrchardForecast({showLoading=true}={}) {
  const id=$('weather-location').value;
  if(!Object.hasOwn(locations,id))return;
  const action=createEvent('FORECAST_REFRESHED',{location_id:id});
  weatherRequest?.abort();
  const request=new AbortController();
  weatherRequest=request;
  const token=++forecastRequestId;
  const profile=mode==='demo'?snapshot?.pesticide_profile:forecastProfile;
  if(showLoading) $('weather-network').textContent=`Loading NWS hourly forecast for ${locations[id].label}…`;
  if(mode==='unavailable'||mode==='forecast'){
    // On background refresh preserve the last usable forecast/model display.
    // A deliberate location switch immediately removes the old city's data.
    const switching=weatherForecast?.location_id && weatherForecast.location_id!==id;
    if(switching||!weatherForecast){
      mode='unavailable';
      source();
      clearForecast('Loading NWS weather model for '+locations[id].label+'…');
      failNoObservation('Loading modeled NWS conditions for '+locations[id].label+'…');
    } else if(showLoading){
      $('weather-network').textContent='Refreshing NWS forecast for '+locations[id].label+'…';
    }
  }
  try {
    let cache;
    try{cache=window.localStorage;}catch{}
    const result=await loadOrchardForecast(id,profile,{cache,signal:request.signal,stationMemo});
    if(request.signal.aborted||token!==forecastRequestId||$('weather-location').value!==id)return;
    if(mode!=='demo'&&mode!=='unavailable'&&mode!=='forecast')return;
    if(result.source==='synthetic'&&mode!=='demo'){
      throw new Error('NWS unavailable and no valid cached forecast for '+locations[id].label+'. Offline synthetic values are disabled in production.');
    }
    const nowMs=Date.now();
    const updated=reevaluateForecastModel(result,profile,nowMs);
    weatherForecast=updated;
    intervalMinutes=updated.interval_minutes;
    timeZone=updated.time_zone;
    forecast=updated.snapshots;
    if(mode!=='demo'){
      mode='forecast';
      // A selected forecast period is NOT a live sensor observation.
      snapshot=currentForecastPeriod(updated,nowMs);
      if(!publishSnapshot(action))return;
    }else renderForecast();
    $('weather-network').textContent=`${result.location_label}: ${result.source==='nws'?'NWS model retrieved':result.source==='cached_nws'?'Using previously cached NWS model (not current observations)':'OFFLINE DEMO simulation'}. ${result.issued_at?'NWS '+result.issuance_source+' '+new Intl.DateTimeFormat('en-US',{dateStyle:'short',timeStyle:'short',timeZone:result.time_zone}).format(new Date(result.issued_at))+' local ('+Math.round(result.issuance_age_minutes)+' min old).':''} ${result.fetched_at?'Retrieved '+new Intl.DateTimeFormat('en-US',{dateStyle:'short',timeStyle:'short',timeZone:result.time_zone}).format(new Date(result.fetched_at))+' local.':''} ${result.error?'Network: '+result.error:''}`;
  }catch(error){
    if(request.signal.aborted||token!==forecastRequestId)return;
    $('weather-network').textContent=`${locations[id].label}: ${error.message}`;
    if(mode!=='demo') {
      if(!weatherForecast||weatherForecast.location_id!==id){
        mode='unavailable';weatherForecast=null;forecast=[];
        clearForecast('Forecast unavailable for '+locations[id].label+'.');
        failNoObservation(error.message);
      }else{
        // Do not keep showing a previously issued model after its source age expires.
        const issuanceMs=Date.parse(weatherForecast.issued_at);
        const age=Date.now()-issuanceMs;
        if(!Number.isFinite(issuanceMs)||age>6*3600000||age< -5*60000){
          mode='unavailable';weatherForecast=null;forecast=[];
          clearForecast('Previous NWS model has expired.');
          failNoObservation('Previous NWS issuance is stale or unverified; no current modeled forecast is available.');
        }else{
          mode='forecast';source();
          $('forecast-source').textContent=locations[id].label+' · PREVIOUS NWS MODEL (REFRESH FAILED)';
        }
      }
    }
  }finally{
    if(weatherRequest===request)weatherRequest=null;
  }
}
function failNoObservation(message) {
  invalid=true;
  source();
  $('block-name').textContent=selectedLocation()?.label||'Selected forecast city';
  $('scenario-name').textContent='Modeled forecast cannot verify on-site conditions';
  $('observation-time').textContent='Measured 5 ft and 30 ft data unavailable';
  $('decision').className='decision STOP';
  $('decision-icon').textContent='!';
  $('decision-title').textContent='DATA UNAVAILABLE — DO NOT SPRAY';
  $('decision-label').textContent='CANOPYGUARD · NO MEASURED ORCHARD DATA';
  $('headline').textContent='An on-site spraying recommendation cannot be verified.';
  $('decision-note').textContent='Regional NWS model is not an orchard sensor measurement.';
  $('error-message').hidden=false;
  $('error-message').textContent=message;
  for(const id of ['ground-readings','canopy-readings','ground-reason','delta-chips','sensor-details','monitor-risk'])$(id).replaceChildren();
  for(const id of ['ground-status','canopy-status']){$(id).className='result-badge STOP';$(id).textContent='Unavailable — no measured readings';}
  $('orchard-svg').textContent='Orchard sensor readings unavailable.';
  $('layer-note').textContent='NWS forecast heights are modeled and not verified orchard observations.';
  $('rules').replaceChildren();
  audit?.suspend();
  renderSession();
  controls();
}
$('weather-fetch').addEventListener('click',()=>requestOrchardForecast());
$('weather-location').addEventListener('change',()=>{
  if(mode==='demo'||mode==='forecast'||mode==='unavailable')requestOrchardForecast();
});
function startProductionForecast() {
  mode='unavailable';source();
  failNoObservation('Connecting to NWS for '+selectedLocation().label+'; no on-site sensors are connected.');
  requestOrchardForecast();
  // Refresh requests at most every 30 seconds. A pending fetch is aborted on the
  // next interval; stale responses cannot update the selected location.
  forecastPoll=setInterval(()=> {
    if(mode==='forecast'||mode==='unavailable') requestOrchardForecast({showLoading:false});
  },30000);
}

function recordManualSnapshot() {
  if(invalid||busy||judgeGroundOnly)return;
  const action=createEvent('MANUAL_SNAPSHOT_RECORDED');
  return mode==='demo'?dispatchDemoEvent(action):publishSnapshot(action);
}
audit=mountAudit({zone:()=>timeZone,onRecordSnapshot:recordManualSnapshot});
window.CanopyGuardAudit=Object.freeze({list:audit.list,setDispatcher:audit.setDispatcher,recordSnapshot:recordManualSnapshot});
const judgeLabels=[
  '0:00–0:45 · Show the ground station’s GO at 64°F and 4.8 mph.',
  '0:45–1:30 · Reveal the canopy inversion, STOP decision, and alert.',
  '1:30–2:15 · Show the post-spray alert and the 9:00 AM demo forecast window.',
  '2:15–3:00 · Review the hidden risk record and download the CSV.'
];
function clearJudgePresentation(){
  judgeGroundOnly=false;
  document.body.classList.remove('judge-ground','judge-reveal','judge-forecast','judge-audit');
  $('judge-ground').hidden=true;
  $('judge-cue').textContent='Select a step to drive the demonstration.';
  document.querySelectorAll('[data-judge]').forEach(button=>button.setAttribute('aria-pressed','false'));
}
function exitJudge({restore=true}={}){
  clearJudgePresentation();
  if(!judgeReplay)return;
  judgeReplay=null;resetPlayback();weatherRequest?.abort();
  if(restore&&mode==='demo'){
    applyDemoState(demoState);
    weatherForecast=null;intervalMinutes=30;forecast=demoForecast(snapshot.pesticide_profile);
    publishSnapshot(createEvent('JUDGE_EXIT'));
  }
}
function startJudgeReplay(name,action,options={}){
  if(mode!=='demo'||!demoState)demoState=createDemoState({demo_run_id:action.event_id});
  stopForecastPolling();
  ++revision;clearInterval(timer);adapter=null;resetPlayback();weatherRequest?.abort();
  mode='demo';busy=false;timeZone='America/Los_Angeles';intervalMinutes=30;weatherForecast=null;
  // Judge replay has an isolated clock/session. Exiting restores the user's demo.
  judgeReplay=createDemoState({scenario:name,clock_iso:name==='afternoon'?AFTERNOON_REPLAY_TIME:undefined,demo_run_id:demoState.demo_run_id});
  applyDemoState(judgeReplay);forecast=demoForecast(snapshot.pesticide_profile);
  $('weather-network').textContent='';
  publishSnapshot(action,options);
}
function runJudge(step){
  clearJudgePresentation();
  document.querySelector(`[data-judge="${step}"]`).setAttribute('aria-pressed','true');
  $('judge-cue').textContent=judgeLabels[step-1];
  if(step===1){
    judgeGroundOnly=true;
    audit.suspend();
    document.body.classList.add('judge-ground');
    startJudgeReplay('trap',createEvent('JUDGE_GROUND_VIEW'),{record:false});
    $('judge-ground').hidden=false;
    $('judge-ground').scrollIntoView({block:'start'});
  }else if(step===2){
    document.body.classList.add('judge-reveal');
    startJudgeReplay('trap',createEvent('JUDGE_CANOPY_REVEAL'),{forceAlert:true});
    $('decision').scrollIntoView({block:'start'});
  }else if(step===3){
    document.body.classList.add('judge-forecast');
    startJudgeReplay('afternoon',createEvent('JUDGE_REPLAY_STARTED'));
    dispatchDemoEvent(createEvent('FRAME_SELECTED',{minute:135}));
    $('forecast').scrollIntoView({block:'center'});
  }else{
    document.body.classList.add('judge-audit');
    audit.setFilter('hidden');
    $('audit-panel').scrollIntoView({block:'start'});
    audit.download();
  }
}
document.querySelectorAll('[data-judge]').forEach(button=>button.addEventListener('click',()=>runJudge(Number(button.dataset.judge))));
$('judge-exit').addEventListener('click',()=>exitJudge());
if(explicitDemo)useDemo();
else startProductionForecast();
