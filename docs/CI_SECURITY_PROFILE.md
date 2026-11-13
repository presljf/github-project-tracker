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
| [reusable-audit.yml](../.github/workflows/reusable-audit.yml) | Reusable tracker audit via `on: workflow_call`: advisory default / strict opt-in, optional `TRACKER_TOKEN`, JSON to the job log/summary (no artifacts). |
| [tracker-audit.yml](../.github/workflows/tracker-audit.yml) | Thin self caller (schedule/dispatch/PR, advisory); check context `tracker-audit / audit`. |
| [reusable-post-merge-audit.yml](../.github/workflows/reusable-post-merge-audit.yml) | Reusable post-merge bypass audit via `on: workflow_call`: audits merged PRs for bypassed required checks/closing-keyword misuse and opens a `tracker-contract-exception` OI; caller-granted audit permissions. |
| [post-merge-audit.yml](../.github/workflows/post-merge-audit.yml) | Thin self caller (`pull_request` closed + dispatch with `pr-number`); check context `post-merge-audit / audit`. |
| [reusable-pr-close-guard.yml](../.github/workflows/reusable-pr-close-guard.yml) | Reusable PR close guard via `on: workflow_call`: read-only closing-keyword/partial-PR validation. |
| [pr-close-guard.yml](../.github/workflows/pr-close-guard.yml) | Thin self caller (PR edit events); check context `pr-close-guard / guard`. |
| [reusable-contract.yml](../.github/workflows/reusable-contract.yml) | Reusable contract + metadata verification via `on: workflow_call`: offline `contract` job (verify-tooling/verify-contract, no secrets) and live `metadata` job (verify-metadata, optional `TRACKER_TOKEN` with Projects + Metadata read). |
| [tracker-contract.yml](../.github/workflows/tracker-contract.yml) | Thin self caller for this repository; check contexts `tracker-contract / contract` and `tracker-contract / metadata`. |
| [reusable-e2e.yml](../.github/workflows/reusable-e2e.yml) | Reusable Playwright E2E via `on: workflow_call` (job `e2e`): installs dependencies through the pinned `setup-node-cache` composite action resolved from the workflow's own repo/sha (`.tracker-actions`), default command `npm run e2e`, browser list default `chromium` (`none` skips), failure-only artifact upload; `contents: read`, no secrets, no `tracker-ref` input. |
| [reusable-counts.yml](../.github/workflows/reusable-counts.yml) | Reusable counts guard via `on: workflow_call` (job `counts`): runs `guard-docs-counts.mjs` against the workspace (self) or pinned `.tracker` (downstream); no artifacts, no secrets. |
| [counts-docs.yml](../.github/workflows/counts-docs.yml) | Thin self caller (PR/push/dispatch, no-op here because this config declares no `docs.counts`); check context `counts-docs / counts`. |
| [e2e-fixture.yml](../.github/workflows/e2e-fixture.yml) | Dispatch-only plumbing fixture for the reusable E2E contract (browsers `none`, trivial test command); check context `e2e-fixture / e2e`; template-only. |
| [dependabot.yml](../.github/dependabot.yml) | Weekly grouped version updates for npm and GitHub Actions. |
| `docs/CI_SECURITY_PROFILE.md` | This runbook: CI contract, required-check/branch-protection procedure, security defaults, tokens, runners/cost, pinning, local parity, dry-run rules. |

Design rules:

- **Contract once, project values in callers.** Reusable workflows take inputs; adopting projects copy thin callers and pass their commands.
- **Least privilege.** Every CI/security/guard job starts from `contents: read`; the post-merge audit additionally needs `issues: write` (to open the `tracker-contract-exception` OI/label) plus `checks: read`, `statuses: read`, and `actions: read` for `statusCheckRollup`; only the opt-in CodeQL job requests `security-events: write`, at job level.
- **No secrets.** CI/security checks need only the automatic `GITHUB_TOKEN`. Release tokens, the optional `TRACKER_TOKEN` (tracker audit / contract metadata), and publish secrets belong to other profiles (see [REFERENCE](./REFERENCE.md) sections 13–16).
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

