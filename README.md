# CanopyGuard — Applicator Dashboard & Decision Engine

Teammates 2 and 3's deterministic drift-risk engine and responsive frontend for Hack Arizona AgX. Framework-free HTML, CSS, SVG, and native JavaScript modules; no package installation or external assets required.

## Run

Requires Node.js 20+. No package installation is needed.

```sh
npm test
npm run build
npm run dev
```

Open `http://localhost:5173`. Serve over HTTP; do not open `index.html` as a `file://` URL. To deploy to any static host, publish `dist/` after `npm run build`. The app works at a subpath because asset URLs are relative.

## Included

- Large GO / CAUTION / STOP decision banner, rule cards, and regulatory disclaimer.
- Single-station versus multi-height comparison, using the supplied evaluation.
- Responsive orchard SVG with thermal cap, trapped/rising droplets, two height markers, and wind compasses. Wind direction is meteorological **FROM**; arrows point **TO** the opposite bearing. Arrow length scales with speed and saturates at the display limit. The animation is illustrative, not a trajectory or dispersion model.
- Sensor inspector, pause control, reduced-motion support, keyboard controls, and non-color status indicators.
- Explicit simulated demo scenarios, pesticide-volatility/nozzle selectors, and JSON snapshot import.
- 24-hour demo forecast with a derived GO-window callout, selectable periods, and per-period reasons.
- Strict runtime contract validation and TypeScript interfaces.
- Live adapter hooks with stale/missing/invalid data handling, profile evaluation pending/error states, and obsolete async-result rejection.

The default landing state is **NWS-based modeled forecast screening**, not a live orchard sensor or an on-site spray clearance. Enter `?mode=demo` (or click **Try interactive demo**) for explicitly simulated observations and treatment actions. `frontend/demo.js` and the NWS forecast adapter both use the shared synchronous engine in `frontend/engine/`. Generic profiles are not verified product labels or scientifically validated field recommendations. A coarse nozzle or low-volatility selection never overrides atmospheric hazards exceeding the profile limits. Real sensor integrations must use an explicit live adapter.

See [docs/FRONTEND_INTEGRATION.md](docs/FRONTEND_INTEGRATION.md) for connecting team modules. The shared snapshot shape is in [frontend/types.d.ts](frontend/types.d.ts); runtime checks are in [frontend/contract.js](frontend/contract.js).

For browser adapter checks and 390px/768px layout previews, open `/__qa` on the development server and select **Run adapter checks**. The QA page is outside `frontend/` and is not included in the production build.


## Browser regression tests

The application build and Node test suite remain framework-free. The optional browser suite adds Playwright as a development dependency only.

Install dependencies and the Chromium browser once:

    npm ci
    npx playwright install chromium

Run the production-build browser suite:

    npm run test:e2e

This command builds the dashboard into dist/, starts an isolated local server for that build, runs Playwright, and stops the server after the suite. The existing /__qa adapter checks are also run as part of the suite. See [docs/BROWSER_TESTING.md](docs/BROWSER_TESTING.md) for the test matrix, network fixtures, and failure diagnostics.


Team 4's controller and event recording are integrated into this application.
The [lifecycle ports](docs/TEAM4_LIFECYCLE.md) add alert dismissal/recurrence,
visible storage recovery, and demo-scoped Reset/Step controls using v2 evidence.
Scenario changes advance simulation time without rewinding manual treatments,
profile changes and manual snapshots retain distinct event IDs, and clock changes
refresh forecast windows. See [docs/TEAM4_CONTROLLER.md](docs/TEAM4_CONTROLLER.md)
for the shared event boundary and judge-replay behavior.

## Original-spec evaluation

The final canonical handoff has a separate Playwright acceptance audit. It builds
and loads the actual dashboard, runs the existing browser regressions, and compares
scenario inputs/results, numeric boundaries, disclosures, clock/logging behavior,
and forecast freshness against independently transcribed expectations.

```sh
npm run test:spec
npm run report:spec
```

