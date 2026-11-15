# Teammate 3 integration handoff

## Files and boundaries

| File | Responsibility |
| --- | --- |
| `frontend/index.html`, `styles.css` | Dashboard structure, responsive styles, accessibility |
| `frontend/app.js` | Rendering, controls, data state, asynchronous adapter lifecycle |
| `frontend/types.d.ts`, `contract.js` | Shared contract and strict runtime validation |
| `frontend/visualizer.js` | SVG orchard and meteorological wind directions |
| `frontend/timeline.js` | Forecast continuity checks and next GO interval |
| `frontend/demo.js` | Explicitly simulated scenarios and selector behavior |

No framework, API URL, or authentication scheme was assumed. Do not ship API credentials in this client. Integration code runs after the app module; `window.CanopyGuard` is the public interface. All input snapshots, evaluator outputs, and forecast elements use **exactly** the supplied shared JSON shape. There are no added fields inside those objects. Extra keys are rejected intentionally; coordinate contract changes across the team.

## Teammate 2: current risk evaluation

```js
// In a module loaded after app.js, or after `await import('./app.js')`:
await window.CanopyGuard.connect({
  mode: 'live',
  timeZone: 'America/Los_Angeles', // Arizona blocks: America/Phoenix
  maxAgeMs: 300_000,
  pollMs: 30_000,
  forecastIntervalMinutes: 30,
  async loadSnapshot() {
    const response = await fetch('/api/canopyguard/current', { cache: 'no-store' });
    if (!response.ok) throw new Error('Station unavailable');
    return response.json(); // complete CanopySnapshot, including evaluation
  },
  async evaluateProfile(snapshot, profile) {
    // Example endpoint only; implement with the team backend.
    const response = await fetch('/api/canopyguard/evaluate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...snapshot, pesticide_profile: profile })
    });
    if (!response.ok) throw new Error('Risk evaluation unavailable');
    return response.json(); // complete CanopySnapshot with the same requested profile
  },
  async loadForecast(profile) {
    const response = await fetch('/api/canopyguard/forecast', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile)
    });
    if (!response.ok) throw new Error('Forecast unavailable');
    return response.json(); // CanopySnapshot[], ordered, equal intervals
  }
});
```

These endpoints are integration examples, not implemented services. Live mode **never** invokes `evaluateDemo`. The current and forecast evaluation fields are authoritative. `evaluateProfile` is optional; without it the selectors are disabled. Persist the chosen profile in your backend so subsequent `loadSnapshot()` calls return that same selection. The evaluator may not silently substitute a different profile.

Five minutes is a configurable UI freshness default, not a scientifically validated sampling requirement. In live mode, stale (> maxAgeMs), future (> 60 seconds), malformed, and unavailable snapshots suppress any previous GO, remove the old visualizer/forecast, and show **DATA UNAVAILABLE — DO NOT SPRAY**. A one-second watchdog catches aging observations even between polls. Loading a new profile suppresses the previous decision while evaluation is pending. In-flight replies from old demo selections/connections are discarded. Failed forecast fetches remove the old window without replacing a valid current decision.

## Teammate 1: forecast adapter

Provide an ordered array of evaluated shared snapshots. Use `forecastIntervalMinutes: 60` for hourly data or `30` for half-hour periods. Do not invent half-hour precision from hourly forecasts. Each timestamp is the start of a period; the final period ends one interval later. Equal spacing and valid contract fields are required. The UI finds the first contiguous GO run that has not expired; it excludes past periods and clips a window already in progress. It displays up to 24 hours and reports shorter available coverage honestly. Forecast profiles must match the current selection.

NWS regional forecasts do not themselves constitute measured 5 ft/30 ft orchard conditions. Teammates 1 and 2 must provide and validate their modeling/evaluation approach. Do not copy regional readings to both heights and present the result as a measured microclimate. No NWS connection is claimed by this frontend.

## Snapshot-only integrations and JSON import

```js
window.CanopyGuard.setSnapshot(sharedSnapshot);
window.CanopyGuard.setForecast(evaluatedPeriods, { intervalMinutes: 30 });
window.CanopyGuard.useDemo('trap'); // or 'marginal' / 'clear'
```

`setSnapshot` deliberately switches to **IMPORTED SNAPSHOT · NOT LIVE**, disconnects polling, and disables profile editing. Loading a `.json` file does the same. Invalid files clear prior recommendations. Imported historic timestamps are allowed because they are clearly marked not live; use `connect` for freshness enforcement. The maximum file size is 1 MB.

## Three-minute demo path

1. Start on **Hidden risk**: ground station GO versus multi-height STOP. Point to +4.5°F and +7.6 mph / 95°.
2. Show the warm cap and trapped droplets; inspect both heights. Compass arrows show destination; badges show wind FROM direction.
3. Select **Marginal**. Switch high → low volatility and fine → coarse droplets to move CAUTION → GO under the illustrative model.
4. Return to **Hidden risk**: the atmospheric STOP remains even with a less drift-prone demo profile.
5. Show the simulated 09:00–13:30 GO window and select a later red period. Both the window and period text derive from forecast data.

## Validation

`npm test` covers contract failures, all scenario/profile combinations, persistent atmospheric STOPs, circular bearing differences, freshness, forecast gaps/ordering, expired/no-GO windows, HTML escaping, and wind-vector/cap behavior. Browser QA should additionally verify the three scenario buttons, selector changes, sensor tabs, animation pause, forecast selection, JSON errors, keyboard focus, narrow layouts, and actual backend integration when available.