`ci / ci-gate` is the summary job (`name: ci-gate`, id `summary`) that `needs` the four check jobs. T09's catalog recommends requiring this one aggregate check; the individual contexts remain available for projects that prefer granular required checks. The workflow also exposes `result` and `checks-passed` workflow-call outputs. Security contexts are `security / dependency-review` (PR dependency review) and `codeql` (the plain opt-in CodeQL job). Audit-family contexts are `pr-close-guard / guard` (required), `post-merge-audit / audit` (post-merge only), and `tracker-audit / audit` (advisory) — see §3.7. E2E/counts contexts are `e2e / e2e` (advisory by default; opt-in to required), `counts-docs / counts` (required only when the counts contract is adopted), and the template-only fixture `e2e-fixture / e2e`.

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
    uses: presljf/github-project-tracker/.github/workflows/reusable-ci.yml@v1.3.2
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
- Reusable contract caller: require `tracker-contract / contract` (offline, no secrets); treat
  `tracker-contract / metadata` as project-defined (needs `TRACKER_TOKEN`; see §3.6).
- Audit-family callers: require `pr-close-guard / guard`; do **not** require
  `post-merge-audit / audit` as a merge check (it runs on merged PRs and reports through the job
  summary/OI); keep `tracker-audit / audit` advisory, with strict mode as a release-gate opt-in
  (see §3.7).
- E2E/counts callers: `e2e / e2e` stays advisory by default (no required-check recommendation
  until an adopter opts in and records the decision); `counts-docs / counts` is required only when
  the project adopts the `docs.counts` contract (otherwise the caller is a documented no-op); the
  `e2e-fixture / e2e` context exists only in the template plumbing fixture and must not be
  required.
- Adoption contract (`requiredWorkflows`): the six v1.4.0 callers (contract, post-merge audit, PR
  close guard, tracker audit, E2E, counts) must be present and pinned to the exact adopted tag;
  `verify-contract` enforces both (the exact `@v<version>` ref plus a matching `tracker-ref`; SHA and
  no-`v` pins fail). Required caller **presence** is not the same as a required check:
  only the contexts above are merge-required. The opt-in release gate (§3.8) can fail a release on
  a missing/stale caller or contract violation; open `tracker-contract-exception` OIs are checked
  by the release procedure (`gate:release --repo`).
- Branch protection/rulesets and `tracker.config.json` `workflows.ci.requiredChecks` are the two records of required checks. The config currently stores short names (`lint`, `format`, `test`); platform protection stores full contexts (`ci / lint`, ...). Keep them in sync by convention; reconciling the short-name mapping is a T09/T12 follow-up (this profile does not edit the config).

### 3.2 Current platform state (verified 2026-11-11)

The repository is now **public**. Classic branch protection is enabled on `main` with required checks
(the list below was re-verified 2026-11-13 after the `pr-close-guard / guard` migration):

- `ci / ci-gate`
- `docs-guard` (docs links/fences, transport guard, docs coverage)
- `pr-close-guard / guard` (v1.4.0 reusable caller)

Force pushes/deletions are disabled; `strict` requires branches to be current. Audit-in-CI still needs an owner-provided project-scoped `TRACKER_TOKEN` secret; no token is committed; the optional tracker audit skips with a notice when it is absent.

The v1.4.0 audit-family migration replaced the inline copied workflows with thin callers and renamed
their check contexts (`pr-close-guard` → `pr-close-guard / guard`, and the two `audit` contexts to
`post-merge-audit / audit` and `tracker-audit / audit`). The tracker self-config
`guard.requiredChecks` and branch protection both carry `ci / ci-gate`, `docs-guard`,
`pr-close-guard / guard`; `post-merge-audit / audit` is not a merge check and
`tracker-audit / audit` stays advisory.

The T05 self callers do not change this repository's required set: `counts-docs.yml` is a
documented no-op here because `tracker.config.json` declares no `docs.counts` (real-baseline
validation is a downstream/C3 concern), and `e2e-fixture.yml` is a dispatch-only plumbing fixture;
both remain off required-check lists. The reusable E2E contract (`e2e / e2e`) is advisory by
default — adopters that promote it do so in their own protection/ruleset with recorded evidence.

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

