# Audit and alert integration

The dashboard appends accepted evaluations on status, scenario, or session changes and every 15 seconds. Repeated scenario clicks create explicit records. Each entry contains the observation timestamp from the shared snapshot and a separate UTC recording timestamp, along with its source and treatment summary. Exports use the dashboard's active timezone and the selected filter. The ground-only comparison in the walkthrough is presentation state. The canopy reveal records the actual evaluation.

`frontend/audit.js` exports `createAuditLog`, `filterRecords`, `auditCSV`, and `alertText`. The browser uses one storage key per record and exposes no update or delete operation. Persistence depends on browser storage. If storage is unavailable or fills up, the interface identifies records as temporary. Browser owners can alter or clear local storage. Production evidence requires a server-side append-only audit store with access controls and retention.

`window.CanopyGuardAudit.list()` returns copies of the records. `window.CanopyGuardAudit.setDispatcher(callback)` optionally accepts a callback that forwards real connected-mode alerts to a team-owned server. The payload includes the message, matching audit ID, and recipient roles. Keep provider credentials and real recipient mappings on that server. Test and demo alerts use local previews. No provider is configured by default.

The guided forecast uses the existing bundled replay, which keeps the 9:00 AM cue reproducible. The simulator panel can load a current NWS forecast separately. The report is browser print output with a Save as PDF option when supported.
