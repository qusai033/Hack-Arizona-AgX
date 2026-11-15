import { deltas, escapeHTML as esc, signed } from './contract.js';
import { auditCSV, createAuditLog, filterRecords, hiddenRisk, localDate, reasons, alertText } from './audit.js';
import { assertEvent, createEvent } from './events.js';
import {createAlertLifecycle} from './alert-state.js';
import {AUDIT_PREFIX, persistenceWarning} from './audit-storage.js';

export function mountAudit({zone=()=> 'America/Los_Angeles', onRecordSnapshot, logOptions={}}={}) {
  let storage;
  try {storage=window.localStorage;} catch {}
  const log=createAuditLog(storage,logOptions);
  const alerts=createAlertLifecycle();
  const $=id=>document.getElementById(id);
  let current, filter='all', queued, toastTimer, externalDispatch;
  const table=$('audit-rows'), dialog=$('alert-dialog'), drawer=$('alert-drawer');
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
    const restored=log.read(), rows=filterRecords(restored.records,filter).reverse();
    $('audit-count').textContent=`${rows.length} displayed · ${restored.persistent?'Saved in this browser':'Storage needs attention'} · ${zone()}`;
    showPersistence(restored);
    table.replaceChildren();
    for(const row of rows.slice(0,250)){
      const s=row.snapshot,e=s.evaluation,d=deltas(s);
      const telemetry=r=>`${r.temp_f.toFixed(1)}°F · ${r.wind_speed_mph.toFixed(1)} mph ${r.wind_speed_mph===0?'calm':r.wind_dir_cardinal}`;
      const pesticide=row.session?.state==='SPRAYING_IN_PROGRESS'?row.session.pesticide_profile.name:s.pesticide_profile.name;
      const treatment=row.session?.state==='POST_SPRAY_CURING'?` · Prior treatment: ${row.session.pesticide_profile.name}`:'';
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${esc(localDate(row.recorded_at,zone()))}<small>Observation ${esc(localDate(s.timestamp,zone()))} · ${esc(row.source)}<br>ID ${esc(row.id)}</small></td>
      <td>${esc(s.orchard_block)}<small>${esc(pesticide+treatment)}</small></td>
      <td>${esc(telemetry(s.readings.ground_5ft))}</td><td>${esc(telemetry(s.readings.canopy_30ft))}</td>
      <td>${signed(d.temperature)}°F · ${Math.abs(d.speed).toFixed(1)} mph · ${d.direction.toFixed(0)}°</td>
      <td><span class="result-badge ${e.multi_height_status}">${e.multi_height_status}</span></td><td>${esc(reasons(s))}</td>
      <td><span class="result-badge ${hiddenRisk(s)?'STOP':e.single_station_5ft_status}">${hiddenRisk(s)?'HIDDEN RISK CAUGHT':e.single_station_5ft_status}</span></td>`;
      table.append(tr);
    }
    $('audit-limit').textContent=rows.length>250?'Showing the latest 250 rows. Exports include all matching records.':'';
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
  function download() {
    const data=auditCSV(filterRecords(log.list(),filter),zone());
    const url=URL.createObjectURL(new Blob(['\uFEFF',data],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download='canopyguard-pca-audit.csv';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function printReport() {
    const records=filterRecords(log.list(),filter).reverse();
    const report=$('audit-print');
    report.innerHTML=`<h1>CanopyGuard Spray Compliance Report</h1><p>Generated ${esc(localDate(new Date().toISOString(),zone()))} · ${esc(zone())} · Filter: ${esc(filter)} · ${records.length} records</p><p>Decision-support record. Source labels distinguish simulation from connected observations. Verify pesticide labels and on-site conditions.</p>`;
    for(const row of records){
      const s=row.snapshot, e=s.evaluation,d=deltas(s),g=s.readings.ground_5ft,c=s.readings.canopy_30ft;
      const section=document.createElement('section');
      section.innerHTML=`<h2>${esc(s.orchard_block)} · ${e.multi_height_status}</h2><p>${esc(localDate(row.recorded_at,zone()))} · ${esc(row.source)} · ${esc(row.id)}</p><p>Observation ${esc(s.timestamp)} · ${esc(s.pesticide_profile.name)}${row.session?' · '+esc(row.session.state+' · '+row.session.pesticide_profile.name):''}</p><p>5 ft: ${g.temp_f.toFixed(1)}°F, ${g.wind_speed_mph.toFixed(1)} mph ${esc(g.wind_dir_cardinal)} · 30 ft: ${c.temp_f.toFixed(1)}°F, ${c.wind_speed_mph.toFixed(1)} mph ${esc(c.wind_dir_cardinal)}</p><p>Temperature difference ${signed(d.temperature)}°F · Speed shear ${Math.abs(d.speed).toFixed(1)} mph · Direction shift ${d.direction.toFixed(0)}° · Ground-only ${e.single_station_5ft_status}${hiddenRisk(s)?' · HIDDEN RISK CAUGHT':''}</p><p>${esc(reasons(s))}</p>`;
      report.append(section);
    }
    window.print();
  }
  document.querySelectorAll('[data-audit-filter]').forEach(button=>button.addEventListener('click',()=>setFilter(button.dataset.auditFilter)));
  $('audit-download').addEventListener('click',download);
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
  return Object.freeze({accept,download,setFilter,list:log.list,hasEvent:id=>Boolean(log.get(id)),resetDemoRun:runId=>{
    clearTimeout(queued);clearTimeout(toastTimer);
    log.resetDemoRun(runId);alerts.resetDemo(runId);
    for(const card of [...drawer.children])if(card.dataset.source==='demo'&&card.dataset.demoRunId===runId)card.remove();
    if(!drawer.children.length)drawer.hidden=true;
    const preview=$('alert-preview').firstElementChild;
    if(preview?.dataset.source==='demo'&&preview.dataset.demoRunId===runId){dialog.close();$('alert-preview').replaceChildren();}
    current=null;setFilter('all');
  },suspend:()=>{
    current=null;$('audit-record').disabled=true;$('alert-test').disabled=true;
  },setDispatcher:fn=>{
    if(fn!==null&&typeof fn!=='function')throw new TypeError('Provide a dispatcher callback or null');
    externalDispatch=fn;
  },dispose:()=>clearInterval(heartbeat)});
}
