# Issue #42 — Decision-support copy and disclosure integration

CanopyGuard is an illustrative prototype, **not spray authorization** or an official pesticide compliance record. This integration ports and updates the useful UI work from [PR #51](https://github.com/qusai033/Hack-Arizona-AgX/pull/51) onto the current production branch, preserving the calendar, scoped exports, forecast/profile controls, and Team 4 session/audit behavior.

## Display contract

- A built-in GO decision is presented as **“GO — configured weather checks passed”**, not “safe to spray now.” In NWS mode, the decision label continues to say **MODELED FORECAST SCREENING**, and the existing note warns that modeled heights are **NOT measured orchard conditions**. A GO is not application clearance.
- The exact prototype disclaimer is visible in a prominent page disclosure and in the footer: **“Decision-support prototype using simulated/regional inputs. Does not replace pesticide product labels, on-site measurements, or local regulations.”**
- The ground card lists limitations under **Unobservable from 5 ft**: inversion gradient, upper-canopy wind, and vertical and directional wind shear. It does not imply a station at 5 ft alone can detect these.
- All four built-in screening preset options and the active built-in profile name are labeled **Illustrative**. The threshold explanation is always visible for built-in demo/NWS views; external/imported profiles are **not** misrepresented as the team's built-in presets.
- Activity area title is **Activity & Decision Log**. Its CSV button is **Export Activity Log (CSV)**. CSV filenames follow `canopyguard-activity-log[-scope].csv` while preserving the existing day/selected days/month/all-history options and the original complete-evidence **column schema**. The printable report is **Activity & Decision Log**, not a compliance report; it explicitly disclaims regulatory certification.

## Deferred evaluator metadata (#45)

The evaluator currently produces an engine version and numeric screening diagnostics, but it does **not yet supply** the canonical structured per-height data quality, rule-specific provenance/source heights, or upper/cross-height flags required for trustworthy quality/provenance badges. We deliberately **do not invent a VALID badge or rule provenance** from unrelated weather-feed validation, HTML copy, or a heuristic. Issue [#45](https://github.com/qusai033/Hack-Arizona-AgX/issues/45) owns the evaluator contract. Once that is implemented, render badges from *actual* evaluator metadata and add SPEC-BADGES coverage; until then, the SPEC-BADGES check is expected to identify an unimplemented dependency rather than a fabricated success.

## Verification

- `npm test` includes `tests/disclosures.test.mjs`, verifying SPEC-COPY, SPEC-PROFILE-LABELS and SPEC-DISCLOSURE and ensuring key controls and calendar IDs are unchanged.
- `npm run test:e2e` verifies the actual UI, scoped CSV filename, print summary, modeled-source distinction, responsive widths, and existing audit behaviors.
- `npm run test:spec -- --grep 'SPEC-COPY|SPEC-PROFILE-LABELS|SPEC-DISCLOSURE|SPEC-BADGES'` runs the independent handoff checks from PR #37. Report quality-badge dependency separately from other failures. Do not skip, xfail or silently change the evaluator/policy to force a pass.

**Scope:** copy, disclosures, safe presentation and tests only. No modifications to pesticide decision rules, thresholds, sensor estimates, source data, historical records, event IDs, treatment session controllers, or forecast provenance.
