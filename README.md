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
- Three explicit demo scenarios, volatility/nozzle selectors, JSON snapshot import.
- 24-hour demo forecast with a derived GO-window callout, selectable periods, and per-period reasons.
- Strict runtime contract validation and TypeScript interfaces.
- Live adapter hooks with stale/missing/invalid data handling, profile evaluation pending/error states, and obsolete async-result rejection.

The landing state is **SIMULATED DATA**, not a live field recommendation. `frontend/demo.js` supplies simulated observations to the shared synchronous engine in `frontend/engine/`. The engine implements the project screening rules; its generic profiles are not verified product labels or a validated commercial agronomic model. A coarse nozzle or low-volatility selection never clears an atmospheric hazard that exceeds the corresponding profile limits. Recorded high-volatility treatment alerts remain tied to the applied profile. The NWS module was not present in the repository; forecasts are explicitly labeled simulated until connected.

See [docs/FRONTEND_INTEGRATION.md](docs/FRONTEND_INTEGRATION.md) for connecting team modules. The shared snapshot shape is in [frontend/types.d.ts](frontend/types.d.ts); runtime checks are in [frontend/contract.js](frontend/contract.js).

For browser adapter checks and 390px/768px layout previews, open `/__qa` on the development server and select **Run adapter checks**. The QA page is outside `frontend/` and is not included in the production build.

Team 4's controller and event recording are integrated into this application.
Scenario changes advance simulation time without rewinding manual treatments,
profile changes and manual snapshots retain distinct event IDs, and clock changes
refresh forecast windows. See [docs/TEAM4_CONTROLLER.md](docs/TEAM4_CONTROLLER.md)
for the shared event boundary and judge-replay behavior.

## Decision engine

```js
import { evaluate, getProfile } from './frontend/engine/index.js';
const evaluation = evaluate({ ...weatherPayload, pesticide_profile: getProfile('contact_fungicide') });
```

The engine evaluates both heights, inversion and shear, evaporation, four presets, and recorded spray sessions. It always returns `evaluation.caught_hidden_risk` (contract v1.1; legacy v1 imports still work). `evaluate` returns STOP for invalid input. It is synchronous and makes no network requests.

See [docs/DECISION_ENGINE.md](docs/DECISION_ENGINE.md) for thresholds, science sources, limitations, label overrides, API examples, session persistence responsibilities, and wet-bulb calculations. Run `npm run benchmark` for local timings. The default site demo now uses this engine, not separate UI-only risk rules.

## Production NWS view and explicit simulation (November 2026)

The normal application entry point now starts in **forecast screening mode**, selecting Fresno, CA by default and requesting regional NWS hourly forecasts. It refreshes every 30 seconds and exposes the location selector even when the simulator is hidden. Supported California city IDs: `fresno`, `modesto`, `merced`, `bakersfield`, `chico`, and `yuba_city`. Both the weather model and selected city use `America/Los_Angeles` for display; city coordinates are approximate city centers, not verified orchard sensors.

**Important:** The 5 ft and 30 ft values shown in the forecast view are *estimates from an NWS regional forecast*, not measurements. The GO/CAUTION/STOP values there are **modeled forecast screening**, never on-site clearance. When the weather service and valid selected-city cache are both unavailable, the production screen displays **DATA UNAVAILABLE — DO NOT SPRAY** rather than substituting synthetic data. Recent cached NWS forecasts are labeled as cached, and cached entries remain scoped to their city.

Use `http://localhost:5173/?mode=demo` for the explicitly simulated hackathon walkthrough, controls, and scenario sliders. This deliberate URL mode is distinct from normal production startup; using `window.CanopyGuard.useDemo('trap')` explicitly also switches to demonstration mode. Integrators can still call `window.CanopyGuard.connect(...)` to provide measured live observations, which are labeled as connected sensor data.

The default location selection, startup request, 30-second refresh, stale-response rejection, and source display belong to `frontend/app.js`. Forecast location metadata and city-scoped persistence live in `frontend/weather.js`. These modifications do not validate the forecasting model or pesticide label compliance.

## Audit evidence schema (v2)

New audit records preserve the complete source snapshot, event ID, full treatment session and known evaluation context. Built-in demo/forecast records include the actual engine version, effective thresholds, diagnostics, and explicit recording versus observation/forecast-valid times; external/imported evaluations are labeled unverified rather than falsely attributed to the built-in engine. Existing v1 records stay readable with `evidence: null`, without invented historical metadata.

See [docs/AUDIT_EVIDENCE.md](docs/AUDIT_EVIDENCE.md) for the field contract, replay tests, source provenance, and current **CSV/export limitations** (full evidence export remains Issue #17).
