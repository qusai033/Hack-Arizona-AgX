# Standalone Arizona weather viewer

The optional page at `/weather-viewer.html` is a general-purpose display, playback, and data-quality demonstration. It is separate from the CanopyGuard dashboard and its evaluator.

## Current behavior

- Shows five example Arizona city locations on a schematic, explicitly not-to-scale outline.
- Displays temperature, relative humidity, wind speed/direction, coordinates, source attribution, and observation timestamps for each sample record.
- Includes an eight-frame synthetic Tucson weather timeline with Play, Pause, Step, Reset, and 1× / 5× / 10× speed controls.
- Defaults to 1× playback: one simulated minute per real second. Each timer callback advances exactly one simulated minute and creates one unique demo event ID, regardless of selected speed.
- Keeps paused Step to one simulated minute, freezes time on Pause, cancels the timer on Reset and page exit, and ignores callbacks from canceled timers.
- Validates required fields, broad numeric ranges, duplicate record IDs, timestamp validity, and a configurable freshness window.
- Reports missing, stale, future-dated, or malformed records instead of filling or silently substituting values.
- Includes keyboard-operable map points, accessible playback controls, and responsive layout.

## Data and limitations

Every bundled location record and every playback frame is a **synthetic demo fixture**. None is an AZMET station observation, HRRR grid value, USGS elevation sample, live forecast, or verified measurement. The fixture is not updated from a network source. The schematic map is not a navigation product, and no spatial interpolation, source fusion, vertical profile estimation, or accuracy claim is made.

The playback timeline is a UI timing example only. Faster playback changes the real-time interval between ticks; it does not change the one-minute simulated increment or event identity guarantee. The viewer intentionally has no imports from `weather.js`, `engine/`, the application evaluator, or treatment/session workflow. It does not expose application-specific thresholds, action windows, or recommendations. Its numeric validation bounds are broad software-integrity checks, not meteorological or operational thresholds.

The pesticide-evaluator walkthrough described by issue #48 is not modified by this standalone example.

## Run and test

From the repository root:

```sh
npm run dev
# Open http://localhost:5173/weather-viewer.html
npm test
npm run build
```

The build copies the standalone page and its assets with the existing frontend directory. The page is also available in the static `dist/` output.
