# Issue #45 — Per-height input quality, rule provenance and hidden-risk integrity

## Scope and safety boundaries

The built-in evaluator remains **an illustrative pesticide-drift screening prototype**, not a registered-label decision tool, on-site measurement system, regulatory certification, or scientifically validated agronomic forecast. This change does **not** revise numerical thresholds (#44) or the agreed timestamp freshness policy (#47). Weather-feed data quality from #35 is separate from **decision-input** validation in this module.

## New result contract

`frontend/engine/quality.js` exports pure `assessDataQuality(input,context)`. It uses the exact same per-reading field validator (`assertReading`) as the shared snapshot contract, but checks **ground_5ft** and **canopy_30ft** independently. The evaluator returns the result under:

```json
{
  "data_quality": {
    "overall_status": "VALID",
    "assessment": "STRUCTURE_AND_AGE",
    "age_ms": 0,
    "evaluated_at": "2026-11-15T20:00:00.000Z",
    "issues": [],
    "ground_5ft": {"status": "VALID", "age_ms": 0, "issues": []},
    "canopy_30ft": {"status": "VALID", "age_ms": 0, "issues": []}
  }
}
```

`overall_status` is either `VALID` or `INVALID_OR_STALE`. Each height is `VALID`, `INVALID`, `STALE`, or `FUTURE`. The quality `issues` arrays contain input/freshness error details. The **same original snapshot timestamp** applies to both heights because the present CanopySnapshot contract has one common observation timestamp; per-height independent **timestamps are not available**, so they must never be invented. Both `age_ms` values are null when no **explicit** `context.nowMs` is supplied.

`context.nowMs` is the optional *observation freshness clock*. `context.evaluationTimeMs` is the independently captured *evaluation boundary clock* (Issue #46); it populates `evaluated_at` but **does not** cause future-valid hourly NWS model periods to fail observation freshness. When no freshness clock exists, `assessment='STRUCTURE_ONLY'` and the UI explicitly says **Freshness not assessed**. Even a `VALID` result means only that supplied inputs passed structural and, where applicable, timestamp checks; it **does not verify accuracy, sensors, weather source freshness, orchard-height measurements, or safe spraying**.

## Independent ground comparator and fail-closed integrity

When the canopy sample is missing/out of contract but the ground reading, pesticide profile and context remain valid, the engine evaluates the valid ground wind/evaporation checks **without fabricating a canopy value**. It can therefore return **ground GO, overall STOP, caught_hidden_risk false**, with `DATA_INVALID` identifying the affected 30 ft input. Invalid ground readings, stale/future data and invalid application context are fail-closed; they do not receive hidden-risk credit. `evaluateSnapshot` still requires fully valid input (and refuses invalid inputs), preventing partial readings from reaching existing numeric-only visualization, timeline, storage, and audit paths. The separate missing-sensor simulation UI belongs to #43.

## Rules and provenance

Every new built-in triggered rule includes:
- `provenance: 'ILLUSTRATIVE_THRESHOLD'` for numerical screening rules, or `SAFETY_FAILSAFE` for integrity failures;
- `source_heights: [5]`, `[30]`, or `[5,30]` describing which weather levels the actual rule examines (the integrity rule identifies which layer failed; a context-only error can have an empty list);
- `is_upper_or_cross_height_hazard` indicating a **real** upper-height or cross-height numerical STOP/Caution rule, **never** a data-integrity error.

Ground wind/evaporation uses [5]; upper wind/evaporation uses [30]; inversion, shear, and post-spray inversion alert use [5,30]. These labels describe **the rule's data dependencies and illustrative policy**, not the provenance/field accuracy of the underlying environmental measurements. Physical explanations stay in the existing `metric` and `explanation` fields. The engine now orders triggered rules by severity (STOP before CAUTION), preserving relative order within the same severity.

`caught_hidden_risk` is true only when **both** heights pass input/age checks, the ground-only result is GO, the multi-height result is STOP, and at least one STOP rule explicitly depends on upper/cross-height data. Data-integrity STOP and ground-only STOP never earn hidden-risk credit. This replaces the prior misleading shortcut of checking only the two statuses.

## UI and audit behavior

The dashboard shows the actual `ENGINE_VERSION` (currently 1.1.0), actual per-height status and the actual provenance on triggered rules **only for CanopyGuard's own demo and forecast evaluators**. For forecast, it continues to label upper/lower data **MODELED**, not measured. A per-height `VALID` badge must be read with the **STRUCTURE_ONLY** / **Freshness not assessed** label where appropriate. Imported/live external results are displayed as **unverified** rather than receiving fabricated engine, sensor-quality, or rule-provenance badges. Unavailable/rejected data clears previously displayed badges.

The shared snapshot validator accepts the new metadata but also retains support for old valid snapshots without metadata. `frontend/audit-validation.js` checks the new embedded quality against the actual evaluator diagnostics and the explicit evaluation clock, when present; old v1/v2 evidence remains readable unchanged. The CSV still exports the complete original snapshot, evaluation and diagnostics JSON without changing header names or deleting historical records. The engine version change documents that decision output/evidence metadata and hidden-risk attribution have changed.

## Verification

- `npm test`: permanent per-height, invalid/aged, rule source, stable STOP ordering, hidden-risk, quality-contract, legacy, and v2-audit tests in `tests/quality-provenance.test.mjs`.
- `npm run build && npm run test:e2e`: dashboard tests for `SPEC-BADGES` in demo, forecast modeled, imported/unverified, and invalid-input views.
- `npm run test:spec -- --grep 'SPEC-PROVENANCE|SPEC-DATA|SPEC-ORDER|SPEC-RESULT|SPEC-BADGES'`: independent handoff checks. Some exact numeric scenarios may still fail due to **Issue #44**, and missing-sensor simulator controls belong to **Issue #43**; do not rewrite the canonical spec to disguise those differences.

All weather-data and pesticide-label limitations remain applicable.
