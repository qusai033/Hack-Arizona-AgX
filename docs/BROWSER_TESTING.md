# Browser regression suite

The root application remains framework-free. This suite runs the actual built dashboard with Playwright and Chromium; it does not import the separate React/Vite scaffold or its placeholder evaluator.

## Setup and command

Requires Node.js 20 or newer. Install the one optional development dependency and then install the Chromium browser binary:

    npm ci
    npx playwright install chromium

Run:

    npm run test:e2e

The script first runs the existing production build into dist/. Playwright then starts scripts/serve-dist.mjs on 127.0.0.1:4173, waits for the server, executes tests/e2e, and shuts the server down when the run ends. The test server serves only the generated dist/ application plus the existing tests/browser.html page at /__qa. It does not serve a second app or change the normal development server.

The existing Node test runner remains available as npm test. The production build remains npm run build. Playwright is a development-only dependency and does not become a runtime dependency of the dashboard.

## Coverage

- Runs the existing /__qa adapter checks against the generated production assets, including 390px and 768px frame overflow, stale/fresh/failed adapter data, obsolete asynchronous responses, session behavior, repeated actions, event idempotency, scenario clock progression, anchored judge replay, pause behavior, and reload de-duplication.
- Exercises the actual built demo and shared evaluator; verifies two intentional identical-result snapshots have distinct IDs without advancing the clock, while a repeated event ID changes neither time nor persisted record count.
- Verifies the full version-2 audit record and complete treatment-session context survive browser reload, checks the downloaded CSV by parsing its actual contents, and asserts export identity, event, session state, block, and timestamps against the saved row.
- Forces audit localStorage writes to fail and checks that the page remains usable, the in-memory record is kept, and the UI discloses temporary rather than persistent storage.
- Checks alert dismissal followed by recurrence after a clear-to-risky scenario transition, and checks that the treatment-session reset works.
- Runs all four judge-walkthrough steps, confirms the intended 9:00 AM bundled replay remains anchored, and parses the filtered hidden-risk CSV to ensure every exported ID belongs to a hidden-risk record.
- Mocks the NWS points and hourly endpoints for fresh success, stale issuance, HTTP failure, and a delayed previous-city response. The app's normal fetch, validation, forecast mapping, and real evaluator still run; only the remote HTTP responses are fixtures.
- Explicit demo-mode tests block every external origin. Production-mode tests allow only the controlled api.weather.gov fixtures.
- Checks the built layout at 1280px, 768px, and 390px and fails on browser page errors or console errors.

The CSV assertions deliberately match the export contract currently merged on main. The later complete-JSON CSV columns belong to Issue #17 and are not presumed present until that work is merged; the audit v2 evidence itself is checked directly against browser storage.

## Diagnostics

Playwright captures a trace and screenshot on failure, and retains video on failure. Test outputs are written under test-results/ and are excluded from version control. To inspect a retained trace:

    npx playwright show-trace test-results/path-to-test/trace.zip

The command requires a locally installed Chromium browser. In a clean environment, run the Chromium install step once before running npm run test:e2e.
