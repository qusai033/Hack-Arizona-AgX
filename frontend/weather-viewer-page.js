import { locations } from './locations.js';
import { loadNwsHourly } from './nws.js';
import { loadAzmetObservation } from './azmet.js';
import { REGION_STATES } from './region-boundaries.js';
import { MAP_WIDTH, MAP_HEIGHT, createRegionProjection, statePath, spreadMarkers } from './region-map.js';
import { SAMPLE_OBSERVATIONS, DEMO_REFERENCE_TIME, assessWeatherDataset } from './weather-viewer.js';
import { SYNTHETIC_WEATHER_FRAMES, createWeatherPlayback } from './weather-playback.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const demo = params.get('mode') === 'demo';
const entries = Object.entries(locations);
const compass = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const stationMemo = new Map();
let activeId = Object.hasOwn(locations,params.get('location')) ? params.get('location') : 'fresno';
let region = 'all', project = createRegionProjection(), requestId = 0;
let controller, refreshTimer, playback;
let disposed = false;

function svgElement(tag,attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg',tag);
  for (const [key,value] of Object.entries(attributes)) element.setAttribute(key,String(value));
  return element;
}
const visibleLocations = () => entries.filter(([,place]) => region==='all' || place.state===region);
const numberOf = id => entries.findIndex(([key]) => key===id)+1;

