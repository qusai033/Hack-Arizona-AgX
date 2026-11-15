# CanopyGuard — Applicator Dashboard

Teammate 3's responsive frontend for Hack Arizona AgX. Framework-free HTML, CSS, SVG, and native JavaScript modules; no package installation or external assets required.

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

The landing state is **SIMULATED DATA**, not a live field recommendation. `frontend/demo.js` is an isolated presentation simulator, not Teammate 2's production risk engine. Its thresholds and product name are illustrative and do not represent a verified label. A coarse nozzle or low-volatility selection never clears the demo's inversion or excessive-wind STOP. The NWS module was not present in the repository; forecasts are explicitly labeled simulated until connected.

See [docs/FRONTEND_INTEGRATION.md](docs/FRONTEND_INTEGRATION.md) for connecting team modules. The shared snapshot shape is in [frontend/types.d.ts](frontend/types.d.ts); runtime checks are in [frontend/contract.js](frontend/contract.js).

For browser adapter checks and 390px/768px layout previews, open `/__qa` on the development server and select **Run adapter checks**. The QA page is outside `frontend/` and is not included in the production build.
