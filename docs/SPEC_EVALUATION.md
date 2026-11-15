# Evaluation against the original handoff

This evaluates the actual built dashboard against **CanopyGuard — Final Canonical
Implementation Plan & Handoff**, the final Gemini PDF supplied by the project owner:

- File: `Apply a final consistency patch to your latest Ca....pdf` (25 pages).
- SHA-256: `bb296edcb1bee6cc224af91fff59b07458e259d7dd2d3ce412339343f5490e46`.
- Primary references: sections 1.2 (honesty), 2.1 (configuration), 2.2 (scenario
  results), 3.1 (acceptance criteria), and the four teammate deliverables.
- The original challenge brief was not supplied. This is an implementation-handoff
  evaluation, not certification against the challenge organizer's requirements.

The first evaluated baseline is recorded in
[Specification findings — 2026-11-15](SPEC_FINDINGS_2026-11-15.md).

The PDF is not needed to execute the suite. Its five input cases, expected results,
three profiles, and configuration constants are transcribed independently into
`tests/spec/canonical.mjs`. Expected values are never read from application fixtures
or calculated by the implementation being assessed.

## Run and review

```sh
npm ci
npm exec playwright install chromium
npm run test:spec
npm run report:spec
```

`test:spec` builds `dist/`, starts the same isolated production-build server used
by the regression suite on port 4173, and runs Chromium. It includes the existing
browser regressions plus the specification tests. The server stops afterward.
It does not reuse the development preview on port 5187 or call the live NWS service.

The audit exits **nonzero** when requirements fail. Run `npm run report:spec`
afterward even if the audit failed; it serves the interactive report on port 9323.
Use `npm run test:spec:ui` to run individual checks in Playwright's interactive UI.

Outputs, excluded from Git:

- `spec-report/html/`: searchable HTML report, evidence attachments, and diagnostics.
- `spec-report/summary.md`: pass/fail matrix and assertion differences.
- `spec-report/results.json`: machine-readable results, source fingerprint, Git HEAD,
  runtime, durations, and evidence paths.
- `test-results/spec/`: failure screenshots, videos, and traces.

The recorded Git SHA identifies HEAD; when evaluating uncommitted test changes,
also record that fact in any checked-in evaluation note. The report is evidence for
that run, not a continuously updated statement about main.

The **Specification evaluation** GitHub workflow is manually triggered. It uses
Node 22, as prescribed by the handoff, and uploads reports even when assertions fail.
Existing PR CI continues to run `npm test` and `npm run test:e2e`. Spec failures are
not converted to expected failures, skipped, or silently added to that regression gate.

## What is measured

| Handoff requirement | Evidence |
| --- | --- |
| Five exact selectable scenarios and initial readings | `SPEC-SCENARIO`: UI catalog and selected audit snapshot |
| Expected ground/multi-height status, every rule, hidden-risk flag | `SPEC-RESULT`: original inputs through the shipped engine, then valid matching outputs rendered in the dashboard |
| Three numeric profiles and caution wind buffer | `SPEC-CONFIG`: actual effective limits versus independent literal expectations |
| Inclusive/exclusive wind, inversion, directional boundaries | `SPEC-BOUNDARY`: isolated engine probes |
| Explicit observation freshness, including future timestamps | `SPEC-FRESHNESS`: supplied evaluation clock and boundary ages |
| Repeatability and circular direction math | `SPEC-PURITY`: repeated identical inputs; 355° to 10° is 15° |
| Invalid-data handling and honest hidden-risk credit | `SPEC-DATA`, missing scenario result, existing adapter regressions |
| Rule provenance, affected heights, cross-height classification | `SPEC-PROVENANCE` |
| STOP-first rule ordering and post-spray watch trigger | `SPEC-ORDER`, `SPEC-POST-SPRAY` |
| GO wording, disclaimer, record name, illustrative profiles | `SPEC-COPY`, `SPEC-PROFILE-LABELS` |
| Ground-only limitations, quality/version badges, missing-sensor control | `SPEC-DISCLOSURE`, `SPEC-BADGES`, `SPEC-MISSING-CONTROL` |
| Step/scenario clock policy, pause, one tick per second | `SPEC-CLOCK`, `SPEC-PAUSE`, `SPEC-PLAYBACK`, existing Step/browser adapter tests |
| Identical-result profile changes, manual actions, redelivery | `SPEC-EVENTS` plus existing unique-actions/idempotency/CSV regression |
| Full stored evidence, reload, CSV, storage failure | Existing v2 evidence/CSV/reload and quota-failure browser tests |
| Explicit evaluation timestamp | `SPEC-EVALUATION-TIME` |
| Notification deduplication and dismissal/recurrence | Existing alert regression and `/__qa` checks |
| Deterministic scoped Reset Demo | `SPEC-OFFLINE`, combined-card test, `/__qa`, and Node reset tests |
| Offline reload, stepping, no external assets | `SPEC-OFFLINE` advances each shipped scenario eight frames; automatic network guard and included export/override regressions |
| 1280×800 geometry, responsive UI | `SPEC-LAYOUT`, existing 768px/390px regressions |
| Forecast issuance separate from forecast valid time | `SPEC-FORECAST-AGE` and existing stale-issuance regression |
| Later startup/30-second forecast refresh/six cities | `SPEC-FORECAST-REFRESH` plus production city/refresh/race regressions |

