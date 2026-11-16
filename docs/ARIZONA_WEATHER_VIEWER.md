# California and Arizona weather explorer

Open `/weather-viewer.html` for regional weather, or `/weather-viewer.html?mode=demo`
for an offline sample-data demonstration. The explorer does not run the spray evaluator,
estimate orchard heights, interpolate weather between locations, or connect treatment history.

## Locations and map

`frontend/locations.js` is the single location registry used by the dashboard and explorer.
It retains existing IDs, coordinates, time zones, and AZMET station associations.

- California: Fresno, Modesto, Merced, Bakersfield, Chico, Yuba City.
- Arizona: Yuma Valley, Yuma North Gila, Roll, Maricopa, Safford, Willcox Bench.

Both / California / Arizona filters adjust the map extent and location list. Selecting a
filter that excludes the active location selects the first location in that state.
Numbered buttons and the keyboard-accessible list select the same record; selection stays
highlighted after focus moves. `?location=willcox_bench` links directly to a location.
On phones a native location selector replaces the full list, and a link jumps directly
to the selected weather panel without scrolling through every location.

Boundaries are the U.S. Census Bureau's 2025 cartographic state boundaries at 1:20,000,000.
California and Arizona are emphasized; Nevada and Utah provide geographic context.
The boundaries and location coordinates use the same equirectangular projection with
standard parallel 37°N. Small dots preserve actual stored coordinates. Nearby numbered
buttons are separated in screen space and connected to the dots with leader lines.
The generalized map is a regional location guide, not a parcel or navigation product.

Source: [Census cartographic boundaries](https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html).
The local asset requires no map API, tile service, runtime network request, or key.
To reproduce it with Python's standard library:

```sh
curl -fL https://www2.census.gov/geo/tiger/GENZ2025/kml/cb_2025_us_state_20m.zip \
  -o /tmp/cb_2025_us_state_20m.zip
python3 scripts/import-state-boundaries.py /tmp/cb_2025_us_state_20m.zip
```

The generated module records the source archive SHA-256. The conversion retains the
published polygon coordinates, including islands, without additional simplification.

## Normal mode

- Automatically fetches the selected location's NWS hourly forecast on load and every
  30 seconds while visible. Refresh is also available manually. A hidden tab refreshes
  on return; leaving the page cancels requests and timers.
- Displays the current forecast hour, or explicitly identifies the next hour if the
  current hour is missing. Forecast valid period, source issuance/update time, and
  retrieval time are shown separately in the selected location's time zone.
- Uses the same issuance validation and hourly normalization as the dashboard, extracted
  into `nws.js`. The dashboard's existing exports remain compatible.
- Rejects missing, future, or stale issuance using the shared freshness policy. Malformed
  periods, out-of-range weather values, and gaps are unavailable, never backfilled.
- Separately loads observations for Arizona's associated AZMET stations. The existing
  AZMET adapter enforces station identity, sensor quality, 45-minute freshness, and
  five-minute successful-response reuse. Observation time is not forecast valid time.
- Labels measured heights: temperature/humidity 4.9 ft and wind 9.8 ft. No measured
  canopy-height conditions are claimed. California locations have no connected station.
- Each source can fail independently. Unavailable data is cleared and explained; there
  is no synthetic fallback or persistent weather cache in this explorer.
- Aborts superseded location requests and ignores late results from an earlier selection.

## Explicit demo mode

Demo mode makes no weather requests. All twelve synthetic records are checked against
the fixed reference clock `2026-11-15T16:00:00Z`, not today's date. Values and thresholds
are illustrative, and are labeled as samples rather than actual observations.

The selected record and its eight-frame playback show the same values. Selecting another
location resets playback. Play advances one simulated minute per real second; 5× and 10×
change cadence only. Pause freezes the clock, Step adds one minute, and Reset cancels
playback and begins a new event run. The timeline stops at its final frame.

## Validation

```sh
npm test
npm run build
npm run test:e2e
```

Coverage includes shared-location identity, projected geography, mobile marker separation,
NWS issuance and coverage failures, independent station/forecast failures, late responses,
automatic/manual refresh, keyboard selection, responsive layouts, and offline demo playback.
