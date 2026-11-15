import { mountAudit } from './audit-ui.js';
import { simulateWeather, loadOrchardForecast, forecastWindow, locations } from './weather.js';
import { assertSnapshot, assertFresh, deltas, escapeHTML as esc, signed } from './contract.js';
import { scenario, evaluateDemo, demoForecast } from './demo.js';
import { orchardSVG } from './visualizer.js';
import { validateForecast, nextWindow, formatTime } from './timeline.js';
import { PROFILES, getProfile, thresholdsFor } from './engine/profiles.js';
import { wetBulbDepression } from './engine/wet-bulb.js';
import { createSession, startSpray, finishSpray, monitorSession } from './engine/session.js';

const $ = id => document.getElementById(id);
const titles = { GO:'SAFE TO SPRAY NOW', CAUTION:'CAUTION — MARGINAL DRIFT RISK', STOP:'DO NOT SPRAY — HIGH DRIFT RISK' };
const icons = { GO:'✓', CAUTION:'!', STOP:'×' };
const ruleNames = { INVERSION_DETECTED:'Temperature inversion', UPPER_WIND_EXCEEDED:'Upper wind exceeds limit', GROUND_WIND_EXCEEDED:'Ground wind exceeds limit', DIRECTIONAL_WIND_SHEAR:'Wind direction shift', VERTICAL_WIND_SHEAR:'Vertical wind shear', GROUND_WIND_TOO_CALM:'Ground wind too calm', UPPER_WIND_TOO_CALM:'Upper wind too calm', GROUND_WIND_CAUTION:'Ground wind near limit', UPPER_WIND_CAUTION:'Upper wind near limit', GROUND_EVAPORATIVE_RISK:'Ground evaporation risk', UPPER_EVAPORATIVE_RISK:'Canopy evaporation risk', POST_SPRAY_VOLATILITY_ALERT:'Post-spray volatility alert', DATA_INVALID:'Evaluation unavailable' };
let snapshot, mode='unavailable', activeScenario='trap', selectedHeight='canopy_30ft', adapter=null;
let forecast=[], intervalMinutes=30, timeZone='America/Los_Angeles', revision=0, timer, busy=false, invalid=false;
let audit;
let judgeGroundOnly=false;
let session=null, simulationMinute=0, overrides={}, weatherForecast=null, weatherRequest;
let forecastRequestId=0, forecastPoll=null;
const explicitDemo = new URLSearchParams(window.location.search).get('mode') === 'demo';
const selectedLocation = () => locations[$('weather-location').value];
const advanced = () => ['calm','evaporation','afternoon'].includes(activeScenario);
function replaySimulation() {
  snapshot=simulateWeather(activeScenario==='marginal'?'evaporation':activeScenario,simulationMinute,snapshot.pesticide_profile,overrides,activeScenario==='afternoon'?undefined:session);
  renderSnapshot();
}
let paused=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function controls() {
  const enabled=!busy&&!invalid&&(mode==='demo'||!!adapter?.evaluateProfile)&&session?.state!=='SPRAYING_IN_PROGRESS';
  $('volatility').disabled=!enabled; $('nozzle').disabled=!enabled;
  $('profile-preset').disabled=!enabled;
  $('profile-hint').textContent=busy ? 'Updating the evaluation…' : mode==='demo' ? 'Generic screening presets, not product labels. Try “Hot and dry” to see evaporation and wind warnings.' : adapter?.evaluateProfile ? 'Profile changes are evaluated by the connected risk engine.' : 'Profile controls require the team’s risk evaluator. This snapshot is read-only.';
  $('session-start').disabled=mode!=='demo'||activeScenario==='afternoon'||invalid||busy||session?.state==='SPRAYING_IN_PROGRESS'||session?.state==='POST_SPRAY_CURING'||snapshot?.evaluation.multi_height_status!=='GO';
  $('session-finish').disabled=mode!=='demo'||activeScenario==='afternoon'||invalid||session?.state!=='SPRAYING_IN_PROGRESS';
  $('session-example').disabled=mode!=='demo'||activeScenario==='afternoon'||invalid||session?.state==='SPRAYING_IN_PROGRESS';
  $('session-reset').disabled=mode!=='demo'||activeScenario==='afternoon'||!session;
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
  $('decision-label').textContent=`${mode==='forecast'?'MODELED FORECAST SCREENING':'CANOPYGUARD RECOMMENDATION'} · ${s}`;
  $('decision-title').textContent=titles[s];
  $('headline').textContent=e.headline_reason;
  $('decision-note').textContent=mode==='forecast'?'Estimated 5 ft/30 ft conditions from regional NWS forecast. NOT measured orchard conditions. Never treat forecast GO as spray clearance.':
    `Based on both heights · ${mode==='demo'?'Demonstration only':mode==='imported'?'Imported snapshot only':'Check on-site conditions before application'}`;
  $('rules').innerHTML=e.triggered_rules.length?e.triggered_rules.map(r=>`<li class="rule-card ${r.severity}"><div class="rule-head"><h3>• ${esc(ruleNames[r.code]||r.code.replaceAll('_',' '))}</h3><span class="mini-status">${r.severity}</span></div><p class="rule-metric">${esc(r.metric)}</p><p>${esc(r.explanation)}</p></li>`).join(''):`<li class="rule-empty">${s==='GO'?'✓ No risk rules triggered in this evaluation.':'Review the headline recommendation; no individual rules were supplied.'}</li>`;
  $('ground-readings').innerHTML=readings(snapshot.readings.ground_5ft);
  $('canopy-readings').innerHTML=readings(snapshot.readings.canopy_30ft);
  $('ground-status').className=`result-badge ${e.single_station_5ft_status}`;
  $('ground-status').textContent=`${icons[e.single_station_5ft_status]} ${mode==='forecast'?'Modeled Ground Screening':'Ground Station Says'}: ${e.single_station_5ft_status}${mode!=='forecast'&&e.single_station_5ft_status==='GO'?' (Looks Safe)':''}`;
  $('ground-reason').textContent=e.single_station_5ft_reason;
  const caught=e.caught_hidden_risk??(e.single_station_5ft_status==='GO'&&s==='STOP');
  $('canopy-status').className=`result-badge ${s}`;
  $('canopy-status').textContent=`${icons[s]} ${mode==='forecast'?'Modeled Multi-Height Screening':'CanopyGuard Says'}: ${s}${caught?' (Hidden Drift Risk Caught!)':''}`;
  $('delta-chips').innerHTML=`<span class="${d.temperature>0?'hot':''}">${signed(d.temperature)}°F ${d.temperature>0?'Inversion':'temperature difference'}</span><span>${signed(d.speed)} mph / ${Math.round(d.direction)}° Wind Shear</span>`;
  $('volatility').value=snapshot.pesticide_profile.volatility_class;
  $('nozzle').value=snapshot.pesticide_profile.nozzle_droplet_size;
  $('profile-name').textContent=snapshot.pesticide_profile.name+(mode==='demo'?' · Generic screening preset':'');
  const p=snapshot.pesticide_profile;
  $('profile-preset').value=Object.entries(PROFILES).find(([,v])=>Object.keys(v).every(k=>v[k]===p[k]))?.[0]||'custom';
  try {const limits=thresholdsFor(p);
    $('effective-limits').textContent=mode==='demo'?`Wind ${limits.minWind}–${limits.maxWind} mph · Inversion STOP >${limits.inversionStopAbove}°F · Speed-shear STOP ≥${limits.speedShearStopAt} mph`:`Supplied profile wind range: ${p.min_wind_mph}–${p.max_wind_mph} mph. Evaluation comes from the connected source.`;
  }catch{$('effective-limits').textContent='Profile limits conflict with the built-in screening policy. Review the evaluation.';}
  $('monitor-title').textContent='After the spray, keep watch.';
  $('monitor-risk').textContent=e.post_spray_volatility_risk;
  renderSession();renderSensor(); controls();syncWeatherControls();
  if(!judgeGroundOnly){
    let recordedSession=session;
    if(mode==='demo'&&activeScenario==='afternoon'){
      recordedSession={state:simulationMinute<15?'SPRAYING_IN_PROGRESS':'POST_SPRAY_CURING',
        pesticide_profile:getProfile('volatile_formulation')};
    }
    audit?.accept(snapshot,{source:mode,session:recordedSession});
  }
}
function renderSession() {
  $('session-panel').classList.remove('has-alert');
  if(mode==='demo'&&activeScenario==='afternoon'){
    const alert=snapshot.evaluation.triggered_rules.find(rule=>rule.code==='POST_SPRAY_VOLATILITY_ALERT');
    $('session-state').textContent=simulationMinute<15?'SPRAYING IN PROGRESS':'POST SPRAY CURING';
    $('session-summary').textContent=alert?.explanation??'Simulated volatile treatment starts at 3:00 PM and ends at 3:15 PM. Advance to 5:15 PM to see the alert.';
    $('session-panel').classList.toggle('has-alert',Boolean(alert));
    return;
  }
  if(!session){$('session-state').textContent='BEFORE SPRAY';$('session-summary').textContent=mode==='demo'?'No treatment recorded. Session controls are simulated for the demonstration.':'No local demo session. Recorded treatment monitoring must be supplied by the connected engine.';return;}
  const monitor=monitorSession(snapshot,session);
  $('session-state').textContent=session.state.replaceAll('_',' ');
  $('session-summary').textContent=`Recorded treatment: ${session.pesticide_profile.name}. ${monitor.message}`;
  $('session-panel')?.classList.toggle('has-alert',!!monitor.alert);
}
function clearForecast(message='No forecast connected. Awaiting the team’s forecast module.') {
  weatherForecast=null; forecast=[]; $('timeline').replaceChildren(); $('timeline-labels').replaceChildren();
  $('next-window').textContent='Next safe spray window: unavailable';
  $('forecast-detail').textContent=message;
  $('forecast-source').textContent='FORECAST UNAVAILABLE';
}
function renderForecast() {
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
  $('next-window').innerHTML=window?`<span class="window-icon" aria-hidden="true">◷</span><div>Next Safe Spray Window: ${formatTime(window.start,forecastZone)} – ${formatTime(window.end,forecastZone)} (${Number(window.hours.toFixed(1))} hrs)<small>${replayForecast?'Bundled morning replay · ':mode==='demo'&&!weatherForecast?'Illustrative GO window · ': 'Forecast GO window; recheck on-site · '}${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:forecastZone}).format(new Date(window.start))}</small></div>`:'No GO window in the supplied forecast. Check again before your next pass.';
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
  const ticket=++revision; busy=true;controls();
  try {
    const next=assertSnapshot(await adapter.loadSnapshot());
    if(ticket!==revision)return;
    assertFresh(next,Date.now(),adapter.maxAgeMs||300000);
    snapshot=structuredClone(next);busy=false;renderSnapshot();await fetchForecast(ticket);
  } catch(error) {if(ticket===revision)fail(error);}
}
async function changeProfile(preset) {
  if(invalid||busy)return;
  const profile=preset||{...snapshot.pesticide_profile,name:'Custom screening profile',volatility_class:$('volatility').value,nozzle_droplet_size:$('nozzle').value};
  const ticket=++revision;
  if(mode==='demo') {
    snapshot=evaluateDemo(snapshot,profile,session);
    if(advanced()||simulationMinute||Object.keys(overrides).length) replaySimulation(); else renderSnapshot();
    if(weatherForecast){
      weatherForecast.snapshots=weatherForecast.snapshots.map(row=>evaluateDemo(row,profile));
      weatherForecast.window=forecastWindow(weatherForecast.snapshots,Date.now(),weatherForecast.time_zone);
      forecast=weatherForecast.snapshots;
    }else forecast=demoForecast(profile);
    renderForecast();return;
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
    snapshot=structuredClone(checkProfile(result,profile));busy=false;renderSnapshot();await fetchForecast(ticket);
  } catch(error) {if(ticket===revision)fail(error);}
}
function useDemo(name='trap',resetProfile=false) {
  stopForecastPolling();
  if(!['trap','marginal','clear','calm','evaporation','afternoon'].includes(name))throw new Error('Unknown demo scenario');
  const previousProfile=mode==='demo'&&!resetProfile?snapshot?.pesticide_profile:undefined;
  if(mode!=='demo')session=null;
  ++revision;clearInterval(timer);adapter=null;mode='demo';activeScenario=name;busy=false;
  timeZone='America/Los_Angeles';intervalMinutes=30;
  simulationMinute=0;overrides={};weatherForecast=null;weatherRequest?.abort();resetPlayback();$('weather-network').textContent='';
  if(name==='afternoon')session=null;
  snapshot=name==='marginal'?scenario(name,previousProfile):simulateWeather(name,0,name==='afternoon'?undefined:previousProfile,{},session??undefined);
  if(session&&name==='marginal')snapshot=evaluateDemo(snapshot,snapshot.pesticide_profile,session);
  renderSnapshot();forecast=demoForecast(snapshot.pesticide_profile);renderForecast();
}
function setSnapshot(data) {
  exitJudge();
  stopForecastPolling();weatherRequest?.abort();
  ++revision;clearInterval(timer);adapter=null;mode='imported';busy=false;session=null;source();
  try {snapshot=structuredClone(assertSnapshot(data));renderSnapshot();clearForecast();}
  catch(error){fail(error);throw error;}
}
async function connect(config) {
  stopForecastPolling();weatherRequest?.abort();
  exitJudge();
  if(config?.mode!=='live'||typeof config.loadSnapshot!=='function')throw new Error('A live adapter with loadSnapshot is required.');
  const zone=config.timeZone||'America/Los_Angeles';new Intl.DateTimeFormat('en-US',{timeZone:zone});
  if(config.maxAgeMs!==undefined&&(!Number.isFinite(config.maxAgeMs)||config.maxAgeMs<=0))throw new Error('maxAgeMs must be positive.');
  if(config.pollMs!==undefined&&(!Number.isFinite(config.pollMs)||config.pollMs<1000))throw new Error('pollMs must be at least 1000.');
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
document.querySelectorAll('[data-scenario]').forEach(b=>b.addEventListener('click',()=>{exitJudge();useDemo(b.dataset.scenario);audit.accept(snapshot,{source:mode,session,event:'scenario selected'});}));
document.querySelectorAll('[data-height]').forEach(b=>b.addEventListener('click',()=>{if(invalid)return;selectedHeight=b.dataset.height;renderSensor();}));
$('volatility').addEventListener('change',()=>changeProfile());$('nozzle').addEventListener('change',()=>changeProfile());
$('profile-preset').addEventListener('change',()=>changeProfile(getProfile($('profile-preset').value)));
function updateDemoSession(){snapshot=evaluateDemo(snapshot,snapshot.pesticide_profile,session);renderSnapshot();}
$('session-start').addEventListener('click',()=>{if($('session-start').disabled)return;session=startSpray(createSession(snapshot.orchard_block,snapshot.pesticide_profile),snapshot.timestamp);updateDemoSession();});
$('session-finish').addEventListener('click',()=>{if($('session-finish').disabled)return;session=finishSpray(session,snapshot.timestamp,snapshot);updateDemoSession();});
$('session-reset').addEventListener('click',()=>{session=null;updateDemoSession();});
$('session-example').addEventListener('click',()=>{
  if($('session-example').disabled)return;
  const ended=new Date(Date.parse(snapshot.timestamp)-7200000).toISOString(),started=new Date(Date.parse(ended)-1800000).toISOString();
  const prior=scenario('clear',getProfile('volatile_formulation'));prior.timestamp=ended;
  session=finishSpray(startSpray(createSession(snapshot.orchard_block,prior.pesticide_profile),started),ended,prior);
  updateDemoSession();
});
function motion(){document.body.classList.toggle('paused',paused);$('motion-toggle').setAttribute('aria-pressed',String(paused));$('motion-toggle').textContent=paused?'Resume animation ▷':'Pause animation Ⅱ';}
$('motion-toggle').addEventListener('click',()=>{paused=!paused;motion();});motion();
$('import-button').addEventListener('click',()=>$('json-file').click());
$('json-file').addEventListener('change',async(event)=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>1000000)throw new Error('JSON file is too large (1 MB maximum).');setSnapshot(JSON.parse(await file.text()));}
  catch(error){++revision;clearInterval(timer);adapter=null;mode='imported';source();fail(error);}
  finally{event.target.value='';}
});
window.CanopyGuard=Object.freeze({connect,refresh,setSnapshot,useDemo,getSession:()=>session?structuredClone(session):null,setForecast(data,options={}){
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
let playback;
function resetPlayback(){clearInterval(playback);playback=null;$('weather-play').textContent='Play';}
for(const [height, title] of [['ground_5ft','5 ft ground'],['canopy_30ft','30 ft canopy']]){
  const panel=document.createElement('fieldset');
  panel.innerHTML=`<legend>${title}</legend>`;
  for(const [field,label,min,max,step] of sliderFields){
    const wrapper=document.createElement('label');
    wrapper.innerHTML=`${label} <output></output><input type="range" min="${min}" max="${max}" step="${step}" data-height-key="${height}" data-field="${field}">`;
    const slider=wrapper.querySelector('input');
    slider.addEventListener('input',()=>{
      (overrides[height]??={})[field]=Number(slider.value);replaySimulation();
    });
    panel.append(wrapper);
  }
  $('weather-sliders').append(panel);
}
function syncWeatherControls(){
  $('weather-panel').hidden=mode!=='demo';
  if(mode!=='demo'||!snapshot)return;
  $('weather-minute').max=activeScenario==='afternoon'?135:1440;
  $('weather-minute').value=simulationMinute;
  $('weather-clock').textContent=`Minute ${simulationMinute} · ${formatTime(snapshot.timestamp,'America/Los_Angeles')}`;
  for(const slider of $('weather-sliders').querySelectorAll('input')){
    const {heightKey,field}=slider.dataset;
    const value=overrides[heightKey]?.[field]??snapshot.readings[heightKey][field];
    slider.value=value;slider.previousElementSibling.value=value.toFixed(field==='wind_dir_deg'?0:1);
  }
}
$('weather-minute').addEventListener('input',event=>{simulationMinute=Number(event.target.value);replaySimulation();});
$('weather-reset').addEventListener('click',()=>{overrides={};replaySimulation();});
$('weather-play').addEventListener('click',()=>{
  if(playback)return resetPlayback();
  $('weather-play').textContent='Pause';
  playback=setInterval(()=>{
    if(mode!=='demo'||simulationMinute>=Number($('weather-minute').max))return resetPlayback();
    simulationMinute++;replaySimulation();
  },activeScenario==='afternoon'?80:40);
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
  weatherRequest?.abort();
  const request=new AbortController();
  weatherRequest=request;
  const token=++forecastRequestId;
  const profile=mode==='demo'?snapshot?.pesticide_profile:mode==='forecast'&&snapshot?snapshot.pesticide_profile:getProfile('contact_fungicide');
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
    const result=await loadOrchardForecast(id,profile,{cache,signal:request.signal});
    if(request.signal.aborted||token!==forecastRequestId||$('weather-location').value!==id)return;
    if(mode!=='demo'&&mode!=='unavailable'&&mode!=='forecast')return;
    if(result.source==='synthetic'&&mode!=='demo'){
      throw new Error('NWS unavailable and no valid cached forecast for '+locations[id].label+'. Offline synthetic values are disabled in production.');
    }
    weatherForecast=result;
    weatherForecast.snapshots=result.snapshots.map(row=>evaluateDemo(row,profile));
    weatherForecast.window=forecastWindow(weatherForecast.snapshots,Date.now(),result.time_zone);
    intervalMinutes=result.interval_minutes;
    timeZone=result.time_zone;
    forecast=weatherForecast.snapshots;
    if(mode!=='demo'){
      mode='forecast';
      // Current model period, NOT a live sensor observation.
      const now=Date.now();
      snapshot=forecast.find(row=>Date.parse(row.timestamp)+intervalMinutes*60000>now)||forecast[0];
      renderSnapshot();
    }
    renderForecast();
    $('weather-network').textContent=`${result.location_label}: ${result.source==='nws'?'NWS model retrieved':result.source==='cached_nws'?'Using previously cached NWS model (not current observations)':'OFFLINE DEMO simulation'}. ${result.fetched_at?'Retrieved '+new Intl.DateTimeFormat('en-US',{dateStyle:'short',timeStyle:'short',timeZone:result.time_zone}).format(new Date(result.fetched_at))+' local.':''} ${result.error?'Network: '+result.error:''}`;
  }catch(error){
    if(request.signal.aborted||token!==forecastRequestId)return;
    $('weather-network').textContent=`${locations[id].label}: ${error.message}`;
    if(mode!=='demo') {
      if(!weatherForecast||weatherForecast.location_id!==id){
        mode='unavailable';weatherForecast=null;forecast=[];
        clearForecast('Forecast unavailable for '+locations[id].label+'.');
        failNoObservation(error.message);
      }else{
        // Prior NWS-issued model remains displayed with explicit failure context.
        mode='forecast';source();
        $('forecast-source').textContent=locations[id].label+' · PREVIOUS NWS MODEL (REFRESH FAILED)';
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

audit=mountAudit({zone:()=>timeZone});
window.CanopyGuardAudit=Object.freeze({list:audit.list,setDispatcher:audit.setDispatcher});
const judgeLabels=[
  '0:00–0:45 · Show the ground station’s GO at 64°F and 4.8 mph.',
  '0:45–1:30 · Reveal the canopy inversion, STOP decision, and alert.',
  '1:30–2:15 · Show the post-spray alert and the 9:00 AM demo forecast window.',
  '2:15–3:00 · Review the hidden risk record and download the CSV.'
];
function exitJudge(){
  judgeGroundOnly=false;
  document.body.classList.remove('judge-ground','judge-reveal','judge-forecast','judge-audit');
  $('judge-ground').hidden=true;
  $('judge-cue').textContent='Select a step to drive the demonstration.';
  document.querySelectorAll('[data-judge]').forEach(button=>button.setAttribute('aria-pressed','false'));
}
function runJudge(step){
  exitJudge();
  document.querySelector(`[data-judge="${step}"]`).setAttribute('aria-pressed','true');
  $('judge-cue').textContent=judgeLabels[step-1];
  if(step===1){
    judgeGroundOnly=true;
    audit.suspend();
    session=null;
    useDemo('trap',true);
    document.body.classList.add('judge-ground');
    $('judge-ground').hidden=false;
    $('judge-ground').scrollIntoView({block:'start'});
  }else if(step===2){
    document.body.classList.add('judge-reveal');
    // Suppress the initial transition notification so the reveal produces exactly one preview.
    judgeGroundOnly=true;
    session=null;
    useDemo('trap',true);
    judgeGroundOnly=false;
    audit.accept(snapshot,{source:'demo',event:'judge canopy reveal',forceAlert:true});
    $('decision').scrollIntoView({block:'start'});
  }else if(step===3){
    document.body.classList.add('judge-forecast');
    useDemo('afternoon',true);
    simulationMinute=135;replaySimulation();
    $('forecast').scrollIntoView({block:'center'});
  }else{
    document.body.classList.add('judge-audit');
    audit.setFilter('hidden');
    $('audit-panel').scrollIntoView({block:'start'});
    audit.download();
  }
}
document.querySelectorAll('[data-judge]').forEach(button=>button.addEventListener('click',()=>runJudge(Number(button.dataset.judge))));
$('judge-exit').addEventListener('click',()=>{exitJudge();if(mode==='demo')renderSnapshot();});
if(explicitDemo)useDemo();
else startProductionForecast();
