# Standalone Arizona weather viewer

The optional page at `/weather-viewer.html` is a general-purpose display and data-quality demonstration. It is separate from the CanopyGuard dashboard and its evaluator.

## Current behavior

- Shows five example Arizona city locations on a schematic, explicitly not-to-scale outline.
- Displays temperature, relative humidity, wind speed/direction, coordinates, source attribution, and observation timestamps for each sample record.
- Validates required fields, broad numeric ranges, duplicate record IDs, timestamp validity, and a configurable freshness window.
- Reports missing, stale, future-dated, or malformed records instead of filling or silently substituting values.
- Includes keyboard-operable map points and responsive layout.

## Data and limitations

Every bundled record is a **synthetic demo fixture**. None is an AZMET station observation, HRRR grid value, USGS elevation sample, live forecast, or verified measurement. The fixture is not updated from a network source. The schematic map is not a navigation product, and no spatial interpolation, source fusion, vertical profile estimation, or accuracy claim is made.

The viewer intentionally has no imports from `weather.js`, `engine/`, or the application evaluator. It does not expose application-specific thresholds, action windows, or recommendations. Its numeric validation bounds are broad software-integrity checks, not meteorological or operational thresholds.

## Run and test

From the repository root:

```sh
npm run dev
# Open http://localhost:5173/weather-viewer.html
npm test
npm run build
```

The build copies the standalone page and its assets with the existing frontend directory. The page is also available in the static `dist/` output.