### 3.6 Contract + metadata caller contexts (reusable mode)

Adopters consume the reusable-mode caller instead of copying bespoke contract workflows: copy
[`profiles/contract/tracker-contract.yml`](../profiles/contract/tracker-contract.yml) into
`.github/workflows/` and pin **both** refs (the `uses:` reusable-workflow ref and the `tracker-ref`
input) to the exact adopted tag. v1.4.0 is the first release that ships
`reusable-contract.yml`; older pinned copies keep their previous layout until the pin is upgraded.

| Context | Reusable job | Required? | Permissions | Token | Artifacts |
| --- | --- | --- | --- | --- | --- |
| `tracker-contract / contract` | `contract` | **required** — deterministic, Linux, offline | `contents: read` | none | none |
| `tracker-contract / metadata` | `metadata` | project-defined (see below) | `contents: read` | `TRACKER_TOKEN` (Projects + Metadata read; repository secret) | none |

- `contract` verifies tooling (`verify-tooling`) and the pinned adoption contract
  (`verify-contract`); it needs no secret and is safe for fork PRs.
- `metadata` reads live project metadata (`verify-metadata`), fails fast when `TRACKER_TOKEN` is
  absent, and needs `project.number` in `tracker.config.json`. GitHub withholds secrets from fork
  PRs, so adopter callers set `metadata` from the event (for example
  `${{ github.event_name != 'pull_request' }}`) and metadata runs on `push` / `workflow_dispatch`
  only there; the template repository's own self caller keeps `metadata: false` (tooling profile;
  see the dogfood bullet below). Do **not** put `tracker-contract / metadata` in
  required **PR** checks: a skipped job leaves the context pending and blocks merges. Keep it
  project-defined/advisory unless the project deliberately runs metadata on every PR.
- Token: `TRACKER_TOKEN` is a project-scoped PAT (Projects read + Metadata read, ≤90 days) or a
  GitHub App installation token, stored as a repository secret, passed explicitly by name (never
  `secrets: inherit`), and rotated on the tracker's token schedule.
- `config-path` feeds `verify-tooling` only (default `tracker.config.json`, resolved under
  `working-directory`); `verify-contract` and the `metadata` job read `tracker.config.json` from the
  repository root / working directory. `submodule-path` defaults to `.tracker-os` and only feeds
  the pinned-submodule tag check (missing submodule = notice + skip, not failure).
- The optional `version-guard` job (only when `version-guard-command` is set) runs the
  adopter-supplied trusted offline command in its **own** job with `contents: read` and no pinned
  template checkout, so arbitrary command execution never shares a job with the untrusted
  `tracker-ref` checkout; it uploads no artifacts and uses no secrets.
- The template's own self caller keeps `metadata: false` while the repository runs the tooling work
  profile (the contract's product-mode metadata mapping does not apply and `verify-metadata` is not
  `workProfile`-aware yet; accepted debt) — adopters on the product profile enable metadata via the
  documented expression.
- Both jobs use `contents: read`, request no other permissions, and upload no artifacts; the
  runner defaults to `ubuntu-latest` and Node.js 22 and both are overridable.

### 3.7 Audit-family caller contexts (reusable mode)

v1.4.0 moves the audit family onto reusable workflows with thin callers. Copy the caller you need
from [profiles/audit](../profiles/audit/README.md) (the template dogfoods the same three callers with
`tracker-ref: ''` self mode); pinned references use the exact adopted release tag (`@v<version>`; the contract requires the tag form). Caller job names
produce these contexts:

| Old check context | New check context | Reusable job | Self caller |
| --- | --- | --- | --- |
| `pr-close-guard` | `pr-close-guard / guard` | `guard` (read-only) | `pr-close-guard.yml` |
| `audit` (post-merge) | `post-merge-audit / audit` | `audit` (audit permissions) | `post-merge-audit.yml` |
| `audit` (tracker) | `tracker-audit / audit` | `audit` (advisory/strict) | `tracker-audit.yml` |

