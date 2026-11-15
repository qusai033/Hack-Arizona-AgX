# Specification findings — 2026-11-15

Evaluated application: merged PR #34 at `13828e8337e2bfc8265c107330709be9307daa7c`.
Committed harness: `f35dc531d2a9e818a1b4f5b68db82942e8a69c74`, clean working tree.
Run completed at `2026-11-15T22:10:33.036Z`, using Node `v26.13.0` and Chromium.
The source handoff, its fingerprint, mappings, and coverage limits are documented
in [SPEC_EVALUATION.md](SPEC_EVALUATION.md).

## Results

| Check | Result |
| --- | --- |
| Production build | Passed |
| Existing Node suite | 117 passed |
| Existing browser regressions | 9 passed |
| Additional handoff/policy checks | 18 passed, 29 failed |
| Combined browser evaluation | 27 passed, 29 failed; no skipped or flaky tests |

`npm run test:spec` exits 1 because assertions expose mismatches. These are not
29 independent bugs: some share a cause, and some represent documented product
choices requiring a specification decision. No application behavior was changed
in this evaluation. Reproduce the report with `npm run test:spec`, then open it
with `npm run report:spec`.

## Gaps requiring reconciliation

| Area / test IDs | Observed difference |
| --- | --- |
| Scenario catalog — `SPEC-SCENARIO` | Excessive upper wind, threshold boundary, and missing/stale sensor scenarios are absent. Trap and favorable-mixing equivalents have different initial direction/temperature/humidity values. All five currently shipped scenarios do run offline and advance through eight frames. |
| Missing sensor — `SPEC-RESULT`, `SPEC-MISSING-CONTROL` | A missing canopy temperature correctly yields overall STOP and no hidden-risk credit, but also changes the valid ground-only baseline to STOP; the handoff expects ground GO. There is no “Simulate Missing Sensor” UI control. |
| Profiles — `SPEC-CONFIG` | All three mapped profiles differ numerically. Standard: wind caution above 8 instead of 8.5 mph; monitor 6 instead of 2 hours. High-volatility: shear STOP 6 instead of 5 mph, direction STOP 75 instead of 60 degrees, monitor 12 instead of 6 hours, and wind-caution cutoff differs. Fine-mist: wind bounds, inversion limit, direction limit, volatility classification, and monitoring period differ. |
| Boundaries — `SPEC-BOUNDARY` | Canopy wind at 8.5 mph produces CAUTION instead of GO. A 75-degree direction difference at 3 mph produces CAUTION instead of STOP. Directional warnings also appear below the specified minimum wind speed. |
| Rule membership/order — `SPEC-RESULT`, `SPEC-ORDER` | Excessive-upper-wind inputs add a speed-shear CAUTION absent from the handoff table. The boundary scenario has the correct rule membership/severities, but STOP is not listed before CAUTION. |
| Post-spray — `SPEC-POST-SPRAY` | A high-volatility treatment under a +0.1°F gradient lacks the post-spray STOP required by the handoff; only inversion CAUTION is present. |
| Data/threshold disclosure — `SPEC-PROVENANCE`, `SPEC-DATA`, `SPEC-BADGES` | Rules lack the prescribed provenance, source-height, and cross-height-hazard fields. Structured data-quality status and the required decision quality/version badges are absent. |
| Product wording — `SPEC-COPY`, `SPEC-PROFILE-LABELS`, `SPEC-DISCLOSURE` | GO says “SAFE TO SPRAY NOW” instead of “GO — configured weather checks passed”. The log/export UI uses audit/compliance language instead of “Activity & Decision Log”. Profiles lack “Illustrative” labels. The exact disclaimer and explicit list of unobservable ground-only checks are missing. |
| Evaluation evidence — `SPEC-EVALUATION-TIME` | `evidence.times.evaluated_at` is null, rather than the explicit evaluation timestamp required by the handoff. Recording and observation timestamps are retained separately. |
| Observation future tolerance — `SPEC-FRESHNESS` | An observation six seconds ahead is accepted; the handoff allows only five seconds. Age 300 seconds passes and age 301 seconds stops as specified. |

## Documented policy differences

These still appear as strict-audit failures rather than being silently waived:

- `SPEC-PLAYBACK`: 25 ticks in one real second for the trap scenario, versus the
  handoff's one tick per second. Each actual tick still adds one simulated minute.
- `SPEC-FORECAST-AGE`: the implementation's documented issuance tolerance is six
  hours old/five minutes ahead. The handoff specifies two hours/five seconds.
  The existing stale-issuance regression passes; freshness validation exists.

The previously agreed native-JS migration, explicit demo URL, six-city production
forecast view, 06:45 PST initial clock, and reset scoped to the current demo run
are documented adaptations, not failures in this count.

## Working behaviors demonstrated

- The combined canopy card, slider updates, sensor selection, Step, Reset Demo,
  animation controls, judge walkthrough, and responsive layout pass.
- Canonical trap, favorable-mixing, and combined-boundary inputs produce the
  expected ground/multi-height decisions and rule membership through the real engine.
- Ground wind 3.0/2.9 mph, canopy wind 8.6 mph, inversion +1.0/+1.1°F,
  five-minute staleness, deterministic evaluation, and 355°→10° circular math pass.
- Scenario changes preserve history, clear overrides, reset the frame, and advance
  the independent clock by 60 seconds. Pause freezes time during extended inspection.
- Identical-result profile changes and manual records retain distinct IDs;
  redelivery is idempotent. Full v2 evidence survives reload and CSV export.
- Storage failure recovery, alert dismissal/recurrence, scoped reset, all six
  forecast cities, initial NWS load, 30-second refresh, and obsolete-response rejection pass.

## Recommended follow-up grouping

1. UI/disclosures: reconcile GO/log wording, illustrative labels, required disclosures,
   missing-sensor controls, and data-quality/version/provenance presentation.
2. Scenario/evaluator: restore the canonical fixtures or approve replacements; decide
   profile thresholds, boundary guards, and post-spray behavior together.
3. Integration/evidence: capture explicit evaluation time; choose and document
   playback rate and observation/forecast freshness tolerances.

Full assertion differences, exact inputs/results, screenshots, and traces are in
the generated report. This result is not agronomic validation, a full accessibility
audit, or evidence of regulatory compliance.
