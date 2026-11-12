# CI, required-check, and security profile

**Profile version:** `v1.0.0` (T15)
**Status:** shipped; branch protection enabled on public repo with required `ci / ci-gate` + `docs-guard`; project-scoped audit token still pending owner provisioning.
**Applies to:** Node >= 22 projects adopting the Project Tracker OS. The template repository uses the same callers, so the profile is exercised on every PR to this repo.

This profile centralizes CI and security logic once, in reusable workflows, and keeps project-specific values in thin callers. It does not hardcode product commands, does not require secrets, and does not publish anything.

## Contents

- [1. What ships](#1-what-ships)
- [2. CI contract (`reusable-ci.yml`)](#2-ci-contract-reusable-ciyml)
- [3. Required-check and branch-protection contract](#3-required-check-and-branch-protection-contract)
- [4. Security defaults](#4-security-defaults)
- [5. Token and secret matrix](#5-token-and-secret-matrix)
- [6. Runner and cost guidance](#6-runner-and-cost-guidance)
- [7. Selective path and label gating](#7-selective-path-and-label-gating)
- [8. Action SHA pinning](#8-action-sha-pinning)
- [9. Local parity](#9-local-parity)
- [10. Dry-run and secret rules](#10-dry-run-and-secret-rules)
- [11. Rollout and rollback](#11-rollout-and-rollback)
- [12. Troubleshooting](#12-troubleshooting)
- [13. Interface assumptions and hand-offs](#13-interface-assumptions-and-hand-offs)
- [14. Verification evidence (2026-11-11)](#14-verification-evidence-2026-11-11)

## 1. What ships

| File | Role |
| --- | --- |
| [reusable-ci.yml](../.github/workflows/reusable-ci.yml) | Generic Node CI via `on: workflow_call`: lint, format-check, test, build/verify jobs on Linux with `contents: read`, no secrets. |
| [ci.yml](../.github/workflows/ci.yml) | Thin caller for this repository (`push` to `main`, `pull_request`), supplying the template's own commands. |
| [reusable-security.yml](../.github/workflows/reusable-security.yml) | Reusable dependency-review job for pull requests, with a platform-availability guard. |
| [security.yml](../.github/workflows/security.yml) | Security caller: dependency review on PRs plus config-guarded, opt-in CodeQL. |
| [dependabot.yml](../.github/dependabot.yml) | Weekly grouped version updates for npm and GitHub Actions. |
| `docs/CI_SECURITY_PROFILE.md` | This runbook: CI contract, required-check/branch-protection procedure, security defaults, tokens, runners/cost, pinning, local parity, dry-run rules. |

Design rules:

- **Contract once, project values in callers.** Reusable workflows take inputs; adopting projects copy thin callers and pass their commands.
- **Least privilege.** Every CI/security job uses `contents: read`; only the opt-in CodeQL job requests `security-events: write`, at job level.
- **No secrets.** CI/security checks need only the automatic `GITHUB_TOKEN`. Release tokens and tracker-audit tokens belong to other profiles (see [REFERENCE](./REFERENCE.md) sections 13–16).
- **No product-specific hardcoding.** The only default commands are generic package-script conventions (`lint`, `format:check`, `test`, `build`).
- **Expensive or opt-in checks are never required by default.** CodeQL is off unless enabled; expensive platform-specific work stays advisory per the [playbook](./GITHUB_PROJECT_TRACKER_PLAYBOOK.md).

## 2. CI contract (`reusable-ci.yml`)

### 2.1 Inputs

| Input | Type | Default | Behavior |
| --- | --- | --- | --- |
| `node-version` | string | `22` | Passed to `actions/setup-node`. Use `22`/`22.x` for the supported line. |
| `working-directory` | string | `.` | Directory containing `package.json`; also the default working directory for all run steps. Use for monorepos (`apps/web`). |
| `tracker-config` | string | empty | Optional path to the tracker config. When supplied, command mapping is read for `profiles.node.commands.<name>` then `workflows.ci.commands.<name>`. |
| `install-command` | string | empty | Explicit install command wins. Value `none` always skips install. |
| `lint-command` | string | empty | Lint step command. |
| `format-command` | string | empty | Format-check command. |
| `test-command` | string | empty | Test command. |
| `build-command` | string | empty | Build/verify command (the generic "build" slot; docs/config repos may use a validation command). |

Outputs:

| Output | Value |
| --- | --- |
| `result` | `success` only when all four jobs succeed; `failure` when any job fails or is cancelled. |
| `checks-passed` | `true`/`false` convenience form of the same aggregate (matches the T09 catalog's `checks-passed` contract). |

### 2.2 Command resolution order

For each of `lint`, `format`, `test`, `build`:

1. **Caller input** (explicit command) — wins.
2. **Tracker config mapping** when `tracker-config` is supplied — `profiles.node.commands.<name>` first, then `workflows.ci.commands.<name>`.
3. **Canonical package script** — `package.json` `scripts.lint`, `scripts["format:check"]`, `scripts.test`, `scripts.build`; the workflow runs `npm run <script>`.
4. **Documented no-op success** — the job runs and passes, logging a `::notice::` that names the missing command.

Step 4 exists so required checks stay resolvable: a required CI job that is skipped or never runs blocks merges or leaves checks pending. A no-op success keeps the check contract stable, but it is **not** coverage. Configure real commands in the adopting project and note any intentional no-op in the PR.

Install resolution:

- `install-command` set → run it; `none` → skip.
- empty + npm lockfile (`package-lock.json`/`npm-shrinkwrap.json`) → `npm ci`.
- empty + `pnpm-lock.yaml`/`yarn.lock` → detected but not auto-installed; pass an explicit `install-command` (for example `corepack enable && pnpm install --frozen-lockfile`) or use copy mode. This is a deliberate v1.0.0 scope limit, not a silent success: the notice states it and the step skips.
- empty + no lockfile → skip install (docs/config-only repositories, like this template).

### 2.3 Check contexts (branch-protection names)

A called workflow job reports as `<caller job> / <called job>`. Through the bundled caller (caller job name `ci`) the contexts are:

| Context | Default required? |
| --- | --- |
| `ci / lint` | yes once configured |
| `ci / format` | yes once configured |
| `ci / test` | yes |
| `ci / build` | per project (required for build/verify outputs) |
| `ci / prepare` | no (pre-flight command/lockfile resolution; do not require) |
| `ci / ci-gate` | recommended single aggregate gate (fails if any CI job did not succeed) |

`ci / ci-gate` is the summary job (`name: ci-gate`, id `summary`) that `needs` the four check jobs. T09's catalog recommends requiring this one aggregate check; the individual contexts remain available for projects that prefer granular required checks. The workflow also exposes `result` and `checks-passed` workflow-call outputs. Security contexts are `security / dependency-review` (PR dependency review) and `codeql` (the plain opt-in CodeQL job).

Renaming the caller job (`ci`) or any called job changes these exact strings and silently breaks existing branch protection/rulesets. Capture the names from a real run before requiring them:

```bash
# Check names for a PR (replace 20 with the PR number)
gh pr checks 20

# Check names for a commit, if no PR exists yet
gh api "repos/OWNER/REPO/commits/COMMIT_SHA/check-runs" --jq '.check_runs[].name'
```

### 2.4 Caller examples

This repository's caller ([ci.yml](../.github/workflows/ci.yml)) is the minimum working example:

```yaml
jobs:
  ci:
    name: ci
    permissions:
      contents: read
    uses: ./.github/workflows/reusable-ci.yml
    with:
      node-version: '22'
      working-directory: '.'
      tracker-config: 'tracker.config.json'
      lint-command: ''
      format-command: ''
      test-command: 'npm test'
      build-command: 'npm run validate:config'
```

Adopting project (copy mode; recommended while the template repository is private):

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  ci:
    name: ci
    permissions:
      contents: read
    uses: ./.github/workflows/reusable-ci.yml   # copied from the tracker template
    with:
      node-version: '22'
      lint-command: 'npm run lint'
      format-command: 'npm run format:check'
      test-command: 'npm test'
      build-command: 'npm run build'
```

If the template repository is public (or private reusable-workflow access is granted), the caller may reference it instead of copying:

```yaml
    uses: presljf/github-project-tracker/.github/workflows/reusable-ci.yml@v1.2.1
```

Private template caveat: reusable workflows in a private repository need explicit access from the caller repository, and the caller's Actions settings must allow reusable workflows. If either is unavailable, copy the two reusable files and the thin caller; never edit the copy's contract without recording a local deviation (see [UPGRADING](./UPGRADING.md)).

Monorepo and pnpm variants:

```yaml
    with:
      working-directory: 'apps/web'
      install-command: 'corepack enable && pnpm install --frozen-lockfile'
      lint-command: 'pnpm run lint'
      format-command: 'pnpm run format:check'
      test-command: 'pnpm test'
      build-command: 'pnpm run build'
```

The reusable workflow is npm-first for auto-install; the pnpm/yarn example above passes explicit commands. Run it once on a branch before requiring it.

## 3. Required-check and branch-protection contract

### 3.1 Contract

- Required checks must be **deterministic Linux jobs** that always run. Path/label filters on required workflows leave checks pending and block merges (see [TROUBLESHOOTING](./TROUBLESHOOTING.md)).
- Default required set: `ci / lint`, `ci / format`, `ci / test`; add `ci / build` when the project builds or verifies an artifact.
- Advisory initially: `security / dependency-review` (until the platform feature is enabled and stable) and any expensive platform job.
- Aggregate gate: `ci / ci-gate` fails when lint, format, test, or build did not succeed. T09's catalog recommends requiring this single aggregate check instead of the four individual jobs, which keeps protection stable when internal job names change. Choose one approach per repository; do not require both the aggregate and its constituents unless intentional.
- **Never required:** `codeql` while it is opt-in, plus macOS/desktop smoke until the release-gate policy is proven.
- Branch protection/rulesets and `tracker.config.json` `workflows.ci.requiredChecks` are the two records of required checks. The config currently stores short names (`lint`, `format`, `test`); platform protection stores full contexts (`ci / lint`, ...). Keep them in sync by convention; reconciling the short-name mapping is a T09/T12 follow-up (this profile does not edit the config).

### 3.2 Current platform state (verified 2026-11-11)

The repository is now **public**. Classic branch protection is enabled on `main` with required checks:

- `ci / ci-gate`
- `docs-guard` (docs links/fences, transport guard, docs coverage)

Force pushes/deletions are disabled; `strict` requires branches to be current. `Release (generic)` remains disabled until T02. Audit-in-CI still needs an owner-provided project-scoped `TRACKER_TOKEN` secret; no token is committed.

### 3.3 Inspect current protections

```bash
# Classic branch protection (when available)
gh api "repos/OWNER/REPO/branches/main/protection"

# Required status check contexts only
gh api "repos/OWNER/REPO/branches/main/protection/required_status_checks" --jq '.contexts'

# Repository rulesets (modern alternative)
gh api "repos/OWNER/REPO/rulesets"
```

UI paths (authoritative): **Settings -> Branches** for classic protection; **Settings -> Rules -> Rulesets** for rulesets. Use "Require status checks to pass" and add the exact contexts from section 2.3.

### 3.4 Apply classic branch protection (when available)

Back up the current settings first, then apply. Example `main` policy for a solo/agent-operated tracker repo:

```bash
gh api -X PUT "repos/OWNER/REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci / lint", "ci / format", "ci / test"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Notes:

- `enforce_admins: false` leaves a documented emergency bypass for solo maintainers; use it only for recorded emergencies (check-in/check-out comment in the task issue).
- Omit contexts that have never appeared in a successful run; GitHub matches strings exactly.
- Rulesets are the preferred long-term mechanism on organizations; create the "require status checks" rule in the UI and add the same contexts.

### 3.5 Changing required check names safely

1. Merge the workflow change that produces the new/renamed check.
2. Let a PR run and capture the exact context strings (section 2.3).
3. Update protection/ruleset contexts **before** the next PR needs to merge.
4. Record the rename in the task issue and (if policy changed) with a dated `plan-change` comment.

## 4. Security defaults

### 4.1 Dependabot (default on)

[dependabot.yml](../.github/dependabot.yml) configures weekly grouped version updates:

- `github-actions` — keeps the SHA-pinned actions current; grouped weekly to limit PR noise.
- `npm` — grouped minor/patch updates; majors arrive individually for review.

Operating rules:

- No labels are configured in the file because Dependabot only applies labels that already exist. Create `dependencies` in the adopting repo and add a `labels:` entry if wanted.
- No credentials in `dependabot.yml`. Private registries must use Dependabot secrets (Settings -> Secrets and variables -> Dependabot).
- Version updates are free for public and private repositories; vulnerability alerts are configured at the repository/org level.
- Dependabot PRs go through the same CI. This profile enables **no auto-merge**; grouped minor/patch PRs still need review.
- Keep the config current with Dependabot schema changes (T12 validates during release QA).

### 4.2 Dependency review (default on pull requests)

[security.yml](../.github/workflows/security.yml) calls [reusable-security.yml](../.github/workflows/reusable-security.yml) on `pull_request`. The check context is `security / dependency-review`.

- Defaults: `fail-on-severity: high`, `warn-only: false`. Set `warn-only: true` for an advisory rollout.
- No secrets: `contents: read` only; PR comments are disabled (that would need `pull-requests: write`). To enable comments, copy the reusable workflow and grant `pull-requests: write` deliberately.
- **Platform guard:** dependency review is free on public repositories. Private/internal repositories need GitHub Advanced Security/dependency review availability. When unavailable, the job skips cleanly with an actionable notice instead of failing every PR. Enable it in a private repo with:

  ```bash
  # after confirming GHAS/dependency review availability for the repository/org
  gh variable set ENABLE_DEPENDENCY_REVIEW --body true --repo OWNER/REPO
  ```

  Then verify the run executes the review step and add `security / dependency-review` as advisory (later possibly required).
- Keep this check advisory until the repository actually runs dependency review; a required check that skips when the platform feature is missing is not a real gate.
- Self-hosted runners: dependency-review-action v5 uses the node24 runtime and needs runner v2.327.1+.

### 4.3 CodeQL (opt-in)

CodeQL is a job in [security.yml](../.github/workflows/security.yml), deliberately enabled only by configuration:

- **Why opt-in:** private repositories need GitHub Code Security/Advanced Security, and language/build setup is project-specific. Enabling it should be a decision, not a surprise failing check.
- **Enable for all events:** set repository variable `ENABLE_CODEQL=true`.
- **Enable for one run:** dispatch the workflow with `enable-codeql=true`:

  ```bash
  gh workflow run security.yml -f enable-codeql=true
  ```

- **Languages:** repository variable `CODEQL_LANGUAGES` (default `javascript-typescript`). Compiled languages need explicit build steps added in the project copy between `init` and `analyze`; the bundled caller is tuned for JS/TS.
- **Permissions:** the CodeQL job requests `contents: read`, `actions: read`, `packages: read`, and `security-events: write` (job level only). Called reusable workflows can only downgrade the caller's token, which is why CodeQL lives in the caller rather than the reusable security workflow.
- **Fork PRs:** the job skips when the PR head repository differs from the base repository, avoiding read-only-token upload failures on forks. Lean on `push`/`schedule` scans for fork-heavy repos.
- **Never required:** an opt-in job that is skipped must not be in the required-check list.
- **Default setup alternative:** Settings -> Code security -> Code scanning -> Default setup is simpler for JS/TS. Do not run default setup and this advanced workflow at the same time.
- Disable by unsetting the variable (all-events mode) or deleting the `codeql` job in the project copy; scheduled runs then no-op.

### 4.4 Secret scanning / push protection (platform)

Secret scanning and push protection are GitHub repository settings, not workflow files. Enable them in Settings -> Code security where the plan allows; no template secret is required. Follow [SECURITY.md](../SECURITY.md) for private vulnerability reporting.

## 5. Token and secret matrix

| Need | Token | Permissions | Stored | Rules |
| --- | --- | --- | --- | --- |
| Reusable Node CI | `GITHUB_TOKEN` | `contents: read` | automatic | No PAT; no repo secrets. |
| Dependency review | `GITHUB_TOKEN` | `contents: read` | automatic | No secrets; PR comments disabled by default. |
| CodeQL (opt-in) | `GITHUB_TOKEN` | job-level `security-events: write` + reads | automatic | Enabled by variable/dispatch; never required; fork PRs skipped. |
| Dependabot private registries | Dependabot secret | registry read | Dependabot secrets | Never inline in `dependabot.yml`. |
| Tracker audit (other profile) | `TRACKER_TOKEN`/App | project read (advisory) | repository secret | Separate profile; never in config/logs/artifacts. |
| Release publish (other profile) | `GITHUB_TOKEN`/environment/OIDC | `contents: write` | protected environment | Separate profile; dry-run first, publish explicit. |

Rules:

- Start from `permissions: contents: read` and add only what a job proves it needs.
- Never use `pull_request_target` to combine untrusted PR code with secrets.
- Never print tokens; never store them in config, issues, comments, artifacts, or logs. Short artifact retention for CI.
- This repository's Actions settings default the workflow token to **read** (`default_workflow_permissions: read`, verified 2026-11-11); the explicit `permissions:` blocks keep callers portable to repositories with write defaults.

## 6. Runner and cost guidance

| Runner | Relative cost | Use |
| --- | --- | --- |
| Linux (`ubuntu-latest`) | baseline | All CI/security jobs; required checks. |
| macOS | ~10x minutes | Desktop/native smoke, release gates only. |
| Windows/self-hosted | variable | Only when the project requires it; document capacity and runner version. |

- The reusable CI runs six Linux jobs (prepare, lint, format, test, build, ci-gate). Typical small-repo cost is a few minutes per run; `concurrency: cancel-in-progress` cancels superseded runs on the same ref.
- Cache: npm caching is enabled automatically only when an npm lockfile exists; the reusable workflow passes `cache: npm` and the detected lockfile path. No lockfile -> no cache, no failure.
- Keep artifact retention short. Do not upload dependency trees or secrets.
- CodeQL runs on the weekly schedule (Mondays 16:00 UTC) only when enabled; scheduled scans should stay off-peak.
- Gate expensive jobs with path/label conditions (section 7), but keep required jobs always-running.

## 7. Selective path and label gating

- **Never path-filter a workflow that backs a required check.** GitHub leaves those checks pending for PRs that do not match the filter; see [TROUBLESHOOTING](./TROUBLESHOOTING.md). Put path/label conditions on optional jobs, or make the required job always run and no-op successfully.
- Gate optional heavy jobs inside the caller:

  ```yaml
  jobs:
    e2e:
      if: ${{ contains(github.event.pull_request.labels.*.name, 'ci:full') || github.event_name == 'workflow_dispatch' }}
  ```

- Path-gate an entire **non-required** workflow with `on.pull_request.paths`; never for `ci.yml`.
- Label gates need maintainer-applied labels; a PR opened/updated before the label is added needs a re-run. Do not read untrusted PR text into `run:` scripts.
- No-op required jobs (empty command inputs) are acceptable only when documented; they keep the required contract resolvable but add no coverage.

## 8. Action SHA pinning

All actions used by this profile are pinned to full commit SHAs with the exact release in a comment:

| Action | Pin | Release | Used by |
| --- | --- | --- | --- |
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | `v7.0.1` | CI and security workflows |
| `actions/setup-node` | `949feb2413d6458794dcd2491c4babbbce0c15c1` | `v7.1.0` | Reusable CI |
| `actions/dependency-review-action` | `a1d282b36b6f3519aa1f3fc636f609c47dddb294` | `v5.0.0` | Reusable security |
| `github/codeql-action/init` + `/analyze` | `9418214df1f2c4b8128c770156c409013b07d6b9` | `v3.39.3` | Security caller (opt-in) |

Rules:

- Pin third-party (and first-party) actions by full SHA; never use floating `@main`/`@vN` references in shipped workflows. If a pin cannot be resolved reliably, use the version tag plus an explicit T12 validation note.
- Newer action majors move to the node24 runtime; self-hosted runners must be current (dependency-review v5 explicitly needs runner v2.327.1+).
- Dependabot's `github-actions` ecosystem updates SHA pins and keeps version comments; review the diff as with any dependency bump.
- Verify a pin matches its release before recording it:

  ```bash
  gh api repos/actions/checkout/commits/v7.0.1 --jq '.sha'
  ```

- `sha_pinning_required` is currently **false** in this repository's Actions settings (verified 2026-11-11). Enabling it is recommended once every workflow is SHA-pinned (this profile's workflows are); record the setting change in the target repository's tracker.
- T12 hand-off: re-verify pinned releases and runner requirements during release QA; record the resolution commands' output in the release evidence.
- Existing workflows owned by other tasks (for example `.github/workflows/tracker-audit.yml`) still use version tags (`@v4`); pinning those is a T09/T07 follow-up, outside T15's write scope.


## 9. Local parity

Run the same commands CI runs before opening a PR:

```bash
npm test                          # ci / test
npm run validate:config           # ci / build (template repo verification slot)
```

Adopting projects with the [Node profile](../profiles/node/README.md):

```bash
npm ci
npm run lint                      # ci / lint
npm run format:check              # ci / format
npm test                          # ci / test
npm run build                     # ci / build
```

Workflow validation (no network for the Ruby parse; actionlint is optional):

```bash
ruby -e 'require "yaml"; Dir[".github/**/*.yml"].each { |f| YAML.load_file(f); puts "OK   #{f}" }'

# Optional: GitHub Actions-aware lint (install actionlint from its releases page or brew)
actionlint .github/workflows/reusable-ci.yml .github/workflows/ci.yml \
  .github/workflows/reusable-security.yml .github/workflows/security.yml
```

After push, verify real check names and workflow wiring:

```bash
gh workflow list
gh pr checks <pr-number>
gh run view <run-id> --log-failed
```

No live third-party calls or publishing happen in this profile. CodeQL/dependency review are the only external integrations and are opt-in/guarded.

## 10. Dry-run and secret rules

- No secrets in workflows, docs, examples, or config. The CI/security profile needs only `GITHUB_TOKEN`.
- Dry-run/opt-in by design: CodeQL is off by default; dependency review skips cleanly where unavailable; Dependabot has no auto-merge; no workflow publishes artifacts or packages.
- Do not interpolate untrusted event data (PR titles/branches/issue bodies) into `run:` scripts; pass it through `env` if needed.
- Fork PRs get a read-only token and no secrets; the CodeQL job skips fork PRs, and dependency review requires no secrets.
- Before committing workflow changes, scan for accidental credentials:

  ```bash
  git grep -nE \
    -e 'gh[pousr]_[A-Za-z0-9]{20,}' \
    -e 'github_pat_[A-Za-z0-9_]{20,}' \
    -e 'AKIA[0-9A-Z]{16}' \
    -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
    -- . || true
  ```

- Report suspected leaked tokens through [SECURITY.md](../SECURITY.md) and rotate immediately; never paste them into issues/PRs.

## 11. Rollout and rollback

Rollout order for an adopting project:

1. Copy `reusable-ci.yml` + `ci.yml` (or reference the template) and set real commands.
2. Push a branch, run once, capture check contexts.
3. Enable branch protection/ruleset required checks when the platform supports it.
4. Add `dependabot.yml`; confirm version-update PRs arrive.
5. Run dependency review as advisory; enable the private-repo variable only after the platform feature is confirmed.
6. Optionally enable CodeQL via `ENABLE_CODEQL=true`, run on `main`, then rely on schedule/PR runs.

Rollback:

- CodeQL: unset `ENABLE_CODEQL` (or delete the job) — opt-in jobs do not affect existing required checks.
- Dependency review: remove the security caller job or leave it advisory; required checks remain untouched.
- Required checks: `gh api -X PUT` the previous `required_status_checks` list; inspect with the commands in section 3.3 and record the change.
- Dependabot: remove the ecosystem entry or set `open-pull-requests-limit: 0` to pause without losing configuration.
- Never leave a renamed required check broken silently: update protection in the same maintenance window.

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Required check pending forever | Workflow path-filtered, renamed, or never ran for this PR | Remove path filters from required workflows; update protection to the exact `gh pr checks` names. |
| `workflow not found` / access error for `uses:` | Private template repository access not granted, or relative path wrong | Use copy mode, make the template public/accessible, or fix the relative path. Compare with the working caller in this repo. |
| Called workflow lacks permissions | Called workflows can only downgrade the caller token | Grant the permission on the calling job, or move the job into the caller (as CodeQL does). |
| Dependency review job skips with a notice | Private repo without the platform feature | Enable GHAS/dependency review availability, then set `ENABLE_DEPENDENCY_REVIEW=true`. |
| CodeQL fails with Code Security/Advanced Security error | Feature not available/enabled or default setup conflict | Leave the opt-in off until Code Security is enabled; do not combine default setup with this workflow. |
| `cache` error "Dependency lock file not found" | Cache requested without a lockfile | This reusable workflow enables cache only when it detects an npm lockfile; if the caller overrides setup, fix the path. |
| Runner/action runtime error | Self-hosted runner older than v2.327.1 (node24 actions) | Update the runner, or pin older action versions in the project copy and document the deviation. |
| Dependabot PR without labels | Label does not exist yet | Create `dependencies` (and optionally `ci`) first, then add `labels:` in `dependabot.yml`. |

More general failure handling: [TROUBLESHOOTING](./TROUBLESHOOTING.md).

## 13. Interface assumptions and hand-offs

- **T09 action catalog (merged):** the catalog now documents the delivered `reusable-ci.yml` interface (`node-version`, `working-directory`, `tracker-config`, `install-command`, `lint-command`, `format-command`, `test-command`, `build-command`; outputs `result`/`checks-passed`), aggregate `ci / ci-gate`, and `merge_group` trigger. This profile remains the CI/security operational runbook.
- **T07 template repo:** caller examples assume `presljf/github-project-tracker` is private at v1.0.0 (copy mode default). The reusable-reference caller is documented with the private-access caveat.
- **T08 Node profile:** the canonical package-script fallbacks (`lint`, `format:check`, `test`, `build`) align with [profiles/node/README.md](../profiles/node/README.md)'s command mapping.
- **Tracker config command mapping:** the reusable workflow reads optional `profiles.node.commands.<name>` then `workflows.ci.commands.<name>`. Both are now in the config schema; the workflow still fails soft (warns/falls back) when a mapping is absent.
- **Required-check names in config:** `tracker.config.json` `workflows.ci.requiredChecks` holds short names (`lint`, `format`, `test`); platform protection uses full contexts (`ci / lint`, ...). T09/T12 reconcile the mapping; T15 documents both without editing the config.
- **T12 fresh-eyes validation:** verify check contexts on a live PR, action pins, and protection settings once the platform allows them; capture evidence on the release tracker. Docs index link to this profile is owned by T11/T12 (T15 scope excludes the docs index).
- **This repository's current platform limits:** private personal repo without GitHub Pro -> classic branch protection/rulesets API returns 403 (documented in section 3.2).

## 14. Verification evidence (2026-11-11)

| Check | Command | Result |
| --- | --- | --- |
| YAML parse (all new files) | `ruby -e 'require "yaml"; ...'` | `OK` for reusable-ci, ci, reusable-security, security, dependabot |
| GitHub Actions lint | `actionlint` 1.7.12 reported by T15 on four workflows | exit 0 at T15 time; **not reproducible in this T12 environment (binary unavailable)** — T08 must rerun when available |
| Command resolver unit checks | extracted prepare script run against (a) this repo + caller inputs, (b) temp project with package scripts + pnpm lockfile, (c) config mapping + explicit install | resolved as documented in section 2.2 |
| Local parity | `npm test` | 35 tests pass, 0 fail (T12) |
| Local parity | `npm run validate:config` | `OK tracker.config.example.json`, `OK examples/castdeck.config.json` |
| Action pins | `gh api repos/<action>/commits/<tag> --jq .sha` | pins in section 8 match tags |
| Secret scan | provider-token grep (section 10); no real credentials in the new files | no matches |
| Live PR checks (PR #32, final head) | `gh pr checks 32` after the naming-alignment push | `ci / prepare`, `ci / lint`, `ci / format`, `ci / test`, `ci / build`, `ci / ci-gate` all pass; `security / dependency-review` passes via clean platform-guard skip; `codeql` skipped (opt-in off) |
| Docs links | relative Markdown links resolved against the repo | all targets exist |
| Platform settings | `gh api repos/presljf/github-project-tracker/actions/permissions/workflow` | default token permission `read` |
| Branch protection/rulesets availability | `gh api .../branches/main/protection` | enabled on public repo: `ci / ci-gate`, `docs-guard` required |


**PR close guard:** `.github/workflows/pr-close-guard.yml` validates closing keywords vs task issue kind; completion PRs use closing keywords, partial PRs use Refs/Part of and cannot close.

## Post-merge bypass audit

`.github/workflows/post-merge-audit.yml` detects merged PRs with failed/missing required checks or invalid closing-keyword usage. It opens a `tracker-contract-exception` OI; release must not proceed until resolved. Required checks now include `pr-close-guard`.


**Dependency approval guard:** `guard:deps` fails dependency/lockfile changes unless `tracker.dependencies.json` contains an OI-linked, reasoned, unexpired approval. Clean-tree preflight blocks task start on uncommitted work; `--allow-dirty` requires a recorded reason.


**Docs/version consistency:** `docs-guard` runs `docs:check`, `guard:gh`, `guard:versions`, `guard:docs`, and config validation.


## Lint/format self-check (T18)

Tracker OS now self-applies ESLint and Prettier: `npm ci`, `npm run lint`, and
`npm run format:check`. A missing or broken lint/format command fails CI rather than succeeding
as a no-op. Dev tooling is approved in `tracker.dependencies.json`; see issue #82.

**Branch hygiene:** install `.githooks` via `npm run hooks:install`; `main-history-guard` runs on
push to main and opens a `tracker-contract-exception` OI for commits without a merged PR. This is
the backstop for `--no-verify` and private repos without branch protection.
