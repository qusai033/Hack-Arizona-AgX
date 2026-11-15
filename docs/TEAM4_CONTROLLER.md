# Team 4 controller and event integration — 2026-11-15

This ports the deterministic clock and event-recording behavior from the Team 4
scaffold at `69ae9b6` into the existing JavaScript application. It addresses
issues #5, #6, and #7. The actual weather simulator and decision engine are used.
The port incorporates production forecast and six-city work merged in #21.
Normal startup remains NWS forecast mode; use `?mode=demo` for simulation.

## State and time

`frontend/demo-controller.js` exports `createDemoState` and `reduceDemoState`.
Transitions are synchronous and do not read wall-clock time or generate IDs.
The state contains the scenario/frame, an independent simulation clock, profile,
overrides, full treatment session, and evaluated snapshot.

- Initial ordinary demo time is `2026-11-15T14:45:00.000Z` (6:45 AM PST), the
  default trap preset's dawn anchor.
- Each simulation tick advances one frame and 60 seconds.
- Selecting a scenario resets its frame, clears overrides, advances time by
  60 seconds, and preserves manual treatments and existing audit records.
- Forward slider movement advances by the frame distance. Selecting an earlier
  frame treats it as a new observation 60 seconds later; it cannot backdate a
  manual treatment. Selecting the same frame does not advance time.
- Profile changes, reading edits, session actions, and manual records keep the
  current simulation time. Pausing stops the playback timer.
- Each accepted clock change refreshes the forecast's remaining periods/window.
- The afternoon fixture supplies a complete synthetic treatment session when
  no manual treatment exists. Its treatment times are rebased consistently with
  the chosen replay frame; it never replaces a manual treatment.

The judge walkthrough uses a separate controller. Its afternoon replay starts
at `2026-11-15T23:00:00.000Z`, and its forecast explicitly uses the bundled morning
replay. Exiting restores the normal demo's clock, readings, and manual treatment;
it does not reset that simulation. Switching to live/imported data stops playback.

## Event boundary

`frontend/events.js` creates `{event_id, event_type, recorded_at, payload}` at the
user-action or scheduled-step boundary. `recorded_at` is real UTC action time,
distinct from the snapshot's simulated observation time. The payload is copied.
Tests can inject the ID and recording clock.

```js
import { createEvent } from './events.js';

const action = createEvent('SCENARIO_SELECTED', { name: 'clear' });
window.CanopyGuard.dispatchDemoEvent(action);
// Reusing action is a no-op: no extra clock advance or audit entry.
window.CanopyGuard.dispatchDemoEvent(action);
```

The reducer rejects an already processed ID. The application also checks
persisted audit IDs before changing state, so redelivery after reload does not
advance the fresh demo. `dispatchDemoEvent` is demo-only, returns false for a
duplicate or invalid action, and routes errors through the existing unavailable
data UI. Use the action types in `frontend/types.d.ts` for integrations.

Snapshot rendering is separate from recording. The audit UI accepts an explicit
action, retains every distinct action, and applies its notification suppression
independently. The low-level logger keeps its legacy append API for compatibility;
application callers supply `action` to obtain idempotent processing.
Accepted production forecast refreshes use `FORECAST_REFRESHED`, with identity
created before the asynchronous request. Rejected or obsolete responses do not
produce an observation record. Manual records also work for accepted forecasts.

## Verification and next boundaries

`npm test` covers the pure controller with the real engine, active/completed
treatment continuity, backward frame selection, copied event payloads, and
idempotent records in memory and after reload. `/__qa` additionally covers the
browser wiring, identical-result profile changes, manual recording, scenario
selection, the judge replay, and expired forecast windows. Its embedded frames
explicitly request demo mode so QA does not depend on external NWS availability.

The follow-up [lifecycle integration](TEAM4_LIFECYCLE.md) implements #15 alert
state, #16 recovery using #9's v2 evidence, and #18 Reset Demo/Step. The CSV includes
the complete available v2 evidence added in #17 plus demo-run ownership. Print
remains a summary, and #19 owns the portable browser-test harness. Forecast
issuance validation is handled by #8.
