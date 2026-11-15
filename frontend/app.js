import { assertSnapshot, assertFresh, deltas, escapeHTML as esc, signed } from './contract.js';
import { scenario, evaluateDemo, demoForecast } from './demo.js';
import { orchardSVG } from './visualizer.js';
import { validateForecast, nextWindow, formatTime } from './timeline.js';

const $ = id => document.getElementById(id);
const titles = { GO:'SAFE TO SPRAY NOW', CAUTION:'CAUTION — MARGINAL DRIFT RISK', STOP:'DO NOT SPRAY — HIGH DRIFT RISK' };
const icons = { GO:'✓', CAUTION:'!', STOP:'×' };
const ruleNames = { INVERSION_DETECTED:'Temperature inversion', UPPER_WIND_EXCEEDED:'Upper wind exceeds limit', DIRECTIONAL_WIND_SHEAR:'Wind direction shift', GROUND_WIND_OUTSIDE_RANGE:'Ground wind outside range', DEMO_VOLATILITY:'Volatility sensitivity', DEMO_FINE_DROPLETS:'Fine-droplet sensitivity' };
let snapshot, mode='demo', activeScenario='trap', selectedHeight='canopy_30ft', adapter=null;
let forecast=[], intervalMinutes=30, timeZone='America/Los_Angeles', revision=0, timer, busy=false, invalid=false;
let paused=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function controls() {
  const enabled=!busy&&!invalid&&(mode==='demo'||!!adapter?.evaluateProfile);
  $('volatility').disabled=!enabled; $('nozzle').disabled=!enabled;
  $('profile-hint').textContent=busy ? 'Updating the evaluation…' : mode==='demo' ? 'Demo rules only. Try “Marginal” with low volatility + coarse droplets.' : adapter?.evaluateProfile ? 'Profile changes are evaluated by the connected risk engine.' : 'Profile controls require the team’s risk evaluator. This snapshot is read-only.';
  document.querySelectorAll('[data-scenario]').forEach(b=>b.setAttribute('aria-pressed',String(mode==='demo'&&b.dataset.scenario===activeScenario)));
}
function source() {
  $('source-badge').textContent=mode==='demo'?'◉ DEMO · SIMULATED DATA':mode==='live'?'◉ CONNECTED SENSOR DATA':'◉ IMPORTED SNAPSHOT · NOT LIVE';
  $('footer-demo').textContent=mode==='demo'?'Hackathon demonstration · Not validated for application decisions':mode==='imported'?'Imported snapshot · Not a live sensor connection':'Connected data · Verify on-site conditions and product label';
}
function readings(r) {
  return `<div><div class="reading-value">${r.temp_f.toFixed(1)}<span class="reading-unit">°F</span></div><div class="reading-label">Air temperature</div></div><div><div class="reading-value">${r.wind_speed_mph.toFixed(1)}<span class="reading-unit">mph</span></div><div class="reading-label">Wind from <span class="direction-pill">${esc(r.wind_dir_cardinal)}</span></div></div><div><div class="reading-value">${r.humidity_pct.toFixed(0)}<span class="reading-unit">%</span></div><div class="reading-label">Humidity</div></div>`;
}
function renderSensor() {
  const r=snapshot.readings[selectedHeight], upper=selectedHeight==='canopy_30ft';
  $('orchard-svg').innerHTML=orchardSVG(snapshot,selectedHeight);
  $('sensor-title').textContent=upper?'Above canopy':'Inside the orchard';
  $('sensor-details').innerHTML=[['Temperature',`${r.temp_f.toFixed(1)}°F`],['Wind speed',`${r.wind_speed_mph.toFixed(1)} mph`],['Wind from',`${r.wind_dir_cardinal} · ${Math.round(r.wind_dir_deg)}°`],['Humidity',`${r.humidity_pct.toFixed(0)}%`]].map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
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
  $('observation-time').textContent=`${mode==='demo'?'Demo observation':'Observed'} · ${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone,timeZoneName:'short'}).format(new Date(snapshot.timestamp))}`;
  $('decision').className=`decision ${s}`;
  $('decision-icon').textContent=icons[s];
  $('decision-label').textContent=`CANOPYGUARD RECOMMENDATION · ${s}`;
  $('decision-title').textContent=titles[s];
  $('headline').textContent=e.headline_reason;
  $('decision-note').textContent=`Based on both sensor heights · ${mode==='demo'?'Demonstration only':mode==='imported'?'Imported snapshot only':'Check on-site conditions before application'}`;
  $('rules').innerHTML=e.triggered_rules.length?e.triggered_rules.map(r=>`<li class="rule-card ${r.severity}"><div class="rule-head"><h3>• ${esc(ruleNames[r.code]||r.code.replaceAll('_',' '))}</h3><span class="mini-status">${r.severity}</span></div><p class="rule-metric">${esc(r.metric)}</p><p>${esc(r.explanation)}</p></li>`).join(''):`<li class="rule-empty">${s==='GO'?'✓ No risk rules triggered in this evaluation.':'Review the headline recommendation; no individual rules were supplied.'}</li>`;
  $('ground-readings').innerHTML=readings(snapshot.readings.ground_5ft);
  $('canopy-readings').innerHTML=readings(snapshot.readings.canopy_30ft);
  $('ground-status').className=`result-badge ${e.single_station_5ft_status}`;
  $('ground-status').textContent=`${icons[e.single_station_5ft_status]} Ground Station Says: ${e.single_station_5ft_status}${e.single_station_5ft_status==='GO'?' (Looks Safe)':''}`;
  $('ground-reason').textContent=e.single_station_5ft_reason;
  const caught=e.single_station_5ft_status==='GO'&&s==='STOP';
  $('canopy-status').className=`result-badge ${s}`;
  $('canopy-status').textContent=`${icons[s]} CanopyGuard Says: ${s}${caught?' (Hidden Drift Risk Caught!)':''}`;
  $('delta-chips').innerHTML=`<span class="${d.temperature>0?'hot':''}">${signed(d.temperature)}°F ${d.temperature>0?'Inversion':'temperature difference'}</span><span>${signed(d.speed)} mph / ${Math.round(d.direction)}° Wind Shear</span>`;
  $('volatility').value=snapshot.pesticide_profile.volatility_class;
  $('nozzle').value=snapshot.pesticide_profile.nozzle_droplet_size;
  $('profile-name').textContent=mode==='demo'?'Illustrative pesticide profile · Not a verified product label':snapshot.pesticide_profile.name;
  $('monitor-title').textContent=`After the spray, keep watch for ${snapshot.pesticide_profile.post_spray_monitor_hours} hours.`;
  $('monitor-risk').textContent=e.post_spray_volatility_risk;
  renderSensor(); controls();
}
function clearForecast(message='No forecast connected. Awaiting the team’s forecast module.') {
  forecast=[]; $('timeline').replaceChildren(); $('timeline-labels').replaceChildren();
  $('next-window').textContent='Next safe spray window: unavailable';
  $('forecast-detail').textContent=message;
  $('forecast-source').textContent='FORECAST UNAVAILABLE';
}
function renderForecast() {
  validateForecast(forecast,intervalMinutes);
  const now=mode==='live'?Date.now():Date.parse(snapshot.timestamp);
  const upcoming=forecast.filter(s=>Date.parse(s.timestamp)+intervalMinutes*60000>now).slice(0,Math.ceil(1440/intervalMinutes));
  if (!upcoming.length) return clearForecast('All supplied forecast periods are in the past.');
  const window=nextWindow(upcoming,intervalMinutes,now);
  $('forecast-title').textContent=`Your next ${Math.min(24,upcoming.length*intervalMinutes/60)} hours.`;
  $('forecast-source').textContent=mode==='demo'?'SIMULATED FORECAST · NOT NWS':mode==='imported'?'IMPORTED FORECAST · NOT LIVE':'CONNECTED FORECAST';
  $('next-window').innerHTML=window?`<span class="window-icon" aria-hidden="true">◷</span><div>Next Safe Spray Window: ${formatTime(window.start,timeZone)} – ${formatTime(window.end,timeZone)} (${Number(window.hours.toFixed(1))} hrs)<small>${mode==='demo'?'Illustrative GO window · ': 'Forecast GO window; recheck on-site · '}${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone}).format(new Date(window.start))}</small></div>`:'No GO window in the supplied forecast. Check again before your next pass.';
  $('timeline').innerHTML=upcoming.map((s,i)=>{const label=`${formatTime(s.timestamp,timeZone)}: ${s.evaluation.multi_height_status}`;return `<button type="button" class="${s.evaluation.multi_height_status}" data-period="${i}" aria-label="${esc(label)}" title="${esc(label)}" aria-pressed="false"></button>`;}).join('');
  const start=Date.parse(upcoming[0].timestamp),end=Date.parse(upcoming.at(-1).timestamp)+intervalMinutes*60000;
  $('timeline-labels').innerHTML=Array.from({length:7},(_,i)=>`<span>${formatTime(start+(end-start)*i/6,timeZone)}</span>`).join('');
  $('forecast-zone').textContent=`${timeZone.replaceAll('_',' ')} · ${intervalMinutes}-minute periods`;
  const inversion=upcoming.find(s=>deltas(s).temperature>0 && Date.parse(s.timestamp)>=(window?.end||now));
  $('forecast-detail').textContent=inversion?`${mode==='demo'?'Demo warning':'Forecast warning'}: Thermal inversion at ${formatTime(inversion.timestamp,timeZone)}. Select a period to inspect its recommendation.`:'Select a period to inspect its recommendation.';
  $('timeline').querySelectorAll('button').forEach((button,i)=>button.addEventListener('click',()=>{
    $('timeline').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    const s=upcoming[i];
    $('forecast-detail').textContent=`${formatTime(s.timestamp,timeZone)} – ${formatTime(Date.parse(s.timestamp)+intervalMinutes*60000,timeZone)} · ${s.evaluation.multi_height_status} · ${s.evaluation.headline_reason}`;
  }));
}
function fail(error) {
  invalid=true;busy=false;
  $('decision').className='decision STOP'; $('decision-icon').textContent='!';
  $('decision-title').textContent='DATA UNAVAILABLE — DO NOT SPRAY';
  $('decision-label').textContent='CANOPYGUARD · CHECK DATA CONNECTION';
  $('headline').textContent='A current recommendation cannot be verified.';
  $('decision-note').textContent='No valid spray decision is available.';
  $('error-message').textContent=error.message||String(error); $('error-message').hidden=false;
  $('rules').replaceChildren();
  for(const id of ['ground-readings','canopy-readings','ground-reason','delta-chips','sensor-details','monitor-risk']) $(id).replaceChildren();
  for(const id of ['ground-status','canopy-status']) {$(id).className='result-badge STOP';$(id).textContent='Unavailable — check data';}
  $('orchard-svg').textContent='Visualization paused: valid readings are required.';
  $('layer-note').textContent='Check the data connection before proceeding.';
  clearForecast('Forecast hidden until valid observations are restored.');controls();
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
async function changeProfile() {
  if(invalid||busy)return;
  const profile={...snapshot.pesticide_profile,volatility_class:$('volatility').value,nozzle_droplet_size:$('nozzle').value};
  const ticket=++revision;
  if(mode==='demo') {snapshot=evaluateDemo(snapshot,profile);renderSnapshot();forecast=demoForecast(profile);renderForecast();return;}
  if(!adapter?.evaluateProfile)return;
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
function useDemo(name='trap') {
  if(!['trap','marginal','clear'].includes(name))throw new Error('Unknown demo scenario');
  ++revision;clearInterval(timer);adapter=null;mode='demo';activeScenario=name;busy=false;
  timeZone='America/Los_Angeles';intervalMinutes=30;
  snapshot=scenario(name);renderSnapshot();forecast=demoForecast(snapshot.pesticide_profile);renderForecast();
}
function setSnapshot(data) {
  ++revision;clearInterval(timer);adapter=null;mode='imported';busy=false;source();
  try {snapshot=structuredClone(assertSnapshot(data));renderSnapshot();clearForecast();}
  catch(error){fail(error);throw error;}
}
async function connect(config) {
  if(config?.mode!=='live'||typeof config.loadSnapshot!=='function')throw new Error('A live adapter with loadSnapshot is required.');
  const zone=config.timeZone||'America/Los_Angeles';new Intl.DateTimeFormat('en-US',{timeZone:zone});
  if(config.maxAgeMs!==undefined&&(!Number.isFinite(config.maxAgeMs)||config.maxAgeMs<=0))throw new Error('maxAgeMs must be positive.');
  if(config.pollMs!==undefined&&(!Number.isFinite(config.pollMs)||config.pollMs<1000))throw new Error('pollMs must be at least 1000.');
  ++revision;clearInterval(timer);adapter=config;mode='live';busy=false;timeZone=zone;intervalMinutes=config.forecastIntervalMinutes||30;source();
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
$('volatility').addEventListener('change',changeProfile);$('nozzle').addEventListener('change',changeProfile);
function motion(){document.body.classList.toggle('paused',paused);$('motion-toggle').setAttribute('aria-pressed',String(paused));$('motion-toggle').textContent=paused?'Resume animation ▷':'Pause animation Ⅱ';}
$('motion-toggle').addEventListener('click',()=>{paused=!paused;motion();});motion();
$('import-button').addEventListener('click',()=>$('json-file').click());
$('json-file').addEventListener('change',async(event)=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>1000000)throw new Error('JSON file is too large (1 MB maximum).');setSnapshot(JSON.parse(await file.text()));}
  catch(error){++revision;clearInterval(timer);adapter=null;mode='imported';source();fail(error);}
  finally{event.target.value='';}
});
window.CanopyGuard=Object.freeze({connect,refresh,setSnapshot,useDemo,setForecast(data,options={}){
  if(invalid)throw new Error('A valid snapshot is required before forecasts.');
  intervalMinutes=options.intervalMinutes||30;
  validateForecast(data,intervalMinutes);
  for(const s of data)for(const k of Object.keys(snapshot.pesticide_profile))if(s.pesticide_profile[k]!==snapshot.pesticide_profile[k])throw new Error('Forecast profile does not match current selection.');
  forecast=structuredClone(data);renderForecast();
}});
useDemo();
