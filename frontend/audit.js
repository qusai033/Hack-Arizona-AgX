import { assertSnapshot, deltas } from './contract.js';
import { assertEvent } from './events.js';
import { auditCSV } from './audit-csv.js';
import { buildAuditEvidence, normalizeAuditRecord, AUDIT_SCHEMA_VERSION } from './audit-record.js';

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
          return normalizeAuditRecord(record);
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
              records.set(record.id, normalizeAuditRecord(record));
            }
          } catch { /* Ignore malformed stored entries. */ }
        }
      } catch { persistent = false; }
    }
    for(const record of records.values())if(Number.isSafeInteger(record.sequence_number))sequence=Math.max(sequence,record.sequence_number);
    return [...records.values()].sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at)||
      (a.sequence_number??0)-(b.sequence_number??0)||a.id.localeCompare(b.id)).map(row=>structuredClone(row));
  }
  function append(snapshot, {event='tick', source='unknown', session=null, action,
    evaluationContext={}, provenance=null}={}) {
    if (action) assertEvent(action);
    const eventId = action?.event_id ?? id();
    const existing = get(eventId);
    if (existing) {
      if (action) return existing;
      throw new Error('Duplicate audit record ID');
    }
    assertSnapshot(snapshot);
    if(!sequence)list();
    const recorded_at=action?.recorded_at ?? clock().toISOString();
    const evidence=buildAuditEvidence(snapshot,{source,session,evaluationContext,provenance,recordedAt:recorded_at});
    const record = { schema_version:AUDIT_SCHEMA_VERSION, id:eventId, event_id:eventId,
      sequence_number:++sequence, recorded_at,
      event:action?.event_type ?? event, source, session:structuredClone(session),
      snapshot:structuredClone(snapshot), evidence };
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
export { auditCSV };
export function alertText(record) {
  const s=record.snapshot,e=s.evaluation,g=s.readings.ground_5ft,c=s.readings.canopy_30ft,d=deltas(s);
  const post=e.triggered_rules.find(rule=>rule.code==='POST_SPRAY_VOLATILITY_ALERT');
  const title=post?'POST-SPRAY VOLATILITY ALERT':e.multi_height_status==='STOP'?
    (record.session?.state==='SPRAYING_IN_PROGRESS'?'STOP SPRAYING':'DO NOT SPRAY'):'PAUSE AND CHECK CONDITIONS';
  const details=`5 ft: ${g.wind_speed_mph.toFixed(1)} mph. 30 ft: ${c.wind_speed_mph.toFixed(1)} mph from ${c.wind_dir_cardinal}. Upper air is ${Math.abs(d.temperature).toFixed(1)}°F ${d.temperature>=0?'warmer':'cooler'}. Wind direction shifts ${d.direction.toFixed(0)}°. ${post?.explanation??e.headline_reason}`;
  return {title:`${title} · ${s.orchard_block}`,body:details};
}
