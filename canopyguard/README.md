# CanopyGuard

Team 4's working integration scaffold for the orchard weather hackathon prototype.
The application runs locally and stores its activity log in the current browser.

**Risk evaluation is a placeholder and always returns STOP/pending.** Teammates 1–3
must replace their clearly marked scaffold files before this is a finished demonstration.
The static weather fixtures and schematic UI make integration possible now; they do
not establish scientific validity or completion of the original competition requirements.

## Run

```sh
npm ci
npm run dev
```

For the production demo:

```sh
npm run build
npm run preview -- --port 4173
```

Open the printed localhost URL. Install and build while online; the preview uses
bundled assets and needs no external services. To verify manually, disconnect Wi-Fi,
reload the page, step scenarios, change controls, record snapshots, reset, and export CSV.

The scaffold was built on Node **26.13.0**, the supported LTS already installed on
the team 4 machine. `.nvmrc` records that version. Supported Node 22/24/26 releases
are permitted by `engines`; the actual validated environment is Node 26.13.0/npm 11.20.0.
Use the committed lockfile. Do not independently scaffold or upgrade another copy.

## Verification

```sh
npm test
npm run build
npm exec playwright install chromium
npm run test:e2e
```

The browser tests run the production build, block all external network requests,
reload the page, verify storage and CSV downloads, and check desktop/mobile overflow.
This reproduces loss of external connectivity while keeping localhost available;
it does not turn off the machine's Wi-Fi or promise offline reload of a hosted site.

Vitest **4.1.12** replaces the proposed Vitest 3 baseline because dependency
installation reported advisories in that version. Vite remains **6.4.6**; Tailwind
remains version 3. The package lock records every resolved version.

## What team 4 owns

- Shared contracts, package/build/test setup, app entry point, global CSS.
- `useCanopyGuard`: simulation clock, controls, session state, overrides and reset.
- `activityLogger`: event identity, full evidence records, CSV and browser persistence.
- `App.tsx`: component integration, storage warnings and notification presentation.
- Unit/integration tests and the production browser checks.

The hook uses typed ports to test team 4's behavior independently of the future risk
engine. Passing those tests is **not** validation of the agronomic rules.

## Hand off to the team

See [TEAM-HANDOFF.md](docs/TEAM-HANDOFF.md) for ownership, exports and integration
decisions. Teammates clone this repository, run `npm ci`, and work in their own branches.
On nodens this scaffold is a subdirectory of the shared Hack-Arizona-AgX repository.
See [the import note](../docs/TEAM4_SCAFFOLD.md) for the branch, worktree and existing-app boundary.

## State and records

- Each simulated step advances one minute. Pause freezes simulation time.
- Scenario changes advance time one minute, clear manual overrides and preserve logs.
- Profile/session/manual changes record distinct actions even if the status is unchanged.
- Event IDs are generated at dispatch. Reprocessing an event cannot duplicate its log or advance time twice.
- Reset Demo clears the existing activity log, restores initial controls/clock, and records one `DEMO_INIT` event.
- Clear Log removes records without changing controls or the clock.
- Reload restores the activity log and opens paused default controls; it does not resume a spray session.
- Storage errors leave the in-memory log available and show an export reminder.
- CSV includes readable columns and complete snapshot/configuration/evaluation JSON.

Activity is local to this browser and origin. A different port or browser has a
different log. Export before changing demo machines or clearing browser data.

Forecasts, live notifications, public hosting, and scientific risk validation remain outside this scaffold.