Unmet requirements produce a nonzero exit and a report; they are not marked as
expected failures. Run the report command even when the evaluation fails.
See [docs/SPEC_EVALUATION.md](docs/SPEC_EVALUATION.md) for requirements mapping,
later project decisions, and coverage limits. `npm run test:spec:ui` opens the
interactive test runner. The GitHub **Specification evaluation** workflow can also
be run manually and retains its report on failure.

## Decision engine

```js
import { evaluate, getProfile } from './frontend/engine/index.js';
const evaluation = evaluate({ ...weatherPayload, pesticide_profile: getProfile('contact_fungicide') });
```

The engine evaluates both heights, inversion and shear, evaporation, four presets, and recorded spray sessions. It always returns `evaluation.caught_hidden_risk` (contract v1.1; legacy v1 imports still work). `evaluate` returns STOP for invalid input. It is synchronous and makes no network requests.

See [docs/DECISION_ENGINE.md](docs/DECISION_ENGINE.md) for thresholds, science sources, limitations, label overrides, API examples, session persistence responsibilities, and wet-bulb calculations. Run `npm run benchmark` for local timings. The default site demo now uses this engine, not separate UI-only risk rules.

Observation and forecast freshness limits (5 minutes / 60 seconds for sensors, 6 hours / 5 minutes for NWS issuance) and the approved deviation from the handoff are in [docs/FRESHNESS_POLICY.md](docs/FRESHNESS_POLICY.md).

## Production NWS view and explicit simulation (November 2026)

The normal application entry point now starts in **forecast screening mode**, selecting Fresno, CA by default and requesting regional NWS hourly forecasts. It refreshes every 30 seconds and exposes the location selector even when the simulator is hidden. Supported California city IDs: `fresno`, `modesto`, `merced`, `bakersfield`, `chico`, and `yuba_city`. Both the weather model and selected city use `America/Los_Angeles` for display; city coordinates are approximate city centers, not verified orchard sensors.

**Important:** The 5 ft and 30 ft values shown in the forecast view are *estimates from an NWS regional forecast*, not measurements. The GO/CAUTION/STOP values there are **modeled forecast screening**, never on-site clearance. When the weather service and valid selected-city cache are both unavailable, the production screen displays **DATA UNAVAILABLE — DO NOT SPRAY** rather than substituting synthetic data. Recent cached NWS forecasts are labeled as cached, and cached entries remain scoped to their city.

Use `http://localhost:5173/?mode=demo` for the explicitly simulated hackathon walkthrough, controls, and scenario sliders. This deliberate URL mode is distinct from normal production startup; using `window.CanopyGuard.useDemo('trap')` explicitly also switches to demonstration mode. Integrators can still call `window.CanopyGuard.connect(...)` to provide measured live observations, which are labeled as connected sensor data.

The default location selection, startup request, 30-second refresh, stale-response rejection, and source display belong to `frontend/app.js`. Forecast location metadata and city-scoped persistence live in `frontend/weather.js`. These modifications do not validate the forecasting model or pesticide label compliance.

## AZMET station check (Arizona)

The forecast location list also includes six Arizona sites at AZMET weather stations. For those, the forecast panel shows the station's latest measured observation beside the NWS-modeled ground estimate, the difference between them, and a station-anchored screening. This is a comparison only: the 30 ft values remain modeled and the recorded decision is unchanged. See [docs/WEATHER_SIMULATION.md](docs/WEATHER_SIMULATION.md#azmet-station-check-arizona-locations).

## Audit evidence schema (v2)

New audit records preserve the complete source snapshot, event ID, full treatment session and known evaluation context. Built-in demo/forecast records include the actual engine version, effective thresholds, diagnostics, and explicit recording versus observation/forecast-valid times; external/imported evaluations are labeled unverified rather than falsely attributed to the built-in engine. Existing v1 records stay readable with `evidence: null`, without invented historical metadata.

See [docs/AUDIT_EVIDENCE.md](docs/AUDIT_EVIDENCE.md) for the field contract and replay tests, and [docs/AUDIT_INTEGRATION.md](docs/AUDIT_INTEGRATION.md) for the full-evidence PCA CSV schema and export behavior.

## Forecast profile controls and treatment-session boundary

