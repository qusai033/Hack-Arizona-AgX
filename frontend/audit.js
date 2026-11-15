import { deltas } from './contract.js';
import { auditCSV } from './audit-csv.js';
export {createAuditLog} from './audit-storage.js';

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