Caller permission grants (the caller job must grant at least the called job's declared permissions;
called workflows can only downgrade the caller token):

| Caller | Why these scopes | Caller permissions |
| --- | --- | --- |
| PR close guard | Read-only: fetches the live PR + referenced issues to validate closing keywords and partial-PR rules | `contents: read`, `issues: read`, `pull-requests: read` |
| Post-merge audit | Opens the `tracker-contract-exception` OI/label; `statusCheckRollup` also resolves `checkSuite.workflowRun`, which needs Actions read | `contents: read`, `issues: write`, `pull-requests: read`, `checks: read`, `statuses: read`, `actions: read` |
| Tracker audit | Reads the project/issues only; no write scopes. Optional `TRACKER_TOKEN` secret (project + repo/issues read — see token scope below) | `contents: read` |

Required-check guidance:

- Require `pr-close-guard / guard` on PRs.
- The post-merge audit is the required post-merge record, but do **not** require
  `post-merge-audit / audit` as a merge check: the workflow triggers on merged PRs (and a manual
  dispatch with `pr-number`), so its check is not available at merge time. It reports a job summary
  and opens an OI for a real bypass; the release gate blocks while an OI is open.
- Keep `tracker-audit / audit` advisory (`mode: advisory`); strict mode (`mode: strict`) is a
  release-gate opt-in. Advisory mode without `TRACKER_TOKEN` logs a notice and skips with exit 0;
  strict mode without the token fails with an actionable message. Token scope: project read **and**
  repo/issues read for private adopters — a project-scoped PAT with `project` + `repo` scopes
  (≤90 days) or a GitHub App installation token with Projects + Metadata + Issues read. Store it as
  a repository secret; never in config/logs/artifacts.
- Config caveat: if `guard.requiredChecks` is absent, the post-merge audit falls back to the legacy
  default list (`ci / ci-gate`, `docs-guard`, `pr-close-guard`), which no longer matches the
  reusable context — set the list explicitly when migrating or every merge is flagged as a bypass.

Degraded mode (post-merge audit): when `statusCheckRollup` is unreadable because of a permission or
API error, the audit prints a loud warning + job summary, retries a metadata-only PR fetch, enforces
only the closing-keyword/partial-PR rules, and exits 0 — no false check-related OI. Real
closing-keyword violations still open an OI; non-permission errors still fail.

Fork-PR caveat: a PR merged from a fork can leave the audit without `issues: write`, so OI creation
returns 403. This is a documented pre-existing limitation: the bypass is reported in the job log and
the job fails loudly at OI creation instead of recording the OI — open the follow-up manually. Do not
enable "Send write tokens to workflows from pull requests" unless that is a deliberate, documented
decision.

Artifacts: none. All three reusables emit logs/job summaries only; tracker-audit JSON is printed to
the log and step summary, never uploaded as an artifact.

### 3.8 Release contract gate (opt-in, reusable-release)

`reusable-release.yml` accepts `contract-gate` (boolean, default **false**), `tracker-ref`,
`contract-path`, and `config-path`. When enabled, a `contract-gate` job runs
**before build** and the build job waits for it (a disabled gate is reported as `skipped` and does
not fail the build). The job checks out the adopter (submodules recursive), checks out `tracker-ref`
into `.tracker` for downstream repositories, fetches the optional tracker submodule tags, and runs
`verify-tooling`, `verify-contract`, and the offline half of `release-gate`.

| Property | Contract gate |
| --- | --- |
| Permissions | called job declares `contents: read` only; the caller's existing `contents`/`packages`/`id-token` write grant already covers it |
| Secrets | none |
| Artifacts | none |
| Failure mode | fails the release before build on missing/stale required callers, tooling drift, or a contract violation |
| Runner | `ubuntu-latest`, 10-minute timeout |
| Default | `false`; an existing caller that re-pins keeps its old behaviour and permission graph |

