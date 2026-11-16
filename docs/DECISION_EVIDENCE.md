# CanopyGuard — evidence behind GO / CAUTION / STOP
**Decision-methodology and source traceability, reviewed November 15, 2026**

> **Scope:** Decision-support prototype. This is a weather-risk **screening rule engine**, not a field-validated pesticide-drift transport model, certified crop protection advisor, product-label compliance checker, or authorization to apply. The terms GO/CAUTION/STOP are **project screening statuses**, not legal application decisions.

## What our engine actually does

1. The app receives a time-stamped snapshot of **temperature, humidity, wind speed and meteorological wind-FROM direction** at **5 ft and 30 ft** plus an explicitly selected illustrative pesticide profile.
2. The evaluator independently checks the two height inputs and optional **explicit** observation freshness (`context.nowMs`). Invalid/stale information forces overall **STOP** with `SAFETY_FAILSAFE`, not a fabricated atmospheric risk detection. Valid ground-only input can still show its separate ground assessment when 30 ft is missing.
3. The engine derives:
   - Temperature gradient: `ΔT = T(30 ft) − T(5 ft)`. Positive means 30 ft is warmer: possible stable/inversion layer. It does **not** prove the full depth or duration of an inversion.
   - Wind-speed shear: `|v(30 ft) − v(5 ft)|` mph.
   - Wind-direction shift: the **shortest** bearing difference, `|((dir30 − dir5 + 540) % 360) − 180|` degrees. Neither direction establishes a downstream receptor unless its geographic location is supplied.
   - Hot/dry condition per height, and (for recorded simulated sessions only) a time-limited post-treatment alert.
4. Each active rule returns a **code**, **severity** (`CAUTION` or `STOP`), **actual measurement/metric**, **plain-language explanation**, **source heights**, and **`ILLUSTRATIVE_THRESHOLD`** provenance. Data-integrity failure instead returns **`SAFETY_FAILSAFE`**. This is the *policy origin*, not a claim of field-calibrated sensor accuracy or scientific validation of the numerical cutoff.
5. The final result is the **maximum rule severity**: `STOP > CAUTION > GO`. A GO means *none of the selected project screening rules triggered*, **not** that the real pesticide label, nozzle, weather, gusts, buffer distances or application site is safe or compliant.
6. The separate 5 ft comparator deliberately ignores upper-height hazards. `caught_hidden_risk` is only true when data at **both heights is valid**, ground-only is GO, overall is STOP, and a genuine upper or cross-height STOP exists. A missing sensor is never credited as “drift caught.”
7. Each new built-in audit record already stores a reproducible snapshot, actual triggered rules, effective thresholds, evaluation time, evaluator version and source-provenance context. The explanation is derived from **that actual same evaluation**, not from a separate decision engine.

### Actual project thresholds (illustrative, not legal limits)

| Check | Current rule behavior | Scientific basis vs. our extra assumption |
| --- | --- | --- |
| Wind at both heights | Below configured `minWind` or above `maxWind` → STOP; above `windCautionAbove` (if not STOP) → CAUTION | Wind speed, variable calm air and receptor direction matter. General guidance commonly discusses ~3–10 mph but **actual labels vary**. Selected profile sets our specific limits. |
| Inversion gradient | `ΔT > 0°F` → CAUTION; `ΔT > inversionStopAbove` → STOP (or any positive gradient with *verified* label-prohibition context) | EPA describes inversion trapping and lateral transport, but **no scientific source cited here validates our exact +0.2°F or +1.0°F STOP thresholds** at these sensor heights. |
| Vertical speed shear | `abs(Δspeed) >= 4 mph` → CAUTION; `>= 4.5 mph` for fine mist or `>= 6 mph` otherwise → STOP | Vertical differences matter to the blind-spot demo. These precise cutoffs are **engineering demo assumptions** pending orchard-specific field validation. |
| Directional shear | `>= 45°` → CAUTION; `>= 75°` **and** upper wind `> 4 mph` → STOP | Wind direction relative to sensitive areas matters, but the 45° and 75° *between-height* thresholds are **not published legal limits or validated plume predictions**. |
| Evaporation risk | At either height `temp > 85°F AND RH < 25%` → CAUTION | Hot/dry air favors droplet evaporation. The precise paired cutoff **is not a universal peer-reviewed risk boundary**. |
| Post-treatment monitoring | A recorded high-volatility demo treatment may trigger STOP on a configured positive inversion during the monitoring period | EPA explains some volatile substances may drift after application. The 6/12-hour configurable prototype watch windows are **not** product re-entry intervals, residue measurements, or guarantees of safe re-entry. |
| Input quality | Missing/invalid, or stale/future observations relative to an explicitly supplied clock → overall STOP | This is a conservative **software integrity policy**; not evidence that drift was actually measured. |