Engine probes import the **built** `/engine/index.js` in the browser. They pass the
actual application profile and an explicit evaluation time. They do not replace the
engine or force it to use the desired limits. The result JSON captures the exact
input, context, evaluation, and diagnostics. UI catalog checks are separate: success
on an injected engine fixture does not imply that fixture is selectable by a user.

## Name mappings and later changes

The app uses a different contract and native JavaScript rather than the original
React scaffold. The tests normalize names where there is a direct semantic match:

| Handoff | Current app |
| --- | --- |
| `standard_orchard` | `contact_fungicide` |
| `high_volatility_demo` | `volatile_formulation` |
| `fine_mist_canopy` | `fine_airblast` |
| `hidden_inversion_trap` | `trap` |
| `favorable_mixing` | `clear` |
| `ground_only_baseline.status` | `single_station_5ft_status` |
| `status`, `hidden_risk_caught` | `multi_height_status`, `caught_hidden_risk` |
| Inversion/shear codes with severity suffix | Current combined code plus its actual severity |
| Height-specific wind codes | Current `GROUND_` / `UPPER_` equivalents |

These mappings do **not** change numeric readings, thresholds, severities, or missing
fields. Extra rules fail exact result comparisons. Rule membership is compared without
ordering first; `SPEC-ORDER` separately checks severity ordering.

Later project decisions are tracked explicitly:

| Area | Current evaluation policy |
| --- | --- |
| Framework and file ownership | Assess the integrated native-JS app, not the abandoned React scaffold. No framework rewrite is implied. |
| Startup and forecasting | Production starts in NWS mode; the offline simulator requires `?mode=demo` (#21). Forecasting is now implemented stretch work. |
| Initial clock | Use the merged 06:45 PST/14:45Z anchor (#29), rather than the handoff's 14:00Z anchor. The monotonic transition requirements still apply. |
| Reset/storage | Preserve unrelated history and clear only the current demo run (#30). Do not require `localStorage.clear()` or a destructive general Clear Log button. |
| Profile/rule numeric differences | Remain reported failures until the team revises the implementation or explicitly revises the specification. |
| Forecast age policy | The app documents six hours/five minutes; the PDF specifies two hours/five seconds. Strict audit reports the difference, while the regression suite checks the current policy. |
| Playback speed | The app uses accelerated playback; the PDF says one tick per second. Strict audit reports this difference for a product decision. |

## Limits

- Network isolation allows the local HTTP server and controlled NWS fixtures, and
  blocks all other requests. This models disconnected external connectivity; it does
  not turn off the computer's Wi-Fi, test a service-worker/PWA install, or simulate
  loss of the local server. Chromium's global offline mode would block localhost too.
- This is Chromium coverage, not a cross-browser or exhaustive accessibility audit.
- No real sensors, pesticide-label validation, agronomic validation, live NWS
  availability, actual SMS delivery, or regulatory compliance is established.
- Exact wording failures are reported as wording failures; the test runner does not
  decide whether revised copy is acceptable.
- The original full TypeScript field contract, scaffold ownership/timing, all nullable
  input permutations, and every possible profile/session combination are not fully
  verified by these browser tests. Existing Node tests supply additional coverage.
- Profile projections compare exposed effective limits; the high-volatility negative
  inversion-caution cutoff is not independently probed by this first suite.
- Missing-sensor UI is checked for presence, but its complete interactive null/N/A
  rendering cannot be exercised until that control exists. A passing valid-data SVG
  test is not a claim of nullable-SVG coverage.
- The shipped afternoon scenario deliberately holds conditions through early frames;
  the existing judge walkthrough exercises its later inversion. The offline test
  checks clock/frame advancement, not a requirement that every frame changes readings.
- A pass count is not a percentage of complete specification compliance. Review
  failures, documented changes, and uncovered requirements together.
