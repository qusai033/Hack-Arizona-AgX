// Calendar view of the audit log: pure helpers (no DOM), so they can be tested in Node.
// This module must not import audit.js or audit-csv.js: the CSV serializer imports recordDay from here.
import { deltas } from './contract.js';

const RANK = { GO: 0, CAUTION: 1, STOP: 2 };
const hiddenRisk = snapshot => snapshot.evaluation.caught_hidden_risk ??
  (snapshot.evaluation.single_station_5ft_status === 'GO' && snapshot.evaluation.multi_height_status === 'STOP');

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dayKey(timestamp, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone
  }).formatToParts(new Date(timestamp));
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
/**
 * The day a record belongs to: its snapshot timestamp's calendar date in the time zone recorded
 * with it (v2 source provenance), otherwise in the supplied fallback zone. Nothing is written to
 * the record, so legacy v1 rows and rows without provenance are filed without inventing metadata.
 */
export function recordDay(record, fallbackZone) {
  const recorded = record.evidence?.provenance?.time_zone;
  if (typeof recorded === 'string' && recorded) {
    try { return dayKey(record.snapshot.timestamp, recorded); } catch { /* unusable stored zone */ }
  }
  return dayKey(record.snapshot.timestamp, fallbackZone);
}
/** 'YYYY-MM' + offset in months -> 'YYYY-MM' */
export function shiftMonth(month, by) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** 'YYYY-MM-DD' + offset in days -> 'YYYY-MM-DD' */
export function shiftDay(day, by) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
}
/** Weeks (Sunday first) covering a month: [{ key:'YYYY-MM-DD', day, inMonth }] x 7 per week. */
export function monthGrid(month) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = Date.UTC(y, m - 1, 1 - first.getUTCDay());
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start + (w * 7 + d) * 86400000);
      week.push({ key: date.toISOString().slice(0, 10), day: date.getUTCDate(), inMonth: date.getUTCMonth() === m - 1 });
    }
    if (!week.some(cell => cell.inMonth)) break;
    weeks.push(week);
  }
  return weeks;
}
/**
 * Map 'YYYY-MM-DD' -> records of that day, oldest first. Each record lands on exactly one date.
 * Every stored record is kept: distinct recorded events stay distinct even when their readings match.
 */
export function groupByDay(records, zone) {
  const days = new Map();
  for (const record of records) {
    const key = recordDay(record, zone);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(record);
  }
  for (const rows of days.values()) {
    rows.sort((a, b) => Date.parse(a.snapshot.timestamp) - Date.parse(b.snapshot.timestamp) ||
      a.recorded_at.localeCompare(b.recorded_at) ||
      (a.sequence_number ?? 0) - (b.sequence_number ?? 0) || a.id.localeCompare(b.id));
  }
  return days;
}
const range = values => {
  const numbers = values.filter(Number.isFinite);
  return numbers.length ? { low: Math.min(...numbers), high: Math.max(...numbers) } : null;
};
function prevailing(readings) {
  const counts = new Map();
  for (const r of readings) if (r.wind_speed_mph > 0) counts.set(r.wind_dir_cardinal, (counts.get(r.wind_dir_cardinal) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'calm';
}
function height(rows, key) {
  const readings = rows.map(r => r.snapshot.readings[key]);
  return {
    temp: range(readings.map(r => r.temp_f)),
    wind: range(readings.map(r => r.wind_speed_mph)),
    humidity: range(readings.map(r => r.humidity_pct)),
    prevailing: prevailing(readings)
  };
}
/** Everything recorded on one day, summarized from that day's records only (no estimates). */
export function summarizeDay(rows) {
  if (!rows?.length) return null;
  const status = { GO: 0, CAUTION: 0, STOP: 0 };
  let worst = 'GO';
  for (const { snapshot } of rows) {
    const s = snapshot.evaluation.multi_height_status;
    status[s] = (status[s] ?? 0) + 1;
    if (RANK[s] > RANK[worst]) worst = s;
  }
  const d = rows.map(r => deltas(r.snapshot));
  const unique = list => [...new Set(list.filter(Boolean))];
  return {
    count: rows.length,
    first: rows[0].snapshot.timestamp,
    last: rows[rows.length - 1].snapshot.timestamp,
    status, worst,
    ground: height(rows, 'ground_5ft'),
    canopy: height(rows, 'canopy_30ft'),
    maxInversion: Math.max(...d.map(x => x.temperature)),
    maxSpeedShear: Math.max(...d.map(x => Math.abs(x.speed))),
    maxDirectionShift: Math.max(...d.map(x => x.direction)),
    hiddenRisks: rows.filter(r => hiddenRisk(r.snapshot)).length,
    inversions: rows.filter(r => r.snapshot.evaluation.triggered_rules.some(rule => rule.code === 'INVERSION_DETECTED')).length,
    sources: unique(rows.map(r => r.source)),
    blocks: unique(rows.map(r => r.snapshot.orchard_block)),
    conditions: unique(rows.map(r => r.snapshot.scenario_name)),
    profiles: unique(rows.map(r => r.snapshot.pesticide_profile.name)),
    sessions: unique(rows.map(r => r.session?.state)),
    events: unique(rows.map(r => r.event))
  };
}
