import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditCSV, CSV_UNAVAILABLE } from '../frontend/audit-csv.js';
import { createAuditLog, filterRecords } from '../frontend/audit.js';
import { createEvent } from '../frontend/events.js';
import { simulateWeather } from '../frontend/weather.js';

function parseCSV(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\r' && text[i + 1] === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      i++;
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error('CSV ended inside a quoted field.');
  if (row.length || value) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
const column = (headers, name) => {
  const index = headers.indexOf(name);
  assert.notEqual(index, -1, 'Missing CSV column: ' + name);
  return index;
};
function makeLog({ storage = null } = {}) {
  let id = 0;
  return createAuditLog(storage, {
    id: () => 'generated-' + (++id),
    clock: () => new Date('2026-11-15T18:00:23.000Z')
  });
}
function makeRecordedRow({ snapshot = simulateWeather('trap'), session = null, source = 'demo' } = {}) {
  const log = makeLog();
  const action = createEvent('MANUAL_SNAPSHOT_RECORDED', {}, {
    id: () => 'csv-event-1',
    now: () => '2026-11-15T18:00:23.000Z'
  });
  return log.append(snapshot, { source, session, action });
}

test('CSV round-trip preserves full versioned evidence and exact source measurements', () => {
  const row = makeRecordedRow();
  const parsed = parseCSV(auditCSV([row], 'America/Phoenix'));
  const [headers, values] = parsed;
  assert.equal(values.length, headers.length);
  const get = name => values[column(headers, name)];

  assert.equal(get('Log ID'), row.id);
  assert.equal(get('Event ID'), row.event_id);
  assert.equal(get('Event'), row.event);
  assert.equal(get('Record schema version'), String(row.schema_version));
  assert.equal(get('Engine version'), row.evidence.engine_version);
  assert.equal(get('Observation UTC'), row.snapshot.timestamp);
  assert.equal(get('Recorded UTC'), row.recorded_at);
  assert.equal(get('Time zone'), 'America/Phoenix');

  assert.equal(get('5 ft humidity %'), String(row.snapshot.readings.ground_5ft.humidity_pct));
  assert.equal(get('5 ft wind bearing °'), String(row.snapshot.readings.ground_5ft.wind_dir_deg));
  assert.equal(get('30 ft humidity %'), String(row.snapshot.readings.canopy_30ft.humidity_pct));
  assert.equal(get('30 ft wind bearing °'), String(row.snapshot.readings.canopy_30ft.wind_dir_deg));

  assert.deepEqual(JSON.parse(get('Session JSON')), row.session);
  assert.deepEqual(JSON.parse(get('Snapshot JSON')), row.snapshot);
  assert.deepEqual(JSON.parse(get('Effective thresholds JSON')), row.evidence.effective_thresholds);
  assert.deepEqual(JSON.parse(get('Effective profile JSON')), row.evidence.effective_profile);
  assert.deepEqual(JSON.parse(get('Evaluation JSON')), row.snapshot.evaluation);
  assert.deepEqual(JSON.parse(get('Evaluation context JSON')), row.evidence.evaluation_context);
  assert.deepEqual(JSON.parse(get('Diagnostics JSON')), row.evidence.diagnostics);
  assert.deepEqual(JSON.parse(get('Source provenance JSON')), row.evidence.provenance);
  assert.deepEqual(JSON.parse(get('Timestamp evidence JSON')), row.evidence.times);
  assert.deepEqual(JSON.parse(get('Audit evidence JSON')), row.evidence);
});

test('CSV quoting handles formula-like text, quotes, commas, newlines, and Unicode', () => {
  const snapshot = simulateWeather('trap');
  snapshot.orchard_block = ' =HYPERLINK("https://example.test/a,b")\n北区 · Block 4B';
  snapshot.scenario_name = 'Quoted, "north" orchard\r\n第二行';
  const row = makeRecordedRow({ snapshot });
  const [headers, values] = parseCSV(auditCSV([row], 'America/Los_Angeles'));
  const get = name => values[column(headers, name)];

  assert.equal(get('Orchard block'), "' =HYPERLINK(\"https://example.test/a,b\")\n北区 · Block 4B");
  assert.equal(get('Snapshot JSON'), JSON.stringify(row.snapshot));
  assert.equal(JSON.parse(get('Snapshot JSON')).scenario_name, 'Quoted, "north" orchard\r\n第二行');
  assert.equal(get('Trigger reasons'), row.snapshot.evaluation.triggered_rules
    .map(rule => rule.code + ': ' + rule.metric + '. ' + rule.explanation).join(' | '));
  assert.ok(auditCSV([row], 'America/Los_Angeles').endsWith('\r\n'));
});

test('empty export contains the complete header row and CRLF terminator', () => {
  const csv = auditCSV([], 'America/Phoenix');
  const parsed = parseCSV(csv);
  assert.equal(parsed.length, 1);
  assert.ok(parsed[0].includes('Snapshot JSON'));
  assert.ok(parsed[0].includes('Evaluation context JSON'));
  assert.ok(csv.endsWith('\r\n'));
});

test('legacy records keep readable data and mark unavailable evidence explicitly', () => {
  const snapshot = simulateWeather('trap');
  const legacy = {
    id: 'legacy-row',
    recorded_at: '2026-11-15T18:00:23.000Z',
    source: 'demo',
    event: 'old record',
    session: null,
    snapshot
  };
  const values = new Map([['canopyguard.audit.v1.legacy-row', JSON.stringify(legacy)]]);
  const storage = {
    get length() { return values.size; },
    key: index => [...values.keys()][index],
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const oldRow = createAuditLog(storage).list()[0];
  const [headers, cells] = parseCSV(auditCSV([oldRow], 'America/Phoenix'));
  const get = name => cells[column(headers, name)];

  assert.equal(get('Record schema version'), '1');
  assert.equal(get('Engine version'), CSV_UNAVAILABLE);
  assert.equal(get('Effective thresholds JSON'), CSV_UNAVAILABLE);
  assert.equal(get('Evaluation context JSON'), CSV_UNAVAILABLE);
  assert.equal(get('Diagnostics JSON'), CSV_UNAVAILABLE);
  assert.deepEqual(JSON.parse(get('Snapshot JSON')), snapshot);
  assert.deepEqual(JSON.parse(get('Evaluation JSON')), snapshot.evaluation);
  assert.equal(get('Session JSON'), 'null');
});

test('export includes all records, not only the 250 rows shown by the audit table', () => {
  const log = makeLog();
  const snapshot = simulateWeather('trap');
  for (let i = 0; i < 275; i++) {
    const action = createEvent('SIMULATION_TICK', { index: i }, {
      id: () => 'many-' + i,
      now: () => '2026-11-15T18:00:23.000Z'
    });
    log.append(snapshot, { source: 'demo', action });
  }
  const filtered = filterRecords(log.list(), 'all');
  assert.equal(filtered.length, 275);
  const rows = parseCSV(auditCSV(filtered, 'America/Phoenix'));
  assert.equal(rows.length, 276);
  assert.equal(rows[0].length, rows[275].length);
});

test('selected filters are applied before serialization without imposing a display cap', () => {
  const log = makeLog();
  const action = createEvent('MANUAL_SNAPSHOT_RECORDED', {}, {
    id: () => 'filter-stop',
    now: () => '2026-11-15T18:00:23.000Z'
  });
  log.append(simulateWeather('trap'), { source: 'demo', action });
  const matching = filterRecords(log.list(), 'hidden');
  assert.equal(matching.length, 1);
  const rows = parseCSV(auditCSV(matching, 'America/Phoenix'));
  assert.equal(rows.length, 2);
});

test('external evaluator null metadata stays explicit instead of becoming invented engine provenance', () => {
  const row = makeRecordedRow({ source: 'imported' });
  const [headers, values] = parseCSV(auditCSV([row], 'America/Phoenix'));
  const get = name => values[column(headers, name)];
  assert.equal(get('Evaluator kind'), 'external_or_unverified');
  assert.equal(get('Engine version'), 'null');
  assert.equal(JSON.parse(get('Effective thresholds JSON')), null);
  assert.equal(get('Rule/config version'), CSV_UNAVAILABLE);
  assert.deepEqual(JSON.parse(get('Audit evidence JSON')), row.evidence);
});
