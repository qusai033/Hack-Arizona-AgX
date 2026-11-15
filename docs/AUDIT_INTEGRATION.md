# Audit and alert integration

The dashboard appends each accepted simulation step, profile/scenario/session change, reading edit, and intentional manual recording. Event IDs and real UTC recording times are assigned once at the action boundary. Reprocessing that ID returns the original record, including after storage reload; rendering does not create records. Distinct actions are retained even when their readings and rule results match. Live mode also records an explicit periodic event every 15 seconds; paused demo mode does not create background records.

Each entry contains its event ID/type, sequence number, recording time, source, snapshot/evaluation, and available full treatment session. Version 2 records additionally carry an evidence envelope with the evaluator kind, engine version when the built-in evaluator actually produced the result, effective thresholds and profile, evaluation context, diagnostics, source provenance, and timestamp roles. The envelope keeps recording, snapshot/observation, simulation-clock, forecast-valid, and evaluation times distinct. The application does not invent a separate evaluation timestamp when one was not captured. Built-in demo/forecast results are checked against the recorded context before being attributed to the built-in engine. Live/imported/external evaluations are not attributed to that engine.

Legacy version 1 records remain readable. Their unavailable historical configuration and provenance are not reconstructed from today's settings; CSV fields for that absent evidence contain `[UNAVAILABLE]`. JSON `null` values that were explicitly recorded remain JSON `null`. The dashboard preserves the original snapshot and evaluation for those records.

## PCA CSV download

`frontend/audit-csv.js` owns the pure CSV serializer; `frontend/audit.js` re-exports `auditCSV` for the existing download UI. The CSV keeps the PCA-facing summary columns and timezone-local display values, then adds event/schema/evaluator metadata and unrounded source measurements, including humidity and numeric wind bearings at both heights.

The machine-readable evidence columns are:

- `Session JSON`: the complete recorded `SpraySession`, including treatment start/end times and end-of-treatment inversion context where present.
- `Snapshot JSON`: the complete shared weather snapshot and its evaluation-independent inputs.
- `Effective thresholds JSON` and `Effective profile JSON`: the exact built-in screening thresholds/profile stored with a verifiable v2 record.
- `Evaluation JSON`: the complete recorded evaluation, including all triggered rules and their explanations.
- `Evaluation context JSON`: the context passed to the evaluator, including the full session when one was used.
- `Diagnostics JSON`: engine diagnostics and calculated metrics.
- `Source provenance JSON`: source/provider/location/issuance context when available.
- `Timestamp evidence JSON`: the recorded timestamp roles and their values.

The individual recorded and observation timestamps remain in their readable columns. Simulation-clock, forecast-valid, observation, and evaluation timestamps are separate columns as well. If a historical record has no evidence envelope, those evidence fields use `[UNAVAILABLE]`; if a v2 external result explicitly has a null engine/configuration value, it remains null in the JSON evidence envelope. The absence of an independent evaluation timestamp is preserved as JSON `null`.

CSV fields use RFC 4180 quote escaping for commas, quotes, line breaks, and Unicode. Formula-like user-controlled text is neutralized for spreadsheet applications, while numeric values (including negative deltas) are not rewritten. The serializer writes a header row even when no records match and terminates records with CRLF. The download UI prepends a UTF-8 BOM for spreadsheet compatibility.

The selected audit filter is applied before serialization. The table displays at most the latest 250 matching records, but the CSV download receives every matching record; it does not inherit the table's display cap.

The browser uses one storage key per record and exposes no update or delete operation. Persistence depends on browser storage. If storage is unavailable or fills up, the interface identifies records as temporary. Browser owners can alter or clear local storage. Production evidence requires a server-side append-only audit store with access controls and retention.

`window.CanopyGuardAudit.list()` returns copies of the records. `recordSnapshot()` and the **Record Snapshot** button record the current valid evaluation without advancing simulation time. They are unavailable while observations are invalid or an evaluation is pending. `window.CanopyGuardAudit.setDispatcher(callback)` optionally accepts a callback that forwards real connected-mode alerts to a team-owned server. The payload includes the message, matching audit ID, and recipient roles. Keep provider credentials and real recipient mappings on that server. Test and demo alerts use local previews. No provider is configured by default.

The guided forecast uses the existing bundled replay, which keeps the 9:00 AM cue reproducible. The simulator panel can load a current NWS forecast separately. The report is browser print output with a Save as PDF option when supported.

See [TEAM4_CONTROLLER.md](TEAM4_CONTROLLER.md) for event creation, controller integration, and remaining evidence-schema work.
