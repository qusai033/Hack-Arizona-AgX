import { deltas, escapeHTML as esc, signed } from './contract.js';
import { auditCSV, createAuditLog, filterRecords, hiddenRisk, localDate, reasons, alertText } from './audit.js';
import { assertEvent, createEvent } from './events.js';
import {createAlertLifecycle} from './alert-state.js';
import {AUDIT_PREFIX, persistenceWarning} from './audit-storage.js';
import {dayKey, groupByDay, monthGrid, recordDay, shiftDay, shiftMonth, summarizeDay} from './audit-calendar.js';

const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const longDate = key => new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(key+'T12:00:00Z'));
const monthTitle = month => new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-15T12:00:00Z'));
const timeOnly = (iso, zone) => new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(iso));
const f1 = x => x.toFixed(1);

export function mountAudit({zone=()=> 'America/Los_Angeles', onRecordSnapshot, logOptions={}}={}) {
  let storage;
  try {storage=window.localStorage;} catch {}
  const log=createAuditLog(storage,logOptions);
  const alerts=createAlertLifecycle();
  const $=id=>document.getElementById(id);
  let current, filter='all', queued, toastTimer, externalDispatch;
  const table=$('audit-rows'), dialog=$('alert-dialog'), drawer=$('alert-drawer');
  // Calendar state. Until the user picks a day or month, the view follows the most recently recorded
  // record, so demo runs on a simulated clock and forecast-valid times open on the day they belong to.
  const today=()=>dayKey(new Date(),zone());
  let selectedDay=null, viewMonth=null, shownDay=today(), shownMonth=shownDay.slice(0,7);
  const checkedDays=new Set();
  function setFilter(value) {
    filter=value;
    document.querySelectorAll('[data-audit-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.auditFilter===filter)));
    render();
  }
  function showPersistence(result) {
    $('audit-persistence').textContent=persistenceWarning(result);
    $('audit-persistence').hidden=!result.issues.length;
  }
  function render() {
    const restored=log.read(), records=filterRecords(restored.records,filter), z=zone();
    const days=groupByDay(records,z);
    shownDay=selectedDay??(records.length?recordDay(records.at(-1),z):today());
    shownMonth=viewMonth??shownDay.slice(0,7);
    $('audit-count').textContent=`${records.length} ${records.length===1?'record':'records'} · ${days.size} ${days.size===1?'day':'days'} with data · ${restored.persistent?'Saved in this browser':'Storage needs attention'} · ${z}`;
    showPersistence(restored);
    renderCalendar(days);
    renderDay(shownDay,days.get(shownDay),days);
  }
  function renderCalendar(days) {
    const todayKey=today();
    $('cal-title').textContent=monthTitle(shownMonth);
    $('cal-jump').value=shownMonth;
    const grid=$('cal-grid');
    grid.replaceChildren();
    const head=document.createElement('div');head.className='cal-row cal-head';head.setAttribute('role','row');
    head.innerHTML='<span class="cal-week-label" aria-hidden="true"></span>'+WEEKDAYS.map(d=>`<span role="columnheader">${d}</span>`).join('');
    grid.append(head);
    for(const week of monthGrid(shownMonth)){
      const row=document.createElement('div');row.className='cal-row';row.setAttribute('role','row');
      const withData=week.filter(cell=>days.has(cell.key));
      const weekButton=document.createElement('button');
      weekButton.className='cal-week-label';weekButton.type='button';
      weekButton.textContent='Week';
      weekButton.title=withData.length?'Tick every day with data in this week':'No data this week';
      weekButton.setAttribute('aria-label',`${weekButton.title} (week of ${longDate(week[0].key)})`);
      weekButton.disabled=!withData.length;
      weekButton.addEventListener('click',()=>{
        const all=withData.every(cell=>checkedDays.has(cell.key));
        for(const cell of withData) all?checkedDays.delete(cell.key):checkedDays.add(cell.key);
        render();
      });
      row.append(weekButton);
      for(const cell of week){
        const summary=summarizeDay(days.get(cell.key));
        const box=document.createElement('div');
        box.setAttribute('role','gridcell');
        box.dataset.day=cell.key;
        box.className=['cal-day',cell.inMonth?'':'other-month',cell.key===todayKey?'today':'',cell.key===shownDay?'selected':'',summary?'has-data':'',cell.key>todayKey?'future':''].filter(Boolean).join(' ');
        const open=document.createElement('button');
        open.type='button';open.className='cal-open';
        open.setAttribute('aria-label',`${longDate(cell.key)}${cell.key===todayKey?' (today)':''}: ${summary?`${summary.count} ${summary.count===1?'record':'records'}, worst ${summary.worst}`:'no data'}`);
        open.setAttribute('aria-pressed',String(cell.key===shownDay));
        open.innerHTML=`<span class="cal-num">${cell.day}</span>${summary?`<span class="cal-mark"><i class="dot ${summary.worst}"></i>${summary.count}</span>`:''}`;
        open.addEventListener('click',()=>openDay(cell.key));
        box.append(open);
        if(summary){
          const tick=document.createElement('input');
          tick.type='checkbox';tick.className='cal-check';tick.checked=checkedDays.has(cell.key);
          tick.setAttribute('aria-label',`Tick ${longDate(cell.key)} for export`);
          tick.addEventListener('change',()=>{tick.checked?checkedDays.add(cell.key):checkedDays.delete(cell.key);updateChecked();});
          box.append(tick);
        }
        row.append(box);
      }
      grid.append(row);
    }
    updateChecked();
  }
  function updateChecked() {
    const scope=$('audit-export-scope');
    $('cal-selected-count').textContent=checkedDays.size?`${checkedDays.size} ${checkedDays.size===1?'day':'days'} ticked`:'No days ticked';
    $('cal-clear').hidden=!checkedDays.size;
    const option=scope.querySelector('option[value="selected"]');
    option.textContent=`Checked days (${checkedDays.size})`;
    option.disabled=!checkedDays.size;
    if(!checkedDays.size&&scope.value==='selected')scope.value='day';
  }
  function openDay(key) {
    selectedDay=key;
    viewMonth=key.slice(0,7);
    render();
  }
  function stat(label,value,note='') {
    return `<div class="day-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note?`<small>${esc(note)}</small>`:''}</div>`;
  }
  function renderDay(key,rows,days) {
    const box=$('audit-day'), summary=summarizeDay(rows), todayKey=today(), z=zone();
    const nav=`<div class="day-head"><div><p class="eyebrow">${key===todayKey?'TODAY':key>todayKey?'UPCOMING DATE':'DAILY RECORD'}</p><h3>${esc(longDate(key))}</h3></div>
      <div class="day-nav"><button type="button" class="outline-button" data-day-step="-1" aria-label="Previous day">‹ Prev day</button><button type="button" class="outline-button" data-day-step="1" aria-label="Next day">Next day ›</button></div></div>`;
    if(!summary){
      const recorded=[...days.keys()].sort(), latest=recorded.filter(k=>k<=todayKey).pop()??recorded.pop();
      const filtered=filter!=='all'?' matching this filter':'';
      box.innerHTML=`${nav}<div class="day-empty"><strong>No records for this date${filtered}.</strong><p>Nothing was recorded for this day, so no conditions are shown. CanopyGuard never fills a day with estimated values.</p>${latest?`<button type="button" class="outline-button" data-open-day="${esc(latest)}">Go to latest recorded day · ${esc(longDate(latest))}</button>`:''}</div>`;
    }else{
      const g=summary.ground,c=summary.canopy;
      const span=(r,fmt,unit)=>r?(fmt(r.low)===fmt(r.high)?fmt(r.low):`${fmt(r.low)}–${fmt(r.high)}`)+unit:'Not recorded';
      const temp=h=>h.temp?`${f1(h.temp.high)}° / ${f1(h.temp.low)}°F`:'Not recorded';
      const whole=x=>String(Math.round(x));
      const inversion=summary.maxInversion>0?`${signed(summary.maxInversion)}°F`:'None';
      const inversionNote=summary.maxInversion>0?`30 ft warmer than 5 ft · ${summary.inversions} inversion ${summary.inversions===1?'record':'records'}`:`30 ft was never warmer than 5 ft (closest ${signed(summary.maxInversion)}°F)`;
      const sources=summary.sources.join(' · ');
      box.innerHTML=`${nav}
        <div class="day-decision"><span class="result-badge ${summary.worst}">Worst decision: ${summary.worst}</span><span>STOP ${summary.status.STOP} · CAUTION ${summary.status.CAUTION} · GO ${summary.status.GO}</span></div>
        <div class="day-stats">
          ${stat('High / low · 5 ft',temp(g),'Near the ground')}
          ${stat('High / low · 30 ft',temp(c),'Above canopy')}
          ${stat('Wind · 5 ft',span(g.wind,f1,' mph'),`Mostly from ${g.prevailing}`)}
          ${stat('Wind · 30 ft',span(c.wind,f1,' mph'),`Mostly from ${c.prevailing}`)}
          ${stat('Humidity · 5 ft',span(g.humidity,whole,'%'))}
          ${stat('Humidity · 30 ft',span(c.humidity,whole,'%'))}
          ${stat('Precipitation','Not recorded','Audit records carry no rainfall value')}
          ${stat('Largest inversion',inversion,inversionNote)}
          ${stat('Wind shear',`${f1(summary.maxSpeedShear)} mph · ${summary.maxDirectionShift.toFixed(0)}°`,'Largest speed / direction difference')}
          ${stat('Hidden risks caught',String(summary.hiddenRisks),'5 ft alone said GO, both heights said STOP')}
        </div>
        <dl class="day-meta">
          <dt>Records</dt><dd>${summary.count} ${summary.count===1?'record':'records'} · ${esc(timeOnly(summary.first,z))} – ${esc(timeOnly(summary.last,z))}</dd>
          <dt>Conditions</dt><dd>${esc(summary.conditions.join(' · '))}</dd>
          <dt>Orchard</dt><dd>${esc(summary.blocks.join(' · '))}</dd>
          <dt>Pesticide</dt><dd>${esc(summary.profiles.join(' · '))}${summary.sessions.length?` · Treatment: ${esc(summary.sessions.join(', ').replaceAll('_',' ').toLowerCase())}`:''}</dd>
          <dt>Source</dt><dd>${esc(sources)} · Events: ${esc(summary.events.join(', '))}</dd>
        </dl>
        <p class="profile-hint">Summarized only from the records filed under this date (source: ${esc(sources)}). Simulated and forecast-modeled values are not on-site measurements.</p>`;
    }
    box.querySelectorAll('[data-day-step]').forEach(button=>button.addEventListener('click',()=>openDay(shiftDay(shownDay,Number(button.dataset.dayStep)))));
    box.querySelector('[data-open-day]')?.addEventListener('click',event=>openDay(event.currentTarget.dataset.openDay));
    $('audit-records-title').textContent=summary?`Records for ${longDate(key)} (${summary.count})`:`Records for ${longDate(key)}`;
    renderRows([...(rows??[])].reverse());
  }
  function renderRows(rows) {
    table.replaceChildren();
    if(!rows.length){
      const tr=document.createElement('tr');
      tr.innerHTML='<td colspan="8" class="audit-empty">No records for this date.</td>';
      table.append(tr);
    }
    for(const row of rows.slice(0,250)){
      const s=row.snapshot,e=s.evaluation,d=deltas(s);
      const telemetry=r=>`${r.temp_f.toFixed(1)}°F · ${r.wind_speed_mph.toFixed(1)} mph ${r.wind_speed_mph===0?'calm':r.wind_dir_cardinal}`;
      const pesticide=row.session?.state==='SPRAYING_IN_PROGRESS'?row.session.pesticide_profile.name:s.pesticide_profile.name;
      const treatment=row.session?.state==='POST_SPRAY_CURING'?` · Prior treatment: ${row.session.pesticide_profile.name}`:'';
      const tr=document.createElement('tr');
      const evaluationTime=row.evidence?.times?.evaluated_at;
      const timeLabel=row.source==='forecast'?'Forecast valid':row.source==='demo'?'Simulation time':
        row.source==='live'?'Connected observation':row.source==='imported'?'Imported timestamp':'Snapshot timestamp';
      tr.innerHTML=`<td>${esc(localDate(row.recorded_at,zone()))}<small>${esc(timeLabel)} ${esc(localDate(s.timestamp,zone()))} · ${esc(row.source)}<br>${evaluationTime?`Evaluated ${esc(localDate(evaluationTime,zone()))}<br>`:''}ID ${esc(row.id)}</small></td>
      <td>${esc(s.orchard_block)}<small>${esc(pesticide+treatment)}</small></td>
      <td>${esc(telemetry(s.readings.ground_5ft))}</td><td>${esc(telemetry(s.readings.canopy_30ft))}</td>
      <td>${signed(d.temperature)}°F · ${Math.abs(d.speed).toFixed(1)} mph · ${d.direction.toFixed(0)}°</td>
      <td><span class="result-badge ${e.multi_height_status}">${e.multi_height_status}</span></td><td>${esc(reasons(s))}</td>
      <td><span class="result-badge ${hiddenRisk(s)?'STOP':e.single_station_5ft_status}">${hiddenRisk(s)?'HIDDEN RISK CAUGHT':e.single_station_5ft_status}</span></td>`;
      table.append(tr);
    }
    $('audit-limit').textContent=rows.length>250?'Showing the latest 250 records of this day. Exports include every record in the chosen scope.':'';
  }
  function notify(record,{test=false,modal=false}={}) {
    const alert=test?{title:'TEST DRIFT ALERT · '+record.snapshot.orchard_block,body:'Test message for the Applicator and PCA. Current evaluation: '+record.snapshot.evaluation.multi_height_status+'.'}:alertText(record),time=localDate(record.snapshot.timestamp,zone());
    const message=`${alert.body} Log ID ${record.id}.`;
    const card=document.createElement('article');
    card.className='alert-card';
    card.dataset.eventId=record.id;card.dataset.source=record.source;
    if(record.demo_run_id)card.dataset.demoRunId=record.demo_run_id;
    card.innerHTML=`<small>CANOPYGUARD · SIMULATED SMS / PUSH · ${esc(time)}</small><strong>${esc(alert.title)}</strong><p>${esc(message)}</p><small>Applicator and PCA · ${test?'Test':'Preview'}</small>`;
    drawer.prepend(card);
    while(drawer.children.length>4)drawer.lastElementChild.remove();
    drawer.hidden=false;
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{drawer.hidden=true;},12500);
    $('alert-preview').replaceChildren(card.cloneNode(true));
    if(modal&&!dialog.open)dialog.showModal();
    if(externalDispatch && !test && record.source==='live'){
      Promise.resolve().then(()=>externalDispatch({ ...alert, message, event_id:record.id, log_id:record.id, recipients:['Applicator','PCA'] })).catch(()=>$('audit-delivery').textContent='External alert delivery failed. The audit record remains in this tab.');
    }
  }
  function accept(snapshot, {source, session=null, action, forceAlert=false, silentAlert=false, demo_run_id, evaluationContext={}, provenance=null}={}) {
    assertEvent(action);
    const existing = log.get(action.event_id);
    if (existing) return existing;
    const row=log.append(snapshot,{source,session,action,demo_run_id,evaluationContext,provenance});
    showPersistence(log.status());
    current={snapshot:structuredClone(snapshot),source,session:structuredClone(session),demo_run_id,evaluationContext:structuredClone(evaluationContext),provenance:structuredClone(provenance)};
    $('audit-record').disabled=false;
    $('alert-test').disabled=false;
    if(alerts.accept(row,{force:forceAlert,silent:silentAlert}).notify)notify(row);
    clearTimeout(queued);
    queued=setTimeout(render,100);
    return row;
  }
  const heartbeat=setInterval(()=>{
    if(current?.source==='live')accept(current.snapshot,{...current,action:createEvent('PERIODIC_RECORD')});
  },15000);
  // Which records an export or report covers: the opened day, the ticked days, the month on screen, or everything.
  // The selected filter always applies first. Scoped records come back oldest first, grouped by day.
  function scoped(scope) {
    const records=filterRecords(log.list(),filter), days=groupByDay(records,zone());
    const pick=keys=>[...keys].sort().flatMap(key=>days.get(key)??[]);
    if(scope==='day') return {records:pick([shownDay]),label:shownDay,title:longDate(shownDay)};
    if(scope==='selected'){const keys=[...checkedDays].sort();return {records:pick(keys),label:`${keys.length}-days-${keys[0]??'none'}-to-${keys.at(-1)??'none'}`,title:keys.map(longDate).join('; ')||'No days ticked'};}
    if(scope==='month') return {records:pick([...days.keys()].filter(key=>key.startsWith(shownMonth))),label:shownMonth,title:monthTitle(shownMonth)};
    return {records,label:'',title:'All recorded history'};
  }
  function download(scope='all') {
    const {records,label,title}=scoped(scope);
    const data=auditCSV(records,zone());
    const url=URL.createObjectURL(new Blob(['\uFEFF',data],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download=`canopyguard-pca-audit${label?'-'+label:''}.csv`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('audit-delivery').textContent=`Exported ${records.length} ${records.length===1?'record':'records'} · ${title}.`;
  }
  function printReport() {
    // The report is always laid out day by day, oldest first, including the all-history scope.
    const {records:found,title}=scoped($('audit-export-scope').value);
    const records=[...groupByDay(found,zone()).entries()].sort(([a],[b])=>a.localeCompare(b)).flatMap(([,rows])=>rows);
    const report=$('audit-print');
    report.innerHTML=`<h1>CanopyGuard Spray Compliance Report</h1><p>${esc(title)}</p><p>Generated ${esc(localDate(new Date().toISOString(),zone()))} · ${esc(zone())} · Filter: ${esc(filter)} · ${records.length} records</p><p>Decision-support record. Source labels distinguish simulation from connected observations. Verify pesticide labels and on-site conditions.</p>`;
    let day;
    for(const row of records){
      const key=recordDay(row,zone());
      if(key!==day){day=key;const h=document.createElement('h2');h.className='report-day';h.textContent=longDate(key);report.append(h);}
      const s=row.snapshot, e=s.evaluation,d=deltas(s),g=s.readings.ground_5ft,c=s.readings.canopy_30ft;
      const section=document.createElement('section');
      const evaluatedAt=row.evidence?.times?.evaluated_at;
      const timeLabel=row.source==='forecast'?'Forecast valid':row.source==='demo'?'Simulation time':
        row.source==='live'?'Connected observation':row.source==='imported'?'Imported timestamp':'Snapshot timestamp';
      section.innerHTML=`<h2>${esc(s.orchard_block)} · ${e.multi_height_status}</h2><p>${esc(localDate(row.recorded_at,zone()))} · ${esc(row.source)} · ${esc(row.id)}</p><p>${esc(timeLabel)} ${esc(s.timestamp)} · Evaluation ${evaluatedAt?esc(evaluatedAt):'unavailable'} · ${esc(s.pesticide_profile.name)}${row.session?' · '+esc(row.session.state+' · '+row.session.pesticide_profile.name):''}</p><p>5 ft: ${g.temp_f.toFixed(1)}°F, ${g.wind_speed_mph.toFixed(1)} mph ${esc(g.wind_dir_cardinal)} · 30 ft: ${c.temp_f.toFixed(1)}°F, ${c.wind_speed_mph.toFixed(1)} mph ${esc(c.wind_dir_cardinal)}</p><p>Temperature difference ${signed(d.temperature)}°F · Speed shear ${Math.abs(d.speed).toFixed(1)} mph · Direction shift ${d.direction.toFixed(0)}° · Ground-only ${e.single_station_5ft_status}${hiddenRisk(s)?' · HIDDEN RISK CAUGHT':''}</p><p>${esc(reasons(s))}</p>`;
      report.append(section);
    }
    window.print();
  }
  document.querySelectorAll('[data-audit-filter]').forEach(button=>button.addEventListener('click',()=>setFilter(button.dataset.auditFilter)));
  $('audit-download').addEventListener('click',()=>download($('audit-export-scope').value));
  $('cal-prev').addEventListener('click',()=>{viewMonth=shiftMonth(shownMonth,-1);render();});
  $('cal-next').addEventListener('click',()=>{viewMonth=shiftMonth(shownMonth,1);render();});
  $('cal-today').addEventListener('click',()=>openDay(today()));
  $('cal-jump').addEventListener('change',event=>{if(/^\d{4}-\d{2}$/.test(event.target.value)){viewMonth=event.target.value;render();}});
  $('cal-clear').addEventListener('click',()=>{checkedDays.clear();render();});
  $('audit-report').addEventListener('click',printReport);
  $('audit-record').addEventListener('click',()=>{if(current)onRecordSnapshot?.();});
  $('alert-close-drawer').addEventListener('click',()=>{
    for(const card of drawer.children)alerts.dismiss(card.dataset.eventId);
    drawer.hidden=true;
  });
  dialog.addEventListener('close',()=>alerts.dismiss($('alert-preview').firstElementChild?.dataset.eventId));
  $('alert-test').addEventListener('click',()=>{
    if(current){
      const action=createEvent('NOTIFICATION_TEST');
      const row=log.append(current.snapshot,{...current,action});
      notify(row,{test:true,modal:true});render();
    }
  });
  window.addEventListener('storage',event=>{if(event.key===null||event.key?.startsWith(AUDIT_PREFIX))render();});
  render();
  return Object.freeze({accept,download:(scope='all')=>download(scope),openDay,setFilter,list:log.list,hasEvent:id=>Boolean(log.get(id)),resetDemoRun:runId=>{
    clearTimeout(queued);clearTimeout(toastTimer);
    log.resetDemoRun(runId);alerts.resetDemo(runId);
    for(const card of [...drawer.children])if(card.dataset.source==='demo'&&card.dataset.demoRunId===runId)card.remove();
    if(!drawer.children.length)drawer.hidden=true;
    const preview=$('alert-preview').firstElementChild;
    if(preview?.dataset.source==='demo'&&preview.dataset.demoRunId===runId){dialog.close();$('alert-preview').replaceChildren();}
    selectedDay=null;viewMonth=null;checkedDays.clear();
    current=null;setFilter('all');
  },suspend:()=>{
    current=null;$('audit-record').disabled=true;$('alert-test').disabled=true;
  },setDispatcher:fn=>{
    if(fn!==null&&typeof fn!=='function')throw new TypeError('Provide a dispatcher callback or null');
    externalDispatch=fn;
  },dispose:()=>clearInterval(heartbeat)});
}
