import { assertSnapshot, deltas } from './contract.js';
import { assertEvent } from './events.js';

const PREFIX = 'canopyguard.audit.v1.';
export function createAuditLog(storage, {clock = () => new Date(), id = () => crypto.randomUUID()} = {}) {
  const memory = new Map();
  let persistent = Boolean(storage);
  let sequence = 0;
  function get(eventId) {
    if (memory.has(eventId)) return structuredClone(memory.get(eventId));
    if (storage) {
      try {
        const record = JSON.parse(storage.getItem(PREFIX + eventId));
        if (record?.id === eventId && Number.isFinite(Date.parse(record.recorded_at))) {
          assertSnapshot(record.snapshot);
          return structuredClone(record);
        }
      } catch { /* list() also ignores malformed records; storage remains best effort. */ }
    }
  }
  function list() {
    const records = new Map(memory);
    if (storage) {
      try {
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (!key?.startsWith(PREFIX)) continue;
          try {
            const record = JSON.parse(storage.getItem(key));
            if (typeof record?.id==='string' && key === PREFIX + record.id && Number.isFinite(Date.parse(record.recorded_at))) {
              assertSnapshot(record.snapshot);
              records.set(record.id, record);
            }
          } catch { /* Ignore malformed stored entries. */ }
        }
      } catch { persistent = false; }
    }
    for(const record of records.values())if(Number.isSafeInteger(record.sequence_number))sequence=Math.max(sequence,record.sequence_number);
    return [...records.values()].sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at)||
      (a.sequence_number??0)-(b.sequence_number??0)||a.id.localeCompare(b.id)).map(row=>structuredClone(row));
  }
  function append(snapshot, {event='tick', source='unknown', session=null, action}={}) {
    if (action) assertEvent(action);
    const eventId = action?.event_id ?? id();
    const existing = get(eventId);
    if (existing) {
      if (action) return existing;
      throw new Error('Duplicate audit record ID');
    }
    assertSnapshot(snapshot);
    if(!sequence)list();
    const record = { id:eventId, event_id:eventId, sequence_number:++sequence, recorded_at:action?.recorded_at ?? clock().toISOString(),
      event:action?.event_type ?? event, source, session:structuredClone(session), snapshot:structuredClone(snapshot) };
    const key = PREFIX + record.id;
    if (memory.has(record.id)) throw new Error('Duplicate audit record ID');
    if (storage) {
      let existing;
      try { existing=storage.getItem(key); } catch { persistent=false; }
      if(existing!=null) throw new Error('Duplicate audit record ID');
      try {
        storage.setItem(key, JSON.stringify(record));
      } catch { persistent = false; }
    }
    memory.set(record.id,record);
    return structuredClone(record);
  }
  return Object.freeze({append,list,get,isPersistent:()=>persistent});
}
export const hiddenRisk = snapshot => snapshot.evaluation.caught_hidden_risk ??
  (snapshot.evaluation.single_station_5ft_status==='GO' && snapshot.evaluation.multi_height_status==='STOP');
export function filterRecords(records, filter='all') {
  return records.filter(({snapshot}) => {
    const evaluation=snapshot.evaluation;
    if(filter==='stop') return evaluation.multi_height_status==='STOP';
    if(filter==='inversion') return evaluation.triggered_rules.some(rule=>rule.code==='INVERSION_DETECTED'||rule.code==='POST_SPRAY_VOLATILITY_ALERT');
    if(filter==='hidden') return hiddenRisk(snapshot);
    return true;
  });
}
export function reasons(snapshot) {
  const {evaluation}=snapshot;
  return evaluation.triggered_rules.map(rule=>`${rule.code}: ${rule.metric}. ${rule.explanation}`).join(' | ') || evaluation.headline_reason;
}
export function localDate(timestamp, zone) {
  return new Intl.DateTimeFormat('en-US',{dateStyle:'short',timeStyle:'medium',timeZone:zone}).format(new Date(timestamp));
}
const csvCell = value => {
  let content=String(value??'');
  if(typeof value==='string' && /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(content)) content="'"+content;
  return '"'+content.replaceAll('"','""')+'"';
};
export function auditCSV(records, zone) {
  const header=['Log ID','Recorded UTC','Recorded local','Time zone','Observation UTC','Observation local','Source','Event','Session state','Orchard block','Active pesticide','Recorded treatment','5 ft °F','5 ft mph','5 ft wind from','30 ft °F','30 ft mph','30 ft wind from','Canopy minus ground °F','Absolute speed shear mph','Direction shift degrees','Multi-height status','Trigger reasons','Single-station status','Hidden risk caught'];
  const rows=records.map(({id,recorded_at,event,source,session,snapshot:s})=>{
    const {ground_5ft:g,canopy_30ft:c}=s.readings,d=deltas(s),e=s.evaluation;
    const applied=session?.pesticide_profile?.name;
    return [id,recorded_at,localDate(recorded_at,zone),zone,s.timestamp,localDate(s.timestamp,zone),source,event,session?.state,
      s.orchard_block,session?.state==='SPRAYING_IN_PROGRESS'?applied:s.pesticide_profile.name,applied,g.temp_f,g.wind_speed_mph,g.wind_dir_cardinal,c.temp_f,c.wind_speed_mph,c.wind_dir_cardinal,
      Number(d.temperature.toFixed(3)),Number(Math.abs(d.speed).toFixed(3)),Number(d.direction.toFixed(3)),e.multi_height_status,reasons(s),e.single_station_5ft_status,hiddenRisk(s)];
  });
  return [header,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function alertText(record) {
  const s=record.snapshot,e=s.evaluation,g=s.readings.ground_5ft,c=s.readings.canopy_30ft,d=deltas(s);
  const post=e.triggered_rules.find(rule=>rule.code==='POST_SPRAY_VOLATILITY_ALERT');
  const title=post?'POST-SPRAY VOLATILITY ALERT':e.multi_height_status==='STOP'?
    (record.session?.state==='SPRAYING_IN_PROGRESS'?'STOP SPRAYING':'DO NOT SPRAY'):'PAUSE AND CHECK CONDITIONS';
  const details=`5 ft: ${g.wind_speed_mph.toFixed(1)} mph. 30 ft: ${c.wind_speed_mph.toFixed(1)} mph from ${c.wind_dir_cardinal}. Upper air is ${Math.abs(d.temperature).toFixed(1)}°F ${d.temperature>=0?'warmer':'cooler'}. Wind direction shifts ${d.direction.toFixed(0)}°. ${post?.explanation??e.headline_reason}`;
  return {title:`${title} · ${s.orchard_block}`,body:details};
}
