# CanopyGuard shared project instructions

This is a four-person hackathon repository. These rules apply to all coding runtimes.
The goal is the agreed simulated, offline-capable prototype; the original challenge
brief has not been independently verified. Read README.md and docs/TEAM-HANDOFF.md.

## Ownership

- Team 1: `src/data/scenarios.ts`, `src/services/weatherSimulator.ts`, optional NWS adapter.
- Team 2: `src/config/ruleConfigs.ts`, `src/engine/*` and risk-engine tests.
- Team 3: `src/components/*` and component tests.
- Team 4: package/lock/config files, `src/types/*`, `src/main.tsx`, `src/index.css`,
  `src/App.tsx`, `src/hooks/*`, `src/services/activityLogger*`, `src/test/*`, `e2e/*`, docs.

You are not alone in this repository. Preserve others' changes and coordinate
interface changes with team 4. The initial team 1–3 files are marked STUB/SEED;
their owners should replace them while retaining the agreed exports and props.
Test helpers under `src/test/` are test doubles, not production risk models.

## Implementation

- Use `src/types/canopy.ts` as the canonical shared contract. Use `import type` for types.
- Create event IDs once at dispatch, never during rendering or inside reducers.
- Pure evaluators receive time explicitly. No `Date.now()` or zero-argument `new Date()`.
  Date construction from supplied values is permitted.
- Scenario changes preserve the log and advance time; Reset Demo resets time and history.
- Numeric risk cutoffs are illustrative. Missing data cannot count as a detected weather hazard.
- Keep all assets bundled. No CDN fonts, external icons or runtime AI/API calls in the MVP.
- Do not call the prototype's result guaranteed safe or its log immutable/compliance-certified.
- Run checks for the module you change; run the build before handing off.
- Do not introduce `.planning/` or a new workflow unless the team requests it.

Use ISO dates for project records. The source handoff was reviewed on 2026-11-15.