Why the open-OI check is not in the reusable: the `tracker-contract-exception` OI lookup needs
`issues: read`. GitHub validates the called workflow's permission graph even for jobs that will be
skipped, so declaring it here would invalidate every existing release caller that grants only
contents/packages/id-token — violating the opt-in default. The open-OI half stays an explicit
release-procedure step: `npm run gate:release -- --repo owner/repo` (fails on open OIs). The
reusable gate still covers the contract/required-caller/tooling half.

Adopter caller shape (permissions unchanged; pin both refs to the adopted tag):

```yaml
    uses: presljf/github-project-tracker/.github/workflows/reusable-release.yml@v1.4.0
    with:
      contract-gate: true
      tracker-ref: v1.4.0
```

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
| Tracker audit (`reusable-audit.yml`) | `TRACKER_TOKEN`/App | project **read** + repo/issues read (`project`+`repo` PAT scopes; App Projects+Metadata+Issues read) | repository secret | Optional: advisory mode without the token logs a notice and skips (exit 0); strict mode without it fails with an actionable message. JSON goes to the job log/summary — no artifacts. Never in config/logs/artifacts. |
| Contract metadata (other profile) | `TRACKER_TOKEN`/App | project **read** (Projects + Metadata read) | repository secret | Optional: required only when the reusable-contract `metadata` job runs (`metadata: true`, default). PAT ≤90 days or a GitHub App installation token; pass explicitly by name (never `secrets: inherit`). Fork PRs receive no secret, so callers pass `metadata: false` there; rotate on the tracker token schedule; never in config/logs/artifacts. |
| Release contract gate (opt-in) | `GITHUB_TOKEN` (automatic) | `contents: read` only | automatic | No secret and no `issues: read`; the open-OI half stays in `gate:release --repo` during the release procedure. |
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
- Reusable E2E (`e2e / e2e`) is Playwright on Linux: the browser install step downloads roughly
  0.5–1 GB per run (no browser cache in v1.4.0), `chromium` is the default browser list, and the job
  timeout defaults to 20 minutes. Keep it advisory/path- or label-gated on PRs and budget the
  install time; pass a narrower `browsers` list (or `none` to skip browser setup) for fixture/smoke
  checks.
- Reusable counts (`counts-docs / counts`) is a short Linux job that runs the docs guard only (no
  suite inventory/test execution), so its cost is negligible next to the test suites it documents.
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
| `actions/upload-artifact` | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | `v7.0.2` | Reusable E2E (failure-only artifact upload) |
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
- The v1.4.0 audit-family reusables (`reusable-audit.yml`, `reusable-post-merge-audit.yml`, `reusable-pr-close-guard.yml`) SHA-pin their actions; adopter callers copy `profiles/audit/` examples and pin the template `uses:` ref exactly (never `@main`/floating tags).


## 9. Local parity

Run the same commands CI runs before opening a PR:

```bash
npm test                          # ci / test
npm run validate:config           # ci / build (template repo verification slot)
```

Release contract-gate parity (offline, self-repo safe; add `--repo owner/repo` for the open-OI half):

```bash
npm run verify:tooling -- --root . --contract contract/adoption-contract.json --tracker-config tracker.config.json
npm run verify:contract -- --root . --contract contract/adoption-contract.json
npm run gate:release -- --root . --contract contract/adoption-contract.json --repo owner/repo
```

Audit-family parity (same scripts the reusables run; GitHub API read + token needed):

