# Team 4 lifecycle ports — 2026-11-15

This implements #15, #16, and #18 on the controller from #23 and the versioned
audit evidence contract from #26 (#9). The decision engine is unchanged.

## Alerts (#15)

`alert-state.js` owns notification state independently from audit rows. Its
signature includes overall severity, sorted unique rule code/severity pairs,
and treatment state. Source, orchard block, and demo run identify the context.
Changing metric text or rule order does not repeat an alert.

Every distinct event still produces an audit row. Closing a preview marks its
condition dismissed; unchanged observations stay silent. GO clears that context
so recurrence can notify. A different rule set or severity can notify immediately.
Different orchards and sources do not suppress each other.

Judge step 2 deliberately forces one preview for its own new event; redelivering
that event cannot force another. Test Alert records its own event and opens a
modal without changing normal suppression. Cards carry `data-event-id`; optional
live-source dispatcher payloads carry matching `event_id` and `log_id`.

## Storage recovery (#16)

`audit-storage.js` retains per-record `canopyguard.audit.v1.` keys. This historical
key prefix is independent of the new v2 evidence envelope from `audit-record.js`.
`audit.js` re-exports `createAuditLog` for existing callers. `audit-validation.js`
checks complete v2 identity, snapshot, session, evaluation context, effective
profile/thresholds, diagnostics, provenance, and timestamp roles before display.

Historical results are not recomputed using current rules. Known v1 records
retain `evidence: null`. Original abbreviated state/profile-only treatments are
readable with a missing-context warning; treatment times are never fabricated.
Unsupported versions and malformed records remain untouched on disk while other
valid activity stays usable, including in table and print views.

`log.read()` returns `{records, persistent, unsaved_count, issues}`. `log.write()`
returns `{record, duplicate, saved, persistent, unsaved_count, issues}`.
`log.status()` exposes persistence status. Existing `append`, `list`, `get`, and
`isPersistent` methods remain convenience APIs. Issue codes distinguish absent
storage, read errors, malformed/incompatible records, missing legacy context,
quota/write failure, and failed demo removal.

Warnings immediately prompt export. Unsaved rows survive later reads, and
already restored rows remain in memory if storage subsequently becomes unreadable.
Cross-tab additions/deletions remain visible. A damaged key cannot be overwritten
by a colliding event ID. CSV download includes unsaved activity and its complete
available v2 evidence using the serializer merged in #28 (#17). This port adds
the demo run ID to that export. Print remains a readable summary. Closing a tab
cannot recover activity that the browser refused to save.

## Reset and Step (#18)

Entering explicit demo mode assigns `demo_run_id` from the initial event ID.
Judge replay shares that run's ownership while retaining its separate clock.
Reloading or entering from another source starts a new run and preserves history.

Reset stops playback, invalidates queued timer callbacks, cancels forecast work,
exits judge mode, and restores the trap scenario, contact fungicide profile,
fixed initial clock, empty overrides, and no treatment. It clears only records
with both `source: 'demo'` and the current `demo_run_id`, then records exactly one
`DEMO_INIT` under the reset action's ID. That initial condition is silent so reset
does not recreate a dismissed preview. GO or a different hazard can notify later.

Other demo runs, unowned historical demos, live/imported/forecast records, and
unrelated browser keys survive. There is no general Clear Log control or
`localStorage.clear()`. Failed deletion is disclosed because old demo activity
may return after reload. Processed IDs remain protected after reset, including
old actions whose visible activity was removed.

Paused Step adds exactly one frame, 60 seconds, and one `SIMULATION_STEP` event.
It is disabled during playback and at the final frame. `playback.js` owns one
timer and ignores older timer generations. Normal scenario changes retain the
monotonic clock/history policy. Production/imported modes cannot reset or step.

## Verification

`npm test` covers alert recurrence, stable signatures, storage recovery, full v2
validation/reload, reset ownership/idempotency, and injected-scheduler timer
cancellation. `/__qa` covers their browser wiring, reset during playback, judge
and test previews, malformed session recovery, and quota warnings. The portable
automated browser runner remains #19's responsibility.