Consult `frontend/engine/profiles.js` for the effective limits actually enforced. Profile names are **generic illustrative presets**, not registered pesticide product labels. The UI uses `thresholdsFor(snapshot.pesticide_profile)` at render time and only for the trusted built-in demo/forecast evaluator. For imported/live external evaluations, our site **does not guess** the evaluator's thresholds or provide a falsified rule-version attribution.

### Research sources: what they establish (and what they do not)

| Reference | Relevant findings/guidance | NOT substantiated by the source |
| --- | --- | --- |
| [EPA — National Pesticide Applicator Certification Core Manual](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P1017DIK.TXT) | A temperature inversion is a warmer layer above cooler surface air. Reduced mixing can leave fine droplets suspended, with lateral transport. Two-height temperature readings can help recognize inversions; some pesticides produce vapor drift after application. | Not a validation of CanopyGuard’s inversion STOP delta, shear cutoffs, or 30-ft sensor placement for all orchards. |
| [EPA — Improving Labels to Reduce Pesticide Drift](https://www.epa.gov/reducing-pesticide-drift/improving-labels-reduce-pesticide-drift) | Real labels can require specific wind, nozzle droplet category, release-height and buffer-zone restrictions. | There is no universal EPA authorization encoded by CanopyGuard GO. |
| [University of Nebraska–Lincoln Extension — Spray Drift of Pesticides](https://extensionpubs.unl.edu/publication/g1773/2019/html/view) | Drift responds to wind, droplet diameter, inversions, temperature and humidity; product labels can have differing limits. Its droplet-distance table illustrates the physics of smaller droplets traveling farther at fixed wind conditions. | That table does not predict real pesticide deposition, orchard plume transport, or numerical wind-shear safety thresholds for this app. |
| [UF/IFAS — Managing Pesticide Drift](https://ask.ifas.ufl.edu/publication/PI232) | Discusses commonly preferable 3–10 mph winds, calm/inversion hazards, and greater evaporation when conditions are hot and dry. | The reference is general best-practice discussion, **not** a universal legal 3–10 mph or 85°F/25% restriction. |
| [University of Minnesota Extension — Avoiding Herbicide Drift](https://extension.umn.edu/agriculture/crop-production/weed-management/avoiding-herbicide-drift) | Check real wind speed/direction throughout application, inversions, sensitive downwind areas, and the relevant pesticide label. | These findings do not independently validate CanopyGuard’s between-height direction-shift cutoff or infer where sensitive receptors are. |

## A reproducible judge example

The illustrative “hidden inversion” scenario can show approximately **5 ft: 64°F, 4.8 mph; 30 ft: 68.5°F, 12.4 mph**, with wind bearings **355°** and **85°**. The 5 ft-only check may show **GO**. The two-height screen identifies a **+4.5°F gradient**, **7.6 mph speed difference**, **90° wind-direction change**, and upper wind above the illustrative profile limit. Its **STOP** result is explainable by actual triggered rules, not a black-box classification.

These values come from **simulated scenario inputs**, not a measured field incident. The research supports why these *patterns* merit attention, not that the precise project thresholds have been prospectively validated.

## What is still required before an actual field decision

Read the exact product label and applicable state/local requirements; use calibrated, synchronized and suitably sited sensors at meaningful sampling heights; verify gusts, spray equipment and droplet category; examine downwind neighbors, crops, beehives, waterways and required buffers; and validate the classifier against actual drift and agronomic outcomes across orchards. None of those approvals are automatically established by the current weather-only model.

### Verification and ownership

- Source links are stable official-agency and university-extension references and are displayed beside the corresponding weather checks.
- Unit tests in `tests/decision-explanation.test.mjs` check GO/CAUTION/STOP with actual evaluator outputs, selected profile limits, safe encoding of imported text, and evidence caveats.
- Browser checks verify the explainer updates with scenarios and does not retain a stale decision when the forecast is unavailable.
- Changes to actual numerical limits require a separate documented policy decision with data and tests. A source supporting a **hazard mechanism** must never be presented as quantitative validation of a hand-picked cutoff.
