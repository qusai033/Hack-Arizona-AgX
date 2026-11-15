# CanopyGuard audit evidence: version 2

Issue #9 adds a reproducible **application-level append-only** audit evidence envelope. Browser storage is user-modifiable and is **not** tamperproof, cryptographically immutable, or a substitute for signed compliance records. Each v2 record retains the existing event ID, sequence, recording time, source, full snapshot/result, and full spray session, and adds `schema_version: 2` plus `evidence`.

## Evidence fields

| Field | Meaning |
|---|---|
| `id`, `event_id`, `sequence_number`, `event` | Per-action identity and deterministic display order, preserved from Team 4 |
| `recorded_at` | Real event recording timestamp from the event envelope (or injected logger clock) |
| `snapshot.timestamp` | Original sample/forecast-valid/simulation clock; never treated as `recorded_at` |
| `session` | Actual validated `SpraySession` used for evaluation, including `orchard_block`, applied pesticide, `started_at`, `ended_at`, `inversion_at_end_f` |
| `evidence.engine_version` | Actual built-in evaluator version when the source is the known built-in `demo`/`forecast` engine; otherwise `null` |
| `evidence.effective_thresholds` | Exact `analyze(...).diagnostics.thresholds` for the recorded context; `null` for unverified/external decisions |
| `evidence.effective_profile` | Frozen effective pesticide profile, including the prior applied profile while spraying |
| `evidence.evaluation_context` | Full known engine inputs (especially `session`), deep-copied |
| `evidence.diagnostics` | Built-in evaluator diagnostics including version, thresholds, wet-bulb metrics and session-monitoring result; `null` when unavailable |
| `evidence.reproduced_with_current_engine` | True only after the built-in evaluator reproduces the exact stored result at logging time |
| `evidence.provenance` | Source metadata when known; forecast entries include selected city, NWS vs cached source, issuance/retrieval time and timezone |
| `evidence.times` | Distinguishes `recorded_at`, `snapshot_at`, `simulation_clock_at`, `forecast_valid_at`, `observation_at`, and `evaluated_at` |

The current application **does not separately capture an evaluation-execution timestamp**, so `evidence.times.evaluated_at` remains `null`; it is never inferred from the event or forecast-valid timestamp. Demo time is explicitly identified as a simulation clock, forecast time as an hourly period's valid time, and source retrieval/issuance metadata as a separate provenance value.

## Replay and science boundaries

For a new built-in record, `buildAuditEvidence` calls the current real `analyze(snapshot, evaluation_context)` and refuses to attribute a version/threshold configuration if its evaluation differs from the stored snapshot. This prevents recording mismatched current-engine evidence. The producer uses a **full** session from Team 4's controller. In the judge afternoon replay, the previous treatment starts at 3 PM Pacific, ends at 3:15 PM, and the 5:15 PM observation contains the post-spray alert; it is reproducible with the stored full session and current version/configuration.

An `imported`, `live`, or unspecified result may have been evaluated by another system. Such a record retains the original snapshot and available context, but `engine_version`, `effective_thresholds`, and diagnostics are explicitly `null`, and `evaluator_kind='external_or_unverified'`. Do **not** claim that the built-in engine evaluated external results unless the caller provides validated provenance under a future explicit adapter contract.

Reproducibility means the engine returned the same evaluation under the stored context; it does not scientifically validate the screening thresholds or make recommendations equivalent to actual product label requirements.

## Backwards-compatible loading

Existing `canopyguard.audit.v1.<id>` storage keys are preserved. The reader returns historical records missing a schema version as `schema_version: 1` and `evidence: null`. Incomplete historical sessions remain unchanged for display and export; the system does not fabricate their treatment timestamps or engine version. Newly written v2 records are validated on read; malformed future-schema records are ineligible. Recoverable corrupt-storage warnings and migration recovery are tracked separately by Issue #16.

## Export coverage (Issue #17)

The PCA CSV uses `frontend/audit-csv.js`, exposed through the existing `auditCSV` API in `frontend/audit.js`. It retains the previous readable/timezone-aware summary columns and now includes event identity/type, record schema version, evaluator kind/version, all raw 5 ft and 30 ft temperature/humidity/wind-speed/cardinal and numeric-bearing readings, separate timestamp roles, and JSON columns for the complete session, snapshot, effective thresholds/profile, evaluation, evaluation context, diagnostics, provenance, timestamps, and full evidence envelope.

Historical v1 rows remain exportable. Missing historical evidence is explicitly represented by `[UNAVAILABLE]`; no engine version, thresholds, or treatment timestamps are reconstructed. The current evaluator has no separate rule-set version beyond its engine version and effective threshold/profile values, so no independent rule version is fabricated.

The CSV serializer uses RFC 4180 quoting, neutralizes formula-like text values, preserves raw numeric precision, and emits a header-only file for an empty result. The UI applies the selected filter before export and exports all matching records even though the visible audit table caps its rendering at 250 rows. Parser-based tests verify JSON evidence round-trips against the stored record, including formula-like text, quotes, commas, newlines, Unicode, empty results, legacy records, and exports larger than 250 rows. See [AUDIT_INTEGRATION.md](AUDIT_INTEGRATION.md) for the detailed CSV field contract.

The printable report remains a human-readable summary and is not a complete machine-readable evidence export. Browser storage is user-modifiable and is not a substitute for signed compliance records.

The application does not sign or independently authenticate stored records. Keep label/regulatory decisions and official records outside this illustrative audit tool.
