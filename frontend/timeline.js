import { assertSnapshot } from './contract.js';
export function validateForecast(snapshots, intervalMinutes = 30) {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0 || intervalMinutes > 60) throw new Error('Forecast interval must be 1–60 minutes.');
  if (!Array.isArray(snapshots) || !snapshots.length || snapshots.length > 1440) throw new Error('No forecast periods available.');
  const duration = intervalMinutes * 60000;
  snapshots.forEach((s,i)=>{
    assertSnapshot(s);
    if (i && Date.parse(s.timestamp) - Date.parse(snapshots[i-1].timestamp) !== duration) throw new Error('Forecast periods must be ordered, contiguous, and equally spaced.');
  });
  return snapshots;
}
export function nextWindow(snapshots, intervalMinutes = 30, after = -Infinity) {
  validateForecast(snapshots, intervalMinutes);
  const duration = intervalMinutes * 60000;
  let start = null, end = null;
  for (const s of snapshots) {
    const t = Date.parse(s.timestamp);
    if (t + duration <= after) continue;
    if (s.evaluation.multi_height_status === 'GO') { if (start===null) start = Math.max(t,after); end = t + duration; }
    else if (start!==null) break;
  }
  return start===null ? null : {start,end,hours:(end-start)/3600000};
}
export function formatTime(timestamp, timeZone='America/Los_Angeles') {
  return new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone}).format(new Date(timestamp));
}
