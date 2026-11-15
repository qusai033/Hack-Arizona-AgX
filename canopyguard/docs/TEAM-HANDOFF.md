# Team integration handoff — 2026-11-15

## Current boundary

Team 4 infrastructure is implemented. Team 1 fixtures, team 2 risk evaluation, and
team 3 presentation are scaffold placeholders. The UI visibly reports that status.
Do not remove the integration notice in App.tsx until the three owners' modules are merged and verified.

Every teammate needs the final plan's **Sections 1–3 plus their own prompt**, not
only Section 1. This repository's shared types and committed configuration are the
implementation contract. Do not independently create another application scaffold.

## Imports to preserve

| Owner | Exports consumed by the app |
| --- | --- |
| 1 | `getScenarioList`, `getScenarioSnapshot`, `applyManualOverrides` from `src/services/weatherSimulator.ts` |
| 2 | `ILLUSTRATIVE_PROFILES`, `buildRuleConfig` from `src/config/ruleConfigs.ts`; `evaluateSprayConditions` from `src/engine/riskEvaluator.ts` |
| 3 | Named component exports `DecisionBanner`, `ComparisonCards`, `CanopyVisualizer`, `ControlPanel`, `ActivityLogTable`, with the existing exported props interfaces |
| 4 | `useCanopyGuard`, logger functions, canonical shared types, application wiring |

`ScenarioDefinition` is centralized in `src/types/canopy.ts` and re-exported from
`weatherSimulator.ts`, so the documented import path remains compatible without a
data/service type cycle. Each seed module has an ownership comment at the top.

## Small corrections carried into implementation

- Wind checks must use mutually exclusive low / high / near-limit branches to match
  the expected rule-code table. High wind must not also produce near-limit CAUTION.
- `missing_stale_sensor` starts with missing temperature and is therefore invalid.
- Construction such as `new Date(Date.parse(simNowIso) - 600_000)` is deterministic.
- Manual editing at one height must not silently clear a stale-data flag for another
  height. The scaffold preserves an existing simulated-stale flag.
- Dispatch owns event IDs. Both repeated processing and React StrictMode must leave
  one log record per event; separate deliberate actions always have separate IDs.
- A dismissed alert stays dismissed while the same condition persists. Returning to
  GO clears that notification state, allowing a later recurrence to notify again.

## First-frame expectations (standard profile, IDLE)

| Scenario | Ground | Multi-height | Hidden hazard |
| --- | --- | --- | --- |
| hidden_inversion_trap | GO | STOP | true |
| favorable_mixing | GO | GO | false |
| excessive_upper_wind | GO | STOP | true |
| threshold_boundary | GO | STOP | true |
| missing_stale_sensor | GO | STOP | false |

These are acceptance targets for teammate 2. The current evaluator intentionally
returns STOP/pending for every fixture and has no real risk-rule implementation.
Teammate 1 still needs evolving frames and a stale-data frame.

## Integrating a teammate branch

1. Keep package versions and shared contracts from this scaffold.
2. Replace owned STUB files, preserving export names and prop shapes.
3. Run the owner's tests, `npm test`, and `npm run build`.
4. Run `npm run test:e2e` against the updated build. Update scaffold-specific assertions
   only when the pending-module notice is intentionally removed.
5. Verify the five expected decisions against the agreed configuration once the real engine is merged.

## Deferred forecast work

The current app makes no NWS requests. Before implementing that stretch:

- Use the forecast's actual issuance time and a supplied real-world current time to
  check freshness. Do not compare a live forecast to the fixed scenario clock.
- Keep forecast valid time separate and disclose any estimated canopy profile.
- Define a structured forecast failure result for `FORECAST_ISSUANCE_STALE`;
  `CandidateForecastWindow` currently has no rule-code field.
- Offline or cached data must retain its true provenance and issuance timestamp.

## Verification boundary

Team 4 tests inject a test evaluator to exercise clocks, profiles, alerts, persistence
and reset independently. They do not verify scientific validity or validate the competition rubric.
The browser suite verifies the compiled app with external requests blocked while localhost remains available.

Verified on 2026-11-15 with Node 26.13.0 / npm 11.20.0:

- Clean lockfile installation: `npm ci --offline --no-audit` passed from the populated cache.
- TypeScript check and production build passed.
- All 16 team 4 unit/integration tests passed.
- Both production-browser tests passed, including blocked external requests, CSV download,
  storage reload/reset, corrupt-storage recovery and desktop/mobile overflow checks.
- The dependency installation after the Vitest update reported zero known npm vulnerabilities.

The original seven-hour schedule is a template. Rebase checkpoints onto actual time remaining.
