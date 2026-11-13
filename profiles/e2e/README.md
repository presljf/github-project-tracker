# E2E profile (Playwright)

Reusable-mode Playwright E2E caller for the tracker. One pinned reusable workflow owns the generic
wrapper — adopter checkout, the tracker's `setup-node-cache` action (self-checked out from the
workflow's own repository/commit via `job.workflow_repository`/`job.workflow_sha`), optional
Playwright browser install, the project's test command, and failure-only artifact upload — so the
adopter caller owns only triggers, path/label gating, the command, and the artifact paths.

- Contract: [ACTIONS CATALOG §7.3](../../docs/ACTIONS_CATALOG.md#73-reusable-e2eyml-e2e-contract-optional-profile);
  behavior summary: [§2.2](../../docs/ACTIONS_CATALOG.md#22-e2e-integration-optional-profile).
- Copy-mode caller example (non-runnable): [e2e.yml](./e2e.yml).
- Reusable workflow: [`.github/workflows/reusable-e2e.yml`](../../.github/workflows/reusable-e2e.yml).
- Template plumbing fixture (not an adopter example):
  [`.github/workflows/e2e-fixture.yml`](../../.github/workflows/e2e-fixture.yml) — dispatch-only,
  `browsers: none`, proves the wiring; check context `e2e-fixture / e2e`.

v1.4.0 is the first release that ships `reusable-e2e.yml` and the caller is a `requiredWorkflows`
entry in the adoption contract (presence + pin enforced by `verify-contract`); a project without E2E
may make the caller dispatch-only or path/label-gated, and `e2e / e2e` stays advisory. Older pins
keep their copied E2E jobs. `profiles/` is never executed by GitHub: copy the caller into
`.github/workflows/` and pin the
adopted release tag (`@v<version>`; the contract requires the tag form). The reusable workflow has
**no `tracker-ref` input** — it runs only the adopter's own
commands plus the action it checks out itself — so the `uses:` ref is the only pin.

## Inputs

| Input | Type | Default | Meaning |
|---|---|---|---|
| `node-version` | string | `'22'` | Node.js version passed to `setup-node-cache`. |
| `working-directory` | string | `'.'` | Directory containing `package.json`/Playwright config; the install, browser, and test steps run there. |
| `package-manager` | string | `npm` | `npm`/`pnpm`/`yarn` cache/install selection. |
| `install-command` | string | `''` | Dependency install command. Empty uses the action's lockfile-driven install (`npm ci` when an npm lockfile exists); `none` skips installation. |
| `test-command` | string | `npm run e2e` | E2E command run from `working-directory`. |
| `browsers` | string | `chromium` | Comma-separated Playwright browsers (`chromium`, `chromium,firefox`). Empty or `none` skips the install step for projects that manage browsers themselves. |
| `artifact-path` | string | `''` | Paths uploaded on failure (traces/screenshots/videos). Empty disables the upload. |
| `artifact-name` | string | `e2e-artifacts` | Artifact name (only used when `artifact-path` is set). |
| `artifact-retention-days` | number | `7` | Artifact retention. |
| `upload-on-success` | boolean | `false` | Also upload artifacts on success (off by default). |
| `runs-on` | string | `ubuntu-latest` | Runner label. |
| `timeout-minutes` | number | `20` | Job timeout. |

Outputs: `e2e-passed` (`'true'` when the test command succeeded) and `artifact-name`. No secrets;
the caller and job use `contents: read` only.

## Gating policy (advisory → required)

E2E is **advisory by default** and is not a required PR check. Promotion to required is a recorded
project decision that requires: deterministic behavior, <15 min runtime, Linux, no secrets, a flake
rate recorded over at least a week, and the decision recorded in the tracker. Keep the expensive
job path/label-gated (`on.pull_request.paths` or the `run-e2e` label); required workflows must stay
trigger-only.

Check contexts are `<caller job> / <e2e>`: the example caller publishes `e2e / e2e`. Capture the
real context from a green run (`gh pr checks <pr>` or the check-runs API) before protecting it.

| Before (v1.3.x copied E2E job) | v1.4.0 reusable contract |
|---|---|
| project-specific copied E2E job context (for example `e2e`) | `e2e / e2e` |
| — | `e2e-fixture / e2e` is the template's own plumbing fixture, never an adopter check |

## Browser and network policy

- Playwright browsers are installed per run (`browsers: chromium` default; comma lists install
  several). On Linux the install uses `npx playwright install --with-deps <browsers>`; other runners
  use `npx playwright install <browsers>`. No browser cache exists in v1.4.0 (a future minor may add
  one); a browser download is an install step, not a live third-party assertion.
- Tests must stub/fake external services; no live third-party calls in the required path. Browser
  downloads are the only network step the workflow itself performs.
- Use `browsers: none` when the project manages its own browser provisioning (for example a
  prebuilt container image); the install step is skipped entirely.

## Artifact and PII policy

- Artifacts are uploaded **only on failure** by default (`upload-on-success: false`), only when
  `artifact-path` is non-empty; missing files degrade to a warning (`if-no-files-found: warn`).
- `artifact-path` is resolved by `actions/upload-artifact` relative to the repository workspace, not
  `working-directory` — prefix monorepo paths accordingly (`packages/web/test-results/**`).
- Retention defaults to 7 days. Traces/screenshots/videos can contain PII or secrets: keep the
  globs narrow, never upload environment dumps/recordings that include credentials, and treat the
  artifact as sensitive.

## Monorepos

Set `working-directory` (for example `packages/web`) so the action's install, browser install, and
test command all run in the right package, and remember the workspace-relative artifact paths.

## No secrets

The wrapper never needs secrets: no tokens, no tracker contract checkout, no live service calls.
If a project's E2E test needs credentials, that is a project decision outside this reusable
workflow (prefer stubbed fixtures; never `pull_request_target`).

## Local parity

```bash
npx playwright install --with-deps chromium   # Linux; drop --with-deps on macOS/Windows
npm run e2e
```

The same command is the step the reusable workflow runs (with the configured `browsers` and
`test-command`). Downstream Playwright path validation is CastDeck C3 after the v1.4.0 tag; the
template's `e2e-fixture.yml` proves wiring only (`browsers: none`, trivial command).
