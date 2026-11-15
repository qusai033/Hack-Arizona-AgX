import {SAMPLE_OBSERVATIONS,assessWeatherDataset,formatObservationAge} from './weather-viewer.js';
import {SYNTHETIC_WEATHER_FRAMES,createWeatherPlayback} from './weather-playback.js';

const $ = id => document.getElementById(id);
const now = Date.now();
const assessment = assessWeatherDataset(SAMPLE_OBSERVATIONS,now);
const selected = new Map(SAMPLE_OBSERVATIONS.map(record=>[record.id,record]));
let activeId = 'tucson';

function render(id) {
  const record = selected.get(id);
  if (!record) return;
  activeId=id;
  $('selected-name').textContent=record.name;
  $('selected-coordinates').textContent=`${record.latitude.toFixed(4)}°, ${record.longitude.toFixed(4)}°`;
  $('weather-values').innerHTML='';
  for (const [label,value] of [['Temperature',`${record.temperatureF} °F`],['Relative humidity',`${record.humidityPct}%`],['Wind speed',`${record.windMph} mph`],['Wind direction',record.windDirection]]) {
    const wrapper=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');
    term.textContent=label;description.textContent=value;wrapper.append(term,description);$('weather-values').append(wrapper);
  }
  $('selected-source').textContent=record.source;
  $('selected-time').textContent=`${new Date(record.observedAt).toLocaleString()} · ${formatObservationAge(record.observedAt,now)}`;
  const check=assessment.entries.find(item=>item.id===id);
  $('record-quality').textContent=check?.valid?'Record passes the basic data-quality checks.':(check?.errors.join('; ')??'Record not assessed');
  $('record-quality').classList.toggle('warn',!check?.valid);
  document.querySelectorAll('[data-place]').forEach(point=>point.setAttribute('aria-label',`${selected.get(point.dataset.place)?.name??point.dataset.place}${point.dataset.place===activeId?', selected':''}`));
}

function renderQuality() {
  $('quality-count').textContent=`${assessment.validCount}/${assessment.total} valid`;
  $('quality-list').replaceChildren();
  for (const entry of assessment.entries) {
    const record=selected.get(entry.id),item=document.createElement('li'),name=document.createElement('strong'),status=document.createElement('span');
    name.textContent=record?.name??entry.id??'Unknown record';
    status.textContent=entry.valid?'Pass':entry.errors.join(' · ');
    status.className=entry.valid?'ok':'bad';item.append(name,status);$('quality-list').append(item);
  }
}

function renderPlayback(state) {
  const frame=SYNTHETIC_WEATHER_FRAMES[state.frameIndex];
  $('playback-status').textContent=state.playing?'Playing':state.completed?'Complete':'Paused';
  $('playback-clock').textContent=`00:${String(state.elapsedMinutes).padStart(2,'0')}`;
  $('playback-frame').textContent=`${state.frameIndex+1} of ${state.frameCount}`;
  $('playback-temperature').textContent=`${frame.temperatureF} °F`;
  $('playback-humidity').textContent=`${frame.humidityPct}%`;
  $('playback-wind').textContent=`${frame.windMph} mph`;
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

const playback=createWeatherPlayback({onChange:renderPlayback});
$('playback-play').addEventListener('click',()=>playback.start());
$('playback-pause').addEventListener('click',()=>playback.pause());
$('playback-step').addEventListener('click',()=>playback.step());
$('playback-reset').addEventListener('click',()=>playback.reset());
$('playback-speed').addEventListener('change',event=>playback.setSpeed(Number(event.target.value)));
window.addEventListener('pagehide',()=>playback.dispose(),{once:true});

document.querySelectorAll('[data-place]').forEach(point=>{
  point.setAttribute('tabindex','0');point.setAttribute('role','button');
  point.addEventListener('click',()=>render(point.dataset.place));
  point.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();render(point.dataset.place);}});
});
renderQuality();render(activeId);renderPlayback(playback.getState());
