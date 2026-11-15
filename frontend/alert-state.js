/** Notification state is independent of audit recording and changing metric text. */
export function reasonSignature(evaluation) {
  return JSON.stringify([...new Set(evaluation.triggered_rules.map(rule =>
    JSON.stringify([rule.severity, rule.code])))].sort());
}

export function createAlertLifecycle() {
  const conditions = new Map(), processed = new Set();
  function accept(record, {force = false, silent = false} = {}) {
    if (processed.has(record.id)) return {notify: false};
    processed.add(record.id);
    const e = record.snapshot.evaluation;
    const context = JSON.stringify([record.source, record.snapshot.orchard_block, record.demo_run_id ?? null]);
    if (e.multi_height_status === 'GO') {
      conditions.delete(context);
      return {notify: false};
    }
    const signature = JSON.stringify([e.multi_height_status, reasonSignature(e), record.session?.state ?? null]);
    const previous = conditions.get(context);
    if (previous?.signature === signature && !force) return {notify: false, alert: {...previous}};
    const alert = {event_id: record.id, source: record.source, demo_run_id: record.demo_run_id ?? null,
      context, signature, dismissed: silent};
    conditions.set(context, alert);
    return {notify: !silent, alert: {...alert}};
  }
  function dismiss(eventId) {
    for (const alert of conditions.values()) if (alert.event_id === eventId) alert.dismissed = true;
  }
  function resetDemo(runId) {
    for (const [key, alert] of conditions) {
      if (alert.source === 'demo' && alert.demo_run_id === runId) conditions.delete(key);
    }
  }
  return Object.freeze({accept, dismiss, resetDemo,
    list: () => [...conditions.values()].map(alert => ({...alert}))});
}
