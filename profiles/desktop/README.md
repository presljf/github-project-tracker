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
    uses: presljf/github-project-tracker/.github/workflows/reusable-desktop-smoke.yml@v1.2.0
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

## Contract notes

- Runner default: `macos-15`; `macos-14` is retired.
- Smoke is advisory on PRs unless the project promotes it; required at release gate only with
  recorded evidence.
- No secrets; no live Spotify calls.
- The downstream contract verifier rejects a bespoke desktop-smoke workflow when this reusable
  profile is available.
