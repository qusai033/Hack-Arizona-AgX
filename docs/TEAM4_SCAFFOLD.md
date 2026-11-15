# Team 4 scaffold import — 2026-11-15

The reviewed React/TypeScript scaffold is imported under `canopyguard/` from local
commit `99b88c4`. It is a separate integration candidate.

The existing repository-root application (`frontend/`, `scripts/`, and `tests/`)
is the team's already-merged framework-free dashboard and decision engine.
This import preserves those files and the root package scripts unchanged.
The React scaffold has placeholder weather/risk/UI modules and is **not yet connected**
to the merged dashboard or risk engine. Its contracts differ from `frontend/types.d.ts`;
integration should use explicit adapters or port the team 4 logger/controller into
the existing application.

## Location and branch

- Branch: `feat/team4-integration-scaffold`
- Worktree: `/home/hagan/projects/active/agx/Hack-Arizona-AgX-team4`
- Original checkout: `/home/hagan/projects/active/agx/Hack-Arizona-AgX` remains on `main`.
- Base: `3aa88a7d38fbe86dc72f4c990a925a71a868a34a`

## Run the imported scaffold

On nodens, initialize the existing nvm environment if Node is not on PATH:

```sh
source ~/.nvm/nvm.sh
nvm use 26
cd /home/hagan/projects/active/agx/Hack-Arizona-AgX-team4/canopyguard
npm ci
npm test
npm run build
npm run preview -- --port 4174
```

The distinct preview port avoids colliding with another checkout's demo.
To view it from your laptop:

```sh
ssh -L 4174:127.0.0.1:4174 nodens
```

Then open `http://127.0.0.1:4174` locally while the preview is running.

See [the scaffold README](../canopyguard/README.md) and
[team handoff](../canopyguard/docs/TEAM-HANDOFF.md) for contracts, ownership,
test coverage, and the placeholder-module boundary.

## Nodens validation — 2026-11-15

- All 33 imported source files matched local commit 99b88c4 before the intentional README adaptation.
- Node 26.13.1 / npm 11.20.0.
- Scaffold: npm ci, 16 tests, TypeScript check and production build passed.
- Existing root application: all 56 tests and production build passed.
- Install reported zero known npm vulnerabilities.
- Browser tests were previously run on macOS; they were not rerun on nodens.
