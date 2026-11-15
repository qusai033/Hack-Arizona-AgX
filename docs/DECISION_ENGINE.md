# CanopyGuard deterministic screening engine

## Public API

```js
import { evaluate, evaluateSnapshot, analyze, getProfile } from './frontend/engine/index.js';

const input = { ...weatherPayload, pesticide_profile: getProfile('contact_fungicide') };
const evaluation = evaluate(input); // complete evaluation object, synchronously
const snapshot = evaluateSnapshot(input); // complete shared snapshot
const { diagnostics } = analyze(input); // thresholds, both wet-bulb estimates, session result
```

Works in Node.js 20+ and browsers without dependencies, network requests, hidden timers, wall-clock reads, or random values. Input may omit `evaluation`; any previous evaluation is ignored. Calls do not mutate input. Severity is the maximum of triggered rules; ordering and reason text are deterministic. See `frontend/engine/index.d.ts` for TypeScript signatures.

Run `node scripts/evaluate.mjs < input.json` for evaluation JSON, or add `--diagnostics`. `npm run benchmark` measures 10,000 evaluations locally; this is fast synchronous computation, not literally zero latency or a certified real-time guarantee.

## Contract v1.1

The explicitly requested additive field is **`evaluation.caught_hidden_risk`**. Every engine result emits a boolean equal to `single_station_5ft_status === 'GO' && multi_height_status === 'STOP'`, including `false` on invalid input. Updated UI and runtime validator accept it and verify its consistency. Legacy v1 snapshots without it remain accepted. All other shared snapshot keys are unchanged. Teammates using an independent strict v1 schema must add this field before consuming engine output.

Session state, label context, computed thresholds, wet-bulb values, and engine version live in separate context/diagnostics objects, not additional snapshot properties. This prevents accidental changes to the shared weather contract. `analyze` is an explicitly separate diagnostic envelope; do not send that envelope to the snapshot renderer.

Invalid readings, impossible profile limits, invalid context, inconsistent sessions, and freshness failures return a full **STOP** evaluation with `DATA_INVALID` and `caught_hidden_risk: false`. `evaluateSnapshot` throws for a structurally invalid input so a malformed snapshot is not returned. The UI handles that error by removing prior GO/readings. Absent sensors are never filled with zeros or regional forecasts.

## Implemented thresholds

These are the team's configurable **screening policy**, not scientifically validated universal orchard thresholds or a replacement for an actual product label. Boundary comparisons have a 1e-10 tolerance solely for binary floating-point noise, not sensor uncertainty.

| Check | CAUTION | STOP |
| --- | --- | --- |
| Upper minus ground temperature, standard | >0 through 1.0°F | >1.0°F |
| Temperature, HIGH volatility | >0 through 0.2°F | >0.2°F |
| Wind, either height | >8 mph through effective maximum | Below effective minimum or above effective maximum |
| Absolute speed difference | ≥4 mph below applicable STOP threshold | ≥6 mph; FINE droplets: ≥4.5 mph |
| Shortest direction difference | ≥45° unless STOP applies | ≥75° **and** upper wind >4 mph |
| Evaporation, either height | Temperature >85°F **and** RH <25% | No additional STOP assigned solely by this rule |
| Recorded HIGH post-spray treatment | Monitoring information | Within monitoring period and temperature difference >1.0°F |

Very light wind is **STOP**, resolving the prompt's STOP-or-CAUTION choice conservatively. The effective minimum is `max(3, profile.min_wind_mph)`. The effective maximum is `min(10, profile.max_wind_mph)` and also capped at 8 for HIGH volatility. A stricter supplied limit is never relaxed. A minimum above the effective maximum is invalid. Direction calculation uses degrees, shortest arc 0–180°, including wraparound; cardinal text is displayed as supplied and does not drive the calculation. Wind directions are meteorological FROM bearings.

The 5-ft comparator runs exactly the same profile-adjusted **ground-only wind and heat/humidity checks**. It has no access to the canopy reading, gradients, shear, or post-spray inversion alert. It can return CAUTION as well as GO or STOP. No extra ground rules are omitted just to force a hidden-risk result.

