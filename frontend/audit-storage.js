import {assertSnapshot} from './contract.js';
import {assertSession} from './engine/session.js';
import {assertEvent} from './events.js';
import {readAuditRecord, IncompatibleAuditRecord} from './audit-validation.js';
import {buildAuditEvidence, AUDIT_SCHEMA_VERSION} from './audit-record.js';

export const AUDIT_PREFIX = 'canopyguard.audit.v1.';
export function createAuditLog(storage, {clock = () => new Date(), id = () => crypto.randomUUID(),
  readRecord = readAuditRecord} = {}) {
  const memory = new Map(), unsaved = new Set(), hidden = new Set(), issues = new Map();
  let sequence = 0;
  const report = (code, key = '') => issues.set(`${code}:${key}`, {code, ...(key ? {key} : {})});
  const resolve = (code, key = '') => issues.delete(`${code}:${key}`);
  if (!storage) report('STORAGE_UNAVAILABLE');
  function status() {
    const values = [...issues.values()].map(value => ({...value}));
    return {persistent: !values.some(({code}) => ['STORAGE_UNAVAILABLE', 'READ_FAILED', 'WRITE_FAILED',
      'QUOTA_EXCEEDED', 'REMOVE_FAILED'].includes(code)), unsaved_count: unsaved.size, issues: values};
  }
  function decode(raw, key) {
    try {
      const {record, warnings = []} = readRecord(JSON.parse(raw));
      if (key !== AUDIT_PREFIX + record.id) throw new TypeError('Stored identity does not match its key.');
      resolve('MALFORMED_RECORD', key); resolve('INCOMPATIBLE_RECORD', key);
      resolve('LEGACY_CONTEXT_UNAVAILABLE', key);
      for (const code of warnings) report(code, key);
      return record;
    } catch (error) {
      const code = error instanceof IncompatibleAuditRecord ? 'INCOMPATIBLE_RECORD' : 'MALFORMED_RECORD';
      report(code, key);
      return null;
    }
  }
  function read() {
    if (storage) {
      const found = new Set();
      let complete = true;
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key?.startsWith(AUDIT_PREFIX)) continue;
          found.add(key);
          const eventId = key.slice(AUDIT_PREFIX.length);
          if (hidden.has(eventId)) continue;
          try {
            const raw = storage.getItem(key);
            resolve('READ_FAILED', key);
            if (raw == null) continue;
            const record = decode(raw, key);
            if (record && !unsaved.has(eventId)) memory.set(eventId, record);
          } catch { report('READ_FAILED', key); complete = false; }
        }
        resolve('READ_FAILED');
      } catch { report('READ_FAILED'); complete = false; }
      // Observe deletion by another tab, but keep activity that has not been saved.
      if (complete) {
        for (const eventId of memory.keys()) {
          if (!unsaved.has(eventId) && !found.has(AUDIT_PREFIX + eventId)) memory.delete(eventId);
        }
        for (const [key, issue] of issues) if (issue.key && !found.has(issue.key) &&
          ['MALFORMED_RECORD', 'INCOMPATIBLE_RECORD', 'LEGACY_CONTEXT_UNAVAILABLE', 'READ_FAILED'].includes(issue.code)) issues.delete(key);
      }
    }
    const records = [...memory.values()];
    for (const row of records) if (Number.isSafeInteger(row.sequence_number)) sequence = Math.max(sequence, row.sequence_number);
    records.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at) ||
      (a.sequence_number ?? 0) - (b.sequence_number ?? 0) || a.id.localeCompare(b.id));
    return {records: structuredClone(records), ...status()};
  }
  function get(eventId) {
    if (hidden.has(eventId)) return undefined;
    if (memory.has(eventId)) return structuredClone(memory.get(eventId));
    if (storage) {
      const key = AUDIT_PREFIX + eventId;
      try {
        const raw = storage.getItem(key);
        resolve('READ_FAILED', key);
        if (raw != null) {
          const row = decode(raw, key);
          if (row) { memory.set(eventId, row); return structuredClone(row); }
        }
      } catch { report('READ_FAILED', key); }
    }
  }
  function write(snapshot, {event = 'tick', source = 'unknown', session = null, action, demo_run_id,
    evaluationContext = {}, provenance = null} = {}) {
    if (action) assertEvent(action);
    const eventId = action?.event_id ?? id();
    const existing = get(eventId);
    if (existing) {
      if (!action) throw new Error('Duplicate audit record ID');
      return {record: existing, duplicate: true, saved: !unsaved.has(eventId), ...status()};
    }
    assertSnapshot(snapshot);
    if (session !== null) assertSession(session);
    if (!sequence) read();
    const recorded_at = action?.recorded_at ?? clock().toISOString();
    const evidence = buildAuditEvidence(snapshot, {source, session, evaluationContext, provenance, recordedAt: recorded_at});
    const record = {schema_version: AUDIT_SCHEMA_VERSION, id: eventId, event_id: eventId, sequence_number: ++sequence,
      recorded_at, event: action?.event_type ?? event,
      source, session: structuredClone(session), snapshot: structuredClone(snapshot),
      evidence, ...(demo_run_id === undefined ? {} : {demo_run_id})};
    readRecord(record); // A malformed new envelope must never enter the live UI.
    const key = AUDIT_PREFIX + eventId;
    let saved = false;
    if (storage) {
      let canWrite = true, occupied;
      try { occupied = storage.getItem(key); resolve('READ_FAILED', key); }
      catch { report('READ_FAILED', key); canWrite = false; }
      // Even unreadable or incompatible history reserves its storage key.
      if (occupied != null) throw new Error('Duplicate audit record ID');
      if (canWrite) try {
        storage.setItem(key, JSON.stringify(record)); saved = true;
      } catch (error) {
        report(error?.name === 'QuotaExceededError' ? 'QUOTA_EXCEEDED' : 'WRITE_FAILED', key);
      }
    }
    if (!saved) unsaved.add(eventId);
    memory.set(eventId, structuredClone(record));
    return {record: structuredClone(record), duplicate: false, saved, ...status()};
  }
  function resetDemoRun(runId) {
    if (typeof runId !== 'string' || !runId.trim()) throw new TypeError('An explicit demo run ID is required.');
    const removed = [];
    for (const row of read().records) {
      if (row.source !== 'demo' || row.demo_run_id !== runId) continue;
      const key = AUDIT_PREFIX + row.id;
      if (storage) try {
        const raw = storage.getItem(key);
        const saved = raw == null ? null : decode(raw, key);
        // Preserve anything whose ownership cannot be verified, even on reset.
        if (raw != null && (!saved || saved.source !== 'demo' || saved.demo_run_id !== runId)) {
          report('REMOVE_FAILED', key);
        } else { storage.removeItem(key); resolve('REMOVE_FAILED', key); }
      } catch { report('REMOVE_FAILED', key); }
      hidden.add(row.id); memory.delete(row.id); unsaved.delete(row.id);
      resolve('WRITE_FAILED', key); resolve('QUOTA_EXCEEDED', key);
      removed.push(row.id);
    }
    return {removed, ...status()};
  }
  return Object.freeze({read, write, status, resetDemoRun, get,
    append: (snapshot, options) => write(snapshot, options).record,
    list: () => read().records, isPersistent: () => status().persistent});
}

export function persistenceWarning(result) {
  if (!result.issues.length) return '';
  const codes = new Set(result.issues.map(issue => issue.code));
  const messages = [];
  if (codes.has('STORAGE_UNAVAILABLE')) messages.push('Browser storage is unavailable.');
  if (codes.has('READ_FAILED')) messages.push('Some saved activity could not be read.');
  if (codes.has('MALFORMED_RECORD') || codes.has('INCOMPATIBLE_RECORD')) {
    messages.push('Only readable activity was recovered; damaged or unsupported records remain stored unchanged.');
  }
  if (codes.has('LEGACY_CONTEXT_UNAVAILABLE')) messages.push('Older activity has incomplete treatment context; missing values were not reconstructed.');
  if (codes.has('QUOTA_EXCEEDED')) messages.push('Browser storage is full; new activity is kept in this tab.');
  if (codes.has('WRITE_FAILED')) messages.push('Activity could not be saved; it remains in this tab.');
  if (codes.has('REMOVE_FAILED')) messages.push('Some demo activity could not be removed from storage and may return after reload.');
  return messages.join(' ') + ' Keep this tab open and export CSV before closing. The CSV contains the readable activity summary, not every original evidence field.';
}