function renderMap() {
  project = createRegionProjection(region);
  $('state-boundaries').replaceChildren();
  $('state-labels').replaceChildren();
  const labelCoordinates = {CA:[-121.6,36.7],AZ:[-111.8,34.8],NV:[-116.6,39],UT:[-111.8,39.5]};
  for (const state of REGION_STATES) {
    const supported = ['CA','AZ'].includes(state.id);
    const path = svgElement('path',{d:statePath(state,project),'data-state':state.id,
      class:`state-shape ${supported?'supported-state':'context-state'}`,'fill-rule':'evenodd'});
    $('state-boundaries').append(path);
    const [x,y] = project(...labelCoordinates[state.id]);
    const label = svgElement('text',{x,y,class:'state-label','text-anchor':'middle'});
    label.textContent=state.name;
    $('state-labels').append(label);
  }
  $('map-points').replaceChildren();
  $('location-list').replaceChildren();
  $('location-select').replaceChildren();
  for (const [id,place] of visibleLocations()) {
    const number = numberOf(id);
    const marker = document.createElement('button');
    marker.type='button'; marker.className='map-marker'; marker.dataset.location=id;
    marker.textContent=number; marker.title=place.label;
    marker.setAttribute('aria-label',`${number}. ${place.label}`);
    marker.addEventListener('click',()=>selectLocation(id));
    $('map-points').append(marker);
    const item=document.createElement('li'),button=document.createElement('button');
    const badge=document.createElement('span'),name=document.createElement('span');
    button.type='button'; button.dataset.location=id;
    badge.className='location-number'; badge.textContent=number; badge.setAttribute('aria-hidden','true');
    name.textContent=place.label;
    button.append(badge,name);button.addEventListener('click',()=>selectLocation(id));
    item.append(button);$('location-list').append(item);
    const option=document.createElement('option');option.value=id;option.textContent=`${number}. ${place.label}`;
    $('location-select').append(option);
  }
  $('location-count').textContent=`${visibleLocations().length} locations`;
  document.querySelectorAll('[data-region]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.region===region)));
  positionMarkers();
  highlightSelection();
}

function positionMarkers() {
  const {width,height}=$('region-map').getBoundingClientRect();
  if (!width || !height) return;
  const anchors=visibleLocations().map(([id,place])=>{
    const [x,y]=project(place.longitude,place.latitude);
    return {id,x:x/MAP_WIDTH*width,y:y/MAP_HEIGHT*height};
  });
  const markers=spreadMarkers(anchors,width,height);
  $('map-leaders').replaceChildren();
  markers.forEach((point,index)=>{
    const anchor=anchors[index],button=$('map-points').querySelector(`[data-location="${point.id}"]`);
    button.style.left=`${point.x}px`;button.style.top=`${point.y}px`;
    const x1=anchor.x/width*MAP_WIDTH,y1=anchor.y/height*MAP_HEIGHT;
    $('map-leaders').append(svgElement('line',{x1,y1,x2:point.x/width*MAP_WIDTH,y2:point.y/height*MAP_HEIGHT,class:'map-leader'}),
      svgElement('circle',{cx:x1,cy:y1,r:3,class:'coordinate-dot'}));
  });
}

function highlightSelection() {
  $('location-select').value=activeId;
  document.querySelectorAll('[data-location]').forEach(button => {
    button.setAttribute('aria-pressed',String(button.dataset.location===activeId));
  });
}

function selectLocation(id) {
  if (!Object.hasOwn(locations,id)) return;
  activeId=id;
  const place=locations[id];
  $('selected-name').textContent=place.label;
  $('selected-weather-link').textContent=`View weather for ${place.label} ↓`;
  $('selected-coordinates').textContent=`${place.latitude.toFixed(4)}° N, ${Math.abs(place.longitude).toFixed(4)}° W`;
  highlightSelection();
  const url=new URL(location.href);url.searchParams.set('location',id);history.replaceState(null,'',url);
  if (demo) playback.reset();
  else refreshWeather();
}

function definitionList(id,values) {
  $(id).replaceChildren();
  for (const [label,value] of values) {
    const wrapper=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');
    term.textContent=label;description.textContent=value;wrapper.append(term,description);$(id).append(wrapper);
  }
}
function weatherValues(id,temperature,humidity,wind,direction) {
  definitionList(id,[['Temperature',`${temperature.toFixed(1)} °F`],['Relative humidity',`${humidity.toFixed(0)}%`],
    ['Wind speed',`${wind.toFixed(1)} mph`],['Wind direction',wind===0?'Calm':direction]]);
}
function formatTime(timestamp) {
  return new Intl.DateTimeFormat('en-US',{timeZone:locations[activeId].zone,month:'short',day:'numeric',
    hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(timestamp));
}
function sourceStatus(id,message,warning=false) {
  $(id).textContent=message;$(id).classList.toggle('warn',warning);
}

async function refreshWeather() {
  if (demo || disposed) return;
  const generation=++requestId,id=activeId,place=locations[id],nowMs=Date.now();
  controller?.abort();controller=new AbortController();
  const signal=controller.signal;
  $('refresh-weather').disabled=true;
  $('load-status').textContent='Loading weather…';
  for (const key of ['weather-values','forecast-times','station-values','station-times']) $(key).replaceChildren();
  $('station-heights').hidden=true;
  sourceStatus('forecast-status','Loading forecast…');
  sourceStatus('station-status',place.azmet_station?'Loading station observation…':'No station observation is connected for this location.');
  const [forecast,station]=await Promise.allSettled([
    loadNwsHourly(id,{nowMs,signal}),
    place.azmet_station?loadAzmetObservation(place.azmet_station,{nowMs,signal,memo:stationMemo}):Promise.resolve(null)
  ]);
  if (disposed || signal.aborted || generation!==requestId) return;
  if (forecast.status==='fulfilled') {
    const data=forecast.value,row=data.rows[0];
    weatherValues('weather-values',row.temperature,row.humidity,row.wind,compass[Math.round(row.direction/22.5)%16]);
    sourceStatus('forecast-status',Date.parse(row.timestamp)>nowMs?'Next forecast hour · current hour unavailable':'Current forecast hour · modeled regional weather');
    definitionList('forecast-times',[
      ['Source','National Weather Service'],
      ['Valid period',`${formatTime(row.timestamp)} – ${formatTime(Date.parse(row.timestamp)+3600000)}`],
      ['Issued / updated',formatTime(data.issued_at)],['Retrieved',formatTime(data.fetched_at)]
    ]);
  } else sourceStatus('forecast-status',`Forecast unavailable. ${forecast.reason?.message??'Request failed'}.`,true);
  if (station.status==='fulfilled' && station.value) {
    const data=station.value;
    weatherValues('station-values',data.temp_f,data.humidity_pct,data.wind_speed_mph,compass[Math.round(data.wind_dir_deg/22.5)%16]);
    sourceStatus('station-status',`Measured at ${data.station_name} · ${Math.round(data.age_minutes)} min old`);
    definitionList('station-times',[['Source',`AZMET · ${data.station_id}`],['Observed',formatTime(data.observed_at)]]);
    $('station-heights').hidden=false;
  } else if (station.status==='rejected') {
    sourceStatus('station-status',`Station observation unavailable. ${station.reason?.message??'Request failed'}.`,true);
  }
  const failed=forecast.status==='rejected'||station.status==='rejected';
  $('load-status').textContent=`${failed?'Some data unavailable':'Updated'} · ${formatTime(nowMs)} · refreshes every 30 seconds`;
  $('refresh-weather').disabled=false;
}

function renderDemo(state) {
  const sample=SAMPLE_OBSERVATIONS.find(record=>record.id===activeId);
  const frame=SYNTHETIC_WEATHER_FRAMES[state.frameIndex],first=SYNTHETIC_WEATHER_FRAMES[0];
  const temperature=sample.temperatureF+frame.temperatureF-first.temperatureF;
  const humidity=sample.humidityPct+frame.humidityPct-first.humidityPct;
  const wind=sample.windMph+frame.windMph-first.windMph;
  weatherValues('weather-values',temperature,humidity,wind,sample.windDirection);
  sourceStatus('forecast-status','Synthetic sample · no live weather requests');
  definitionList('forecast-times',[
    ['Source',sample.source],['Sample time',formatTime(Date.parse(sample.observedAt)+state.elapsedMinutes*60000)],
    ['Demo reference clock',formatTime(DEMO_REFERENCE_TIME+state.elapsedMinutes*60000)]
  ]);
  $('playback-title').textContent=`${sample.name} sample timeline`;
  $('playback-status').textContent=state.playing?'Playing':state.completed?'Complete':'Paused';
  $('playback-clock').textContent=`00:${String(state.elapsedMinutes).padStart(2,'0')}`;
  $('playback-frame').textContent=`${state.frameIndex+1} of ${state.frameCount}`;
  $('playback-temperature').textContent=`${temperature} °F`;
  $('playback-humidity').textContent=`${humidity}%`;
  $('playback-wind').textContent=`${wind} mph`;
  $('playback-speed-label').textContent=`${state.speed}× · ${state.speed} simulated minute${state.speed===1?'':'s'} per real second`;
  $('playback-event').textContent=state.lastEventId??'No event recorded';
  $('playback-play').disabled=state.playing||state.completed;
  $('playback-pause').disabled=!state.playing;
  $('playback-step').disabled=state.playing||state.completed;
  document.querySelectorAll('#playback-track li').forEach((item,index)=>{
    item.classList.toggle('current',index===state.frameIndex);
    if(index===state.frameIndex)item.setAttribute('aria-current','step');
    else item.removeAttribute('aria-current');
  });
}

if (demo) {
  $('mode-notice').textContent='Demo mode · synthetic samples only. Playback and data checks use a fixed demo clock, not current weather.';
  $('dashboard-link').href='./index.html?mode=demo';
  $('forecast-kind').textContent='DEMO RECORD';$('forecast-title').textContent='Synthetic weather sample';
  $('load-status').textContent='Demo clock · November 15, 2026';$('refresh-weather').hidden=true;
  $('station-section').hidden=true;$('weather-scope').textContent='These samples are illustrative. Selecting a location resets its eight-frame playback.';
  $('playback-panel').hidden=false;$('quality-panel').hidden=false;
  $('mode-link').href='./weather-viewer.html';$('mode-link').textContent='Return to live weather';
  const assessment=assessWeatherDataset(SAMPLE_OBSERVATIONS,DEMO_REFERENCE_TIME);
  $('quality-count').textContent=`${assessment.validCount}/${assessment.total} valid`;
  for (const entry of assessment.entries) {
    const item=document.createElement('li'),name=document.createElement('strong'),status=document.createElement('span');
    name.textContent=locations[entry.id].label;status.textContent=entry.valid?'Pass':entry.errors.join(' · ');
    status.className=entry.valid?'ok':'bad';item.append(name,status);$('quality-list').append(item);
  }
  playback=createWeatherPlayback({onChange:renderDemo});
  $('playback-play').addEventListener('click',()=>playback.start());
  $('playback-pause').addEventListener('click',()=>playback.pause());
  $('playback-step').addEventListener('click',()=>playback.step());
  $('playback-reset').addEventListener('click',()=>playback.reset());
  $('playback-speed').addEventListener('change',event=>playback.setSpeed(Number(event.target.value)));
}

document.querySelectorAll('[data-region]').forEach(button=>button.addEventListener('click',()=>{
  region=button.dataset.region;
  renderMap();
  if (!visibleLocations().some(([id])=>id===activeId)) selectLocation(visibleLocations()[0][0]);
}));
$('refresh-weather').addEventListener('click',refreshWeather);
$('location-select').addEventListener('change',event=>selectLocation(event.target.value));
const resize=new ResizeObserver(positionMarkers);
resize.observe($('region-map'));
function startRefresh() {
  clearInterval(refreshTimer);
  if (!demo) refreshTimer=setInterval(()=>{if (!document.hidden) refreshWeather();},30000);
}
window.addEventListener('pagehide',()=>{
  disposed=true;controller?.abort();clearInterval(refreshTimer);playback?.dispose();resize.disconnect();
});
window.addEventListener('pageshow',event=>{
  if (!event.persisted) return;
  disposed=false;resize.observe($('region-map'));startRefresh();
  if (demo) renderDemo(playback.getState());else refreshWeather();
});
document.addEventListener('visibilitychange',()=>{if (!document.hidden) refreshWeather();});
renderMap();selectLocation(activeId);startRefresh();
