# Desktop smoke profile

Thin caller for the reusable desktop-smoke workflow. The reusable workflow owns the runner,
Node setup, timeout, smoke execution, and artifact upload. The project owns only its paths,
commands, and trigger gating.

## Caller example

```yaml
name: Desktop smoke

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled]
    paths: ['desktop/**', 'src/**', 'package.json', 'package-lock.json']
  push:
    branches: [main]
    tags: ['v*']
    paths: ['desktop/**', 'src/**', 'package.json', 'package-lock.json']
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: desktop-smoke-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  desktop-smoke:
    name: desktop-smoke
    if: ${{ github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'run-desktop-smoke') }}
    permissions:
      contents: read
    uses: presljf/github-project-tracker/.github/workflows/reusable-desktop-smoke.yml@v1.4.0
    with:
      runner-label: macos-15
      working-directory: .
      install-command: |
        npm ci
        cd desktop && npm ci
      build-command: ''
      smoke-command: 'cd desktop && npm run test:e2e'
      artifact-path: 'desktop/test-results/**'
```

Path/label gating belongs in the caller. The reusable workflow must not run on `pull_request`
or `pull_request_target`.

## Remote-only policy (guarded local runs)

Desktop smoke spawns visible windows, so it is disruptive to run locally and a local run is not
authoritative evidence. Declare it remote-only in `tracker.config.json` (absent config = current
behaviour):

```json
"verification": {
  "remoteOnly": [
    {
      "id": "desktop-smoke",
      "workflow": ".github/workflows/reusable-desktop-smoke.yml",
      "prLabel": "run-desktop-smoke",
      "localMode": "hidden",
      "overrideEnv": "TRACKER_ALLOW_VISIBLE_GUI",
      "docs": "profiles/desktop/README.md"
    }
  ]
}
```

Wire the offline guard so a visible local run fails before any window is created. Remote detection
is `GITHUB_ACTIONS === 'true'` only (a local `CI=true` is not remote). Suggested adopter scripts:

```json
"scripts": {
  "guard:local-suite": "node scripts/adopt/cli/guard-local-suite.mjs",
  "smoke:desktop": "npm run guard:local-suite -- --suite desktop-smoke && cd desktop && npm run test:e2e",
  "smoke:desktop:hidden": "npm run guard:local-suite -- --suite desktop-smoke --hidden && cd desktop && npm run test:e2e -- --hidden"
}
```

- `npm run smoke:desktop` locally: exit 1 with workflow/label/override/docs instructions.
- `npm run smoke:desktop:hidden`: allowed only when the suite declares `localMode: "hidden"`;
  non-authoritative (never cite it as release evidence).
- `GITHUB_ACTIONS=true` (the caller workflow): allowed — this is the evidence run.
- Verify aggregators: `node scripts/adopt/cli/guard-local-suite.mjs --suite desktop-smoke --mode report --json`
  records `DEFERRED_REMOTE` and exits 0 instead of blocking.
- Override env (`TRACKER_ALLOW_VISIBLE_GUI=1`): deliberate human debugging only, prints a loud
  warning; **agents must never set it**.

For Playwright suites, block at `globalSetup` so nothing launches before the check:

```js
// tests/global-setup.mjs
import { createPlaywrightRemoteGuard } from '../scripts/adopt/lib/playwright-remote-guard.mjs';
export default createPlaywrightRemoteGuard({
  suite: 'desktop-smoke',
  hidden: process.env.DESKTOP_HIDDEN === '1', // your documented hidden-mode flag
});
```

```js
// playwright.config.ts
export default defineConfig({ globalSetup: './tests/global-setup.mjs' });
```

The helper imports no `@playwright/test`; it throws the same actionable error when a visible local
run is attempted. Validate the config with `node scripts/adopt/cli/validate-config.mjs` and
`npm run verify:tooling`. Full reference:
[REFERENCE §5.6](../../docs/REFERENCE.md#56-guard-local-suite-remote-only-verification-policy).

## Contract notes

- Runner default: `macos-15`; `macos-14` is retired.
- Smoke is advisory on PRs unless the project promotes it; required at release gate only with
  recorded evidence.
- No secrets; no live Spotify calls.
- The downstream contract verifier rejects a bespoke desktop-smoke workflow when this reusable
  profile is available.