In the default NWS view, **Screening preset**, **Pesticide volatility**, and **Nozzle droplet size** become available after a qualified NWS (or valid cached NWS) model loads. A profile change re-evaluates the displayed forecast period **and every available hourly period**, using the existing built-in decision engine. It updates the displayed risk, effective thresholds, next modeled GO window, and a version-2 audit event. The weather readings, selected city, source issuance/retrieval timestamps, and provenance remain unchanged by re-screening. The chosen profile is kept during in-page NWS refreshes and city changes; it resets to the default when the page is reloaded. A missing/stale forecast still fails closed.

**No connected treatment session** is shown in non-demo modes. Demo-only Start/Finish/Previous treatment/Reset actions are hidden rather than presented as broken controls. The banner offers **Try interactive demo** and, in demo mode, **Return to NWS forecast**. The demo remains separate from real pesticide applications; no treatment is inferred from an NWS model.

The NWS view models both heights from regional conditions: **no field sensor data or actual application history is claimed**. A modeled GO result is not authorization to spray. The imported snapshot mode remains read-only unless a verified live adapter offers `evaluateProfile`.


## California and Arizona weather explorer

Open `http://localhost:5173/weather-viewer.html` after `npm run dev` for a regional map of the dashboard's twelve shared locations. It loads NWS hourly forecasts automatically, with separate AZMET station observations where available. State filters, coordinate-based markers, and an accessible location list cover California and Arizona. Synthetic samples and playback require `?mode=demo`. The explorer makes no interpolated estimates and does not run the spray evaluator. See [docs/ARIZONA_WEATHER_VIEWER.md](docs/ARIZONA_WEATHER_VIEWER.md).

## Explicit evaluation-time evidence (Issue #46)

The built-in demo controller captures an explicit `evaluationTimeMs` when it creates each evaluated snapshot; in demo mode this is the independent deterministic simulation clock. NWS forecasting and profile re-screening capture the evaluation invocation clock separately from forecast valid, issuance, and retrieval times. The application threads that exact context into version-2 audit evidence, persistence, `Evaluation UTC` CSV, and activity/print views. It never substitutes action `recorded_at` for the time supplied to the evaluator. Historical or externally evaluated records retain unknown evaluation times rather than invented timestamps. See [docs/AUDIT_EVIDENCE.md](docs/AUDIT_EVIDENCE.md) and `tests/evaluation-time.test.mjs`.


## Per-height evaluator quality and rule provenance (Issue #45)

The built-in evaluator now checks 5 ft and 30 ft readings independently, distinguishes input-integrity fail-safe STOP from actual upper-height drift hazards, and exposes structured `data_quality` and per-rule `provenance`, `source_heights`, and upper/cross-height flags. Rule severity is ordered STOP before CAUTION, and hidden-risk credit requires fully valid input plus a qualifying upper-height STOP. The decision banner displays the actual built-in engine version and qualified input/source-height metadata; external/imported results remain unverified. Regional NWS heights are still **modeled**, never measured orchard sensor data. **Input VALID** means structural/time checks passed when supplied, not physical sensor accuracy or spray permission. Historical audit evidence and complete CSV columns remain intact.

See [docs/ENGINE_QUALITY_PROVENANCE.md](docs/ENGINE_QUALITY_PROVENANCE.md) for the metadata schema, time roles, safe presentation rules and regression checks. Missing-sensor UI controls and numeric policy changes are separate issues (#43 and #44).


## Why CanopyGuard shows GO / CAUTION / STOP

The dashboard includes a live **“How was this weather-screening decision reached?”** panel below the current decision banner. It shows the actual 5 ft/30 ft inputs, effective illustrative policy cutoffs, rule severities, and clickable EPA/university-extension sources. The overall status uses **STOP > CAUTION > GO**; GO means configured checks passed, **not** application safety or label compliance. Scientific references support the *environmental risk mechanisms* (wind, inversions, hot/dry evaporation), while exact inversion/shear and profile thresholds are **project assumptions requiring field validation**. NWS heights remain modeled; imported/external results cannot be attributed to CanopyGuard's built-in engine without proof.

See [Decision evidence and source traceability](docs/DECISION_EVIDENCE.md) for the research-backed explanations, actual equations, audit provenance, assumptions, and limitations.
