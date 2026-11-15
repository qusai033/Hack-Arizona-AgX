/** Create identity once at the action boundary, before evaluation or rendering. */
export function createEvent(event_type, payload = {}, {
  id = () => crypto.randomUUID(), now = () => new Date().toISOString()
} = {}) {
  return assertEvent({event_id: id(), event_type, recorded_at: now(), payload: structuredClone(payload)});
}

export function assertEvent(event) {
  if (!event || typeof event.event_id !== 'string' || !event.event_id.trim() ||
      typeof event.event_type !== 'string' || !event.event_type.trim() ||
      typeof event.recorded_at !== 'string' || !Number.isFinite(Date.parse(event.recorded_at))) {
    throw new TypeError('An event ID, type, and recording time are required.');
  }
  return event;
}
