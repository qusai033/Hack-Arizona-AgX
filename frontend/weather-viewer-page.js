import {SAMPLE_OBSERVATIONS,assessWeatherDataset,formatObservationAge} from './weather-viewer.js';

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

document.querySelectorAll('[data-place]').forEach(point=>{
  point.setAttribute('tabindex','0');point.setAttribute('role','button');
  point.addEventListener('click',()=>render(point.dataset.place));
  point.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();render(point.dataset.place);}});
});
renderQuality();render(activeId);