## Profiles

| Preset ID | Generic name | Volatility / droplets | Wind maximum | Inversion STOP | Shear STOP | Monitoring |
| --- | --- | --- | --- | --- | --- | --- |
| `contact_fungicide` | Standard Contact Fungicide | LOW / COARSE | 10 mph | >1°F | ≥6 mph | 6 h |
| `volatile_formulation` | Volatile Ester / Volatile Formulation | HIGH / MEDIUM | 8 mph | >0.2°F | ≥6 mph | 12 h |
| `fine_airblast` | Fine-Mist Airblast Insecticide | LOW / FINE | 10 mph | >1°F | ≥4.5 mph | 6 h |
| `dormant_oil` | Dormant Horticultural Oil | LOW / COARSE | 10 mph | >1°F | ≥6 mph | 6 h |

HIGH custom profiles monitor for at least 12 hours; a longer supplied duration is preserved. Other preset durations are demonstration choices. Dormant oil is the least restrictive baseline alongside the coarse contact fungicide; it is not exempt from inversion, wind, or label restrictions. Oil-specific temperature, crop, and tank-mix restrictions are outside this model. An organophosphate or ester is not automatically a high-volatility formulation: actual formulation/product evidence must support classification. No listed preset asserts a crop registration, actual label limit, or product recommendation.

## Scientific interpretation and label overrides

- A positive temperature difference is an inversion signal, including the weak CAUTION band. Calling this band merely “equalizing” or “isothermal” would be misleading. The reading does not prove a future trend without earlier observations.
- A zero or negative difference produces no inversion rule; it does **not** establish vigorous mixing or absence of inversions at other heights. Two sampled levels cannot resolve the complete boundary-layer structure.
- The 0.2°F and 1°F thresholds require calibration, radiation shielding, synchronized observations, sensor uncertainty assessment, and field validation. The engine does not invent a noise allowance or compensate uncalibrated sensors.
- Numerical shear cutoffs are project policy and need orchard validation; they are not claimed as universal regulatory limits. The model has no gusts, nearby receptors, canopy geometry, application pressure, droplet spectrum, or plume transport model.
- `evaluate(input, {labelProhibitsInversion: true})` sets STOP for **any positive gradient**, overriding the weak band. Supply this context when the verified label prohibits inversion spraying; a default CAUTION never grants permission to ignore that prohibition. The current JSON profile cannot represent all label restrictions.
- GO means no modeled rule triggered, not an assurance of safety, legal compliance, mixing, or safe re-entry.

## Wet-bulb depression

`wetBulbDepression(tempF, humidityPct)` implements Stull's empirical equation at standard sea-level pressure. The diagnostic returns dry/wet temperatures and depression in Celsius plus depression in Fahrenheit. This is **dry-bulb minus wet-bulb**, a different quantity from the **30-ft minus 5-ft** inversion gradient. Neither is silently substituted for the other.

To avoid the paper's cold/dry caveat, this implementation deliberately supports only 0–50°C and 5–99% RH for the approximation. At 100% RH it uses the saturated identity Tw=T. It returns unavailable rather than extrapolating outside that range or displaying a nonphysical Tw>T approximation. Elevation/pressure corrections are not modeled. A published UCAR reference point (20°C, 50% RH → 13.69934°C wet bulb) is an independent test oracle. The requested >85°F / <25% evaporation rule still operates when the estimate is unavailable; no extra Delta-T severity bands were invented.

## Before, during, and after spraying

```js
import { createSession, startSpray, finishSpray, evaluate } from './frontend/engine/index.js';

let active_spray_session = createSession(weather.orchard_block, weather.pesticide_profile);
active_spray_session = startSpray(active_spray_session, startISO);
// Re-evaluate every new observation while spraying:
let evaluation = evaluate(weather, {session: active_spray_session});
active_spray_session = finishSpray(active_spray_session, endISO, endObservation);
evaluation = evaluate(laterObservation, {session: active_spray_session});
```

