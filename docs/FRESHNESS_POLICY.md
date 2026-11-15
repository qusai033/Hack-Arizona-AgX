# Freshness policy (issue #47)

**Decision (2026-11-15): keep the implemented limits.** CanopyGuard does not adopt the handoff's tighter values (two hours / five seconds). This document records them as an **approved deviation** from the handoff. The decision was proposed in PR #54 and approved by the owner of issue #47 through review and merge of the pull request that added this document; it is not a new engineering validation of the numbers. All application limits live in one file, `frontend/freshness-policy.js`, and every check reads from it.

## Limits

| What is checked | Time compared | Too old after | Too far ahead after | Handoff | Status |
|---|---|---|---|---|---|
| Current sensor observation (live adapter, connected snapshot, `evaluate()` with `nowMs`) | `snapshot.timestamp` vs evaluation clock | 5 minutes | 60 seconds | 5 min / 5 s | Age matches; future skew is an approved deviation |
| NWS forecast issuance (fresh response, cached response, model already on screen) | `updateTime` → `generatedAt` → `updated` vs request clock | 6 hours | 5 minutes | 2 h / 5 s | Approved deviation |
| Cached NWS response (per city) | `fetched_at` vs request clock | 6 hours* | never (any future retrieval time is rejected) | n/a | Unchanged |

\* In practice a cached forecast stops being reused about **4 hours** after retrieval. The cache keeps 24 hourly periods and is only reused while at least 20 of them are still ahead. The original issuance is rechecked on every read, so whichever limit is reached first applies.

Not part of this decision: the AZMET station check (`frontend/azmet.js`, 45 minutes / 5 minutes; #35, PR #41) and the weather data-quality report (`frontend/weather-data-quality.js`, configurable). Both are feed-level checks owned by #35 / PR #40. Neither changes a spray decision.

## Rationale

- **Observation age, 5 minutes.** This matches the handoff. It is a UI default (an adapter may set a shorter `maxAgeMs`), not a validated sampling requirement.
- **Observation future skew, 60 seconds.** Field stations and browsers commonly drift by several seconds. A 5-second tolerance would make a correctly working station show DATA UNAVAILABLE from clock drift alone. The skew check exists to catch wrong clocks (minutes or hours off), and anything beyond 60 seconds still fails closed.
- **Forecast issuance, 6 hours old.** NWS gridpoint forecasts are typically updated several times a day, but the update interval is **not guaranteed**. These values are project policy and do not assume an NWS publication schedule. With a 2-hour limit, a normal gap between NWS updates would empty the forecast panel. Six hours keeps it available, and an older issue still fails closed, even when the forecast's periods are still in the future.
- **Forecast issuance, 5 minutes ahead.** This tolerates server/client clock differences without accepting a timestamp that is clearly wrong.
- **Retained, not re-decided.** These are the values implemented in PR #24 for #8, with regression tests. Keeping them changes no limit. One behavior does change: an observation whose timestamp is missing or unparseable is now rejected by `assertFresh` instead of being treated as fresh, so that case fails closed.

## The four times stay separate

| Time | Field | Used for |
|---|---|---|
| Issuance | `issued_at` (+ `issuance_source`) | The 6 h / 5 min issuance check |
| Valid time | `snapshots[].timestamp` (each hourly period) | Which period is shown; never used for freshness |
| Retrieval | `fetched_at` | Cache eligibility; a cache read never renews it or the issuance time |
| Evaluation clock | explicit `nowMs` (`Date.now()` in the app) | The reference all ages are measured against |

## Where the limits are applied

- **Fresh NWS response:** `validateForecastIssuance` in `loadOrchardForecast`.
- **Cached NWS response:** the same function rechecks the *original* issuance on every read, and the cache is keyed per city (`canopyguard-nws-v1-<city>`).
- **Model already on screen** after a failed refresh: `app.js` keeps it, labelled *PREVIOUS NWS MODEL (REFRESH FAILED)*, only while `validateForecastIssuance` still accepts it. After that the decision becomes DATA UNAVAILABLE. This check previously used its own copy of the numbers.
- **Live observations:** `assertFresh` on connect, on every refresh, and on the 1-second watchdog.
- **Evaluator:** `evaluate()` / `evaluateSnapshot()` with an explicit `nowMs`.
- **Imported JSON snapshots** are historical files. They are labelled as imported and are not checked against the current clock.
- **Missing or invalid timestamps** always fail closed. They are never treated as fresh, and an invalid NWS primary field is not silently replaced by a secondary one.
- **Visible messages** state the limit, for example "NWS forecast issuance is too old (older than 6 hours)" and "Sensor readings are stale (older than 5 minutes)". The text is generated from the policy values.

The 30-second production refresh, the city list, and production's refusal to show synthetic values are unchanged.

## Tests

- `tests/freshness-policy.test.mjs` covers exact boundaries for every limit (at the limit passes, 1 ms past fails), stale issuance with future-valid periods, cache rechecks and coverage, missing and invalid timestamps, city isolation, and deterministic supplied clocks.
- `tests/e2e/dashboard.spec.mjs` covers *a displayed NWS model is kept after a failed refresh only until its issuance passes the 6-hour limit*.

### Specification harness (PR #37)

Under this decision, three handoff cases intentionally disagree with the application. They were not skipped or marked as expected failures; each was replaced in `tests/spec/` by the approved boundary, with a comment citing this document:

| Spec check | Handoff case and expectation | Application behavior | Case now asserted |
|---|---|---|---|
| `SPEC-FORECAST-AGE` | issuance 7,201 s old → rejected | accepted (limit 6 h) | issuance just over 6 h old → rejected |
| `SPEC-FORECAST-AGE` | issuance 7 s ahead → rejected | accepted (limit 5 min) | issuance just over 5 min ahead → rejected |
| `SPEC-FRESHNESS` | observation 6 s ahead → STOP | GO (limit 60 s) | 60 s ahead → GO, 61 s ahead → STOP |

`SPEC-FRESHNESS` 300 s → GO, 301 s → STOP and 5 s ahead → GO, and `SPEC-FORECAST-REFRESH`, are unchanged. The dated audit in `SPEC_FINDINGS_2026-11-15.md` is a historical record and still lists the original mismatches.
