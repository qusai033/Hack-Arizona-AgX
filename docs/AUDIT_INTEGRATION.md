# Audit and alert integration

The dashboard appends each accepted simulation step, profile/scenario/session change, reading edit, and intentional manual recording. Event IDs and real UTC recording times are assigned once at the action boundary. Reprocessing that ID returns the original record, including after storage reload; rendering does not create records. Distinct actions are retained even when their readings and rule results match. Live mode also records an explicit periodic event every 15 seconds; paused demo mode does not create background records.

Each entry contains its event ID/type, sequence number, recording time, observation timestamp, source, snapshot/evaluation, and available full treatment session. Sequence numbers preserve action order when recording timestamps match. Legacy records without event/sequence fields remain readable. Exports use the dashboard's active timezone and selected filter. The ground-only judge step is presentation state; the canopy reveal records the actual evaluation. Notification suppression is separate from event recording.

`frontend/audit.js` exports `createAuditLog`, `filterRecords`, `auditCSV`, and `alertText`. The browser uses one storage key per record and exposes no update or delete operation. Persistence depends on browser storage. If storage is unavailable or fills up, the interface identifies records as temporary. Browser owners can alter or clear local storage. Production evidence requires a server-side append-only audit store with access controls and retention.

`window.CanopyGuardAudit.list()` returns copies of the records. `recordSnapshot()` and the **Record Snapshot** button record the current valid evaluation without advancing simulation time. They are unavailable while observations are invalid or an evaluation is pending. `window.CanopyGuardAudit.setDispatcher(callback)` optionally accepts a callback that forwards real connected-mode alerts to a team-owned server. The payload includes the message, matching audit ID, and recipient roles. Keep provider credentials and real recipient mappings on that server. Test and demo alerts use local previews. No provider is configured by default.

The guided forecast uses the existing bundled replay, which keeps the 9:00 AM cue reproducible. The simulator panel can load a current NWS forecast separately. The report is browser print output with a Save as PDF option when supported.

See [TEAM4_CONTROLLER.md](TEAM4_CONTROLLER.md) for event creation, controller integration, and remaining evidence-schema work.