`BEFORE_SPRAY → SPRAYING_IN_PROGRESS → POST_SPRAY_CURING` requires explicit transitions. End time cannot precede start time. An optional end observation must match the end time and block exactly. The original applied profile is copied/frozen, and remains authoritative during spraying and for post-spray monitoring. Switching the dashboard's next-product selection cannot overwrite the treated product. Sessions are block-specific; comparing a treatment to another block or to a timestamp before treatment fails closed.

Elapsed time derives only from the incoming observation timestamp. A HIGH treatment completed 2 hours earlier plus a current +3.8°F inversion produces `POST_SPRAY_VOLATILITY_ALERT` with STOP severity. “Developed since treatment” appears only if an end observation showed ≤1°F; otherwise the alert says the inversion **is present**. The alert describes potential vapor retention, not a measured chemical concentration, and directs the operator to supervisor/worker notification and the label's re-entry restrictions. A weaker/no current inversion is not a safe re-entry determination.

Monitoring covers `0 ≤ elapsed_hours < monitor_hours`; exactly at expiry the specialized alert stops and the message explicitly says expiry is **not clearance**. Ordinary current-weather rules still run. The enum name `POST_SPRAY_CURING` is the requested workflow label, not evidence that a chemical has cured.

This module has no hidden persistence or background scheduler. A caller must persist session records and feed new observations. The dashboard session controls are explicitly **demo-only**, memory-only, and reset on reload; imported/live modes disable them. Production callers attach their persisted session context before returning the evaluated snapshot. Forecast windows screen future applications separately; they do not clear recorded-treatment alerts or re-entry restrictions.

## Freshness and reproducibility

For measured current observations use `evaluate(input, {nowMs: observedNow, maxAgeMs: 300000})`. The explicit clock makes replay and tests reproducible. Stale (>maxAgeMs) or future (>60 seconds) observations fail closed. Without `nowMs`, the core supports historic replays and future forecast evaluation and makes no freshness claim. The dashboard's live adapter separately enforces freshness. Timestamp alignment across the two heights is assumed by the current single-timestamp contract; upstream acquisition must establish that alignment. Limits: [FRESHNESS_POLICY.md](FRESHNESS_POLICY.md).

## Sources and what they support

1. [EPA National Pesticide Applicator Certification Core Manual](https://www.epa.gov/system/files/documents/2022-09/national-pesticide-applicator-cert-core-manual-2014.pdf): inversion-related lateral drift, comparing temperatures at different heights, and formulation-dependent vapor movement after application. It supports the mechanisms, not the project's numerical inversion/shear bands.
2. [University of Minnesota Extension — Avoiding herbicide drift](https://extension.umn.edu/agriculture/crop-production/weed-management/avoiding-herbicide-drift): on-site wind checks, concern below 3 mph, preferable low winds, product-label priority, and inversion drift. These general practices are not a universal orchard product label.
3. [Minnesota Department of Agriculture — Herbicide Drift Management](https://www.mda.state.mn.us/sites/default/files/docs/2020-05/herbdriftmgmt.pdf): screening guidance around 3–10 mph and greater droplet evaporation in hot, dry conditions. The exact >85°F and <25% pairing is this project's rule, not asserted as a universal threshold from that source.
4. [Stull (2011), Wet-Bulb Temperature from Relative Humidity and Air Temperature](https://doi.org/10.1175/JAMC-D-11-0143.1), and [UCAR implementation/reference example](https://www.ncl.ucar.edu/Document/Functions/Contributed/wetbulb_stull.shtml): the approximate wet-bulb calculation and its domain limits.
5. [EPA — Restrictions to Protect Workers After Pesticide Applications](https://www.epa.gov/pesticide-worker-safety/restrictions-protect-workers-after-pesticide-applications): re-entry intervals depend on product labeling and use. A CanopyGuard monitoring duration is not an REI.

Reviewed November 15, 2026. Consult current actual labels and applicable local requirements before any field deployment.