```bash
GH_TOKEN=$(gh auth token) npm run audit -- --config tracker.config.json --advisory   # tracker-audit / audit
PR_NUMBER=123 GITHUB_REPOSITORY=OWNER/REPO GH_TOKEN=$(gh auth token) \
  npm run audit:post-merge -- --config tracker.config.json                          # post-merge-audit / audit
PR_NUMBER=123 GITHUB_REPOSITORY=OWNER/REPO GH_TOKEN=$(gh auth token) \
  npm run guard:pr-close                                                             # pr-close-guard / guard
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
- Playwright network policy: the reusable E2E install step downloads browsers — that is a setup
  step, not a live third-party assertion (no browser cache exists in v1.4.0). Test assertions must
  not depend on live third-party services: stub external services (or run against local fixtures),
  and treat any live-call suite as remote-only under `verification.remoteOnly[]` (REFERENCE §5.6)
  rather than a required local check.
- E2E artifacts can leak data: upload only on failure (`upload-on-success: false`), keep the default
  7-day retention short, and ensure traces/screenshots/videos contain no credentials, cookies, or
  personal data before the job uploads them. Counts/reusable audit jobs upload no artifacts.
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
4. Migrate the audit family: copy the 1–3 callers you need from [profiles/audit](../profiles/audit/README.md),
   pin the adopted release tag (`@v<version>`; the contract verifier rejects SHA pins), grant the documented caller permissions, and update
   `guard.requiredChecks` + branch protection/ruleset contexts in the **same PR** — the old
   `pr-close-guard` context disappears with the inline copy.
5. Add `dependabot.yml`; confirm version-update PRs arrive.
6. Run dependency review as advisory; enable the private-repo variable only after the platform feature is confirmed.
7. Optionally enable CodeQL via `ENABLE_CODEQL=true`, run on `main`, then rely on schedule/PR runs.

Rollback:

- CodeQL: unset `ENABLE_CODEQL` (or delete the job) — opt-in jobs do not affect existing required checks.
- Dependency review: remove the security caller job or leave it advisory; required checks remain untouched.
- Audit family: revert to the v1.3.2 inline copies (`post-merge-audit.yml`, `pr-close-guard.yml`, `tracker-audit.yml` at that tag) and restore the old protection contexts; a pinned v1.3.2 checkout still carries the inline workflows.
- Required checks: `gh api -X PUT` the previous `required_status_checks` list; inspect with the commands in section 3.3 and record the change.
- Dependabot: remove the ecosystem entry or set `open-pull-requests-limit: 0` to pause without losing configuration.
- Never leave a renamed required check broken silently: update protection in the same maintenance window.

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Required check pending forever | Workflow path-filtered, renamed, or never ran for this PR | Remove path filters from required workflows; update protection to the exact `gh pr checks` names. |
| `workflow not found` / access error for `uses:` | Private template repository access not granted, or relative path wrong | Use copy mode, make the template public/accessible, or fix the relative path. Compare with the working caller in this repo. |
| Called workflow lacks permissions | Called workflows can only downgrade the caller token | Grant the permission on the calling job, or move the job into the caller (as CodeQL does). |
| `pr-close-guard` required check pending after the v1.4.0 upgrade | Protection still requires the retired inline context, or the caller migration is half-done | Migrate the caller and update protection to `pr-close-guard / guard` in the same PR; capture names with `gh pr checks <pr>`. |
| Post-merge audit warns that `statusCheckRollup` is unreadable | Caller is missing `actions: read` / `checks: read` / `statuses: read` | Grant the documented caller permissions; degraded mode is closure-only and is not evidence of a clean pass. |
| `tracker-audit / audit` skipped with a notice | Advisory run has no `TRACKER_TOKEN` | Expected skip; add the project-read token secret if advisory coverage is wanted, or run strict audits token-backed. |
| OI/label 403 after a fork PR merges | Fork merges may lack `issues: write` | Documented pre-existing limitation; review the job summary and open the follow-up manually. |
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


**PR close guard:** `.github/workflows/pr-close-guard.yml` is the thin caller for `reusable-pr-close-guard.yml` (copy-mode example in [profiles/audit](../profiles/audit/README.md)). It validates closing keywords vs task issue kind; completion PRs use closing keywords, partial PRs use Refs/Part of and cannot close. Check context: `pr-close-guard / guard`. The caller grants only `contents: read`, `issues: read`, `pull-requests: read` — the guard script is read-only and fetches the live PR itself, so no write scope is needed.

## Post-merge bypass audit

`.github/workflows/post-merge-audit.yml` is the thin caller for `reusable-post-merge-audit.yml`. It detects merged PRs with failed/missing required checks or invalid closing-keyword usage and opens a `tracker-contract-exception` OI; release must not proceed until resolved. Check context: `post-merge-audit / audit`. It triggers on `pull_request` closed (merged only, filtered in the caller) plus a manual dispatch that passes `pr-number`. The `state == MERGED` revalidation is implemented in `scripts/adopt/cli/post-merge-audit.mjs` through the repo's transport (no raw `gh` calls in the workflows): a dispatch for an open/closed-unmerged PR fails actionably, and the audit re-fetches the PR rather than trusting the event payload.

- **Caller permissions (least privilege):** `contents: read`, `issues: write`, `pull-requests: read`, `checks: read`, `statuses: read`, `actions: read`. The caller must grant this block (called workflows can only downgrade it): `issues: write` opens the OI/label, while `checks: read` + `statuses: read` + **`actions: read`** are required for `statusCheckRollup` — its GraphQL query also resolves `checkSuite.workflowRun`, which needs Actions read (observed on CastDeck run 43276236147: success-but-degraded with only checks+statuses).
- **Required check names:** resolve from `guard.requiredChecks[]` in `tracker.config.json`; the template's audited config sets `["ci / ci-gate", "docs-guard", "pr-close-guard / guard"]` (the retired `pr-close-guard` context is gone). If the key is absent the script falls back to the legacy default (`pr-close-guard`), which no longer matches the reusable context — set the list explicitly. Adopters must set their real check contexts (e.g. CastDeck: `ci / ci-gate`, `tracker-guard / guard`, `pr-close-guard / guard`).
- **Degraded mode:** if `statusCheckRollup` is unreadable due to a permission/API error, the audit prints a loud warning + job summary (`actions: read` + `checks: read` + `statuses: read` guidance), retries a metadata-only PR fetch, enforces the closing-keyword/partial rules only, and exits 0 — it does not fail red and does not open a false check-related OI. Real closing-keyword/partial violations still open an OI; non-permission errors still fail.
- **Output semantics:** the reusable job's `ok` output means the job completed (the audit ran and, for a detected bypass, the OI was opened) — `ok=true` does **not** mean "no bypass". The audit is advisory: a real bypass still completes the job by opening the `tracker-contract-exception` OI, and the release gate blocks while that OI is open.
- **Fork-PR caveat:** a PR merged from a fork can leave the audit run without `issues: write`, so OI creation returns 403. This is a documented pre-existing limitation: a detected bypass is reported in the job log and the job fails loudly at OI creation rather than recording the OI — review and open the follow-up manually.
- **v1.3.0 actions:read correction (historical; fixed in v1.3.2):** the v1.3.0 tag shipped `checks: read` + `statuses: read` guidance before the Actions-read requirement was found live; the correction landed post-tag in the tooling stream (`[Stream] v1.3.1-maintenance`) and is included in v1.3.2. Adopters pinned to v1.3.0 add `actions: read` to their copied caller; CastDeck's caller fix is tracked in its C3 PR.
- **Evidence:** after private-repo adoption, verify a merged PR run completes green (degraded warning acceptable only until the permissions are applied) and record the run URL.


**Dependency approval guard:** `guard:deps` fails dependency/lockfile changes unless `tracker.dependencies.json` contains an OI-linked, reasoned, unexpired approval. Clean-tree preflight blocks task start on uncommitted work; `--allow-dirty` requires a recorded reason.


**Docs/version consistency:** `docs-guard` runs `docs:check`, `guard:gh`, `guard:versions`, `guard:docs`, and config validation.


## Lint/format self-check (T18)

Tracker OS now self-applies ESLint and Prettier: `npm ci`, `npm run lint`, and
`npm run format:check`. A missing or broken lint/format command fails CI rather than succeeding
as a no-op. Dev tooling is approved in `tracker.dependencies.json`; see issue #82.

**Branch hygiene:** install `.githooks` via `npm run hooks:install`; `main-history-guard` runs on
push to main and opens a `tracker-contract-exception` OI for commits without a merged PR. This is
the backstop for `--no-verify` and private repos without branch protection.
