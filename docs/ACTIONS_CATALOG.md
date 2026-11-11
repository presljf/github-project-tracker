# ACTIONS CATALOG

**Docs version:** v1.0.0-docs.1 · Target template: v1.0.0
**Scope:** canonical catalog and contracts for GitHub Actions in Project Tracker OS — workflows, triggers, required checks, tokens/secrets, runners/costs, local parity, reusable-workflow and composite-action interfaces, and the hybrid D adoption model.
**Status:** T09 defines this catalog and the interfaces; T15 implements the workflow/action YAML; T12 validates the docs set before the v1.0.0 tag.
**Availability key:** **now** = exists in this repo today. **planned** = contract defined here, YAML delivered by T15 (sprint 1.0.0.2+). Planned items are never claimed as shipped.

This page is the single source of truth for the Actions layer. The [playbook §10](./GITHUB_PROJECT_TRACKER_PLAYBOOK.md#10-actions--ci-cd-contract) keeps the conceptual model, [REFERENCE §13–16](./REFERENCE.md#13-workflow-catalog-planned-1002) keeps the quick lookup tables, and this catalog keeps the full catalog and stable interfaces. All three must stay consistent.

**Hard rules (apply to every workflow in this catalog):**

- No secrets are ever committed, printed, uploaded as artifacts, or interpolated into shell commands.
- No live third-party calls from automated CI/tests; test doubles and committed fixtures only.
- Sensitive steps are guarded by tag (`v*`), `workflow_dispatch` input, and/or a protected `release` environment.
- Workflows that run on untrusted pull requests get no secrets and a read-only token.
- Third-party actions and reusable workflows are pinned by SHA or exact template release tag — never `@main` or a floating major tag.

---

## 1. How to read this catalog

| Term | Meaning |
|---|---|
| Caller workflow | Thin `.github/workflows/<job>.yml` in the adopting repo. Owns triggers, project inputs, and project-local steps. |
| Reusable workflow | `on: workflow_call` contract hosted in the template repo (`.github/workflows/reusable-<job>.yml`). Generic, versioned, secret-free where possible. |
| Composite action | `.github/actions/<verb-noun>/action.yml` in the template repo; reusable step bundle invoked locally or cross-repo by ref. |
| Required check | Status check enforced by branch protection/ruleset. Must be deterministic, Linux, secret-free, and path-filter-free. |
| Advisory job | Reports pass/fail without blocking merge; promoted to required only after stability is proven. |
| Template version | Exact semver tag of this repo that an adopting project pins (`automation.templateVersion`). |

Three invariants follow from the definitions:

1. **Required checks are never expensive or flaky.** Only deterministic, Linux, no-secret jobs become required.
2. **Contracts are versioned.** Changing a reusable-workflow input/output/secret/permission is a template semver change (see §7.9).
3. **Copying is a fallback, not the model.** Generic jobs are consumed as contracts; only thin callers/config are copied when private cross-repo reuse is blocked (§8).

---

## 2. Workflow catalog

| Workflow (file) | Trigger | Required? | Runner | Purpose | Permissions | Secrets/token | Artifacts | Failure mode |
|---|---|---|---|---|---|---|---|---|
| CI — `ci.yml` → `reusable-ci.yml` | `pull_request`; `push` main; optional `merge_group` | **required** (lint/format/test) | `ubuntu-latest` | Fast correctness gates | `contents: read` | none | failure logs only | Blocks merge |
| E2E — `e2e.yml` → `reusable-e2e.yml` | PR path/label; optional nightly | advisory by default; required only if project opts in | `ubuntu-latest` (Linux default) | Browser/API end-to-end validation | `contents: read` | none | traces/screenshots/videos on failure, 7d | Advisory unless promoted; quarantine flakes, never auto-promote |
| Desktop smoke — `desktop-smoke.yml` → `reusable-desktop-smoke.yml` | PR path/label; `push` main paths; tags `v*`; `workflow_dispatch` | advisory on PR; **required release gate** | macOS (`macos-14` baseline) | Native shell/package smoke | `contents: read` | none (unsigned smoke) | smoke logs/summary, 7d | Advisory on PR; blocks release tag gate |
| Release — `release.yml` → `reusable-release.yml` | `push` tags matching `automation.tagPattern`; `workflow_dispatch` (dry-run default) | **release gate** (not a PR check) | Linux generic/container/package; macOS for signed desktop | Validate version, build, checksum, publish or dry-run | `contents: write` (publish job only); `id-token: write` for OIDC; `packages: write` for container profile | `release` environment secrets; OIDC; `RELEASE_TOKEN` only if org policy requires | archives/dmg/image digest/package + `SHA256SUMS`, 30–90d | Fail closed; dry-run never publishes; tag/version mismatch fails |
| Tracker audit — `tracker-audit.yml` → `reusable-audit.yml` | weekly `schedule`; `workflow_dispatch`; optional advisory push-to-main/PR | advisory first (`workflows.audit.mode: advisory`); required at release gate once stable | `ubuntu-latest` | Tracker invariants via `audit.mjs` | `contents: read` + project read via scoped token | `TRACKER_TOKEN` (project-scoped PAT or GitHub App); absent → skip cleanly | job summary + optional JSON, 14d | Advisory = never blocks; strict = fails release gate; missing token skips advisory |
| Security — `security.yml` (Dependabot + dependency review + optional CodeQL) | PR dependency review; weekly/monthly `schedule`; CodeQL opt-in | Dependabot default; dependency review advisory then required; CodeQL opt-in advisory | `ubuntu-latest` | Dependency/supply-chain/code scanning | `contents: read`; `security-events: write` (CodeQL job only); `pull-requests: write` only if commenting | none | CodeQL SARIF → code scanning; summary otherwise | Dependency-review policy failure when required; CodeQL advisory until stable |
| Docs — `docs.yml` → `reusable-docs.yml` | PR/push paths `docs/**`, `**/*.md`; `workflow_dispatch` | optional advisory; can be required for docs-only repos | `ubuntu-latest` | Markdown fence/link/consistency checks | `contents: read` | none | report summary, 7d | Advisory by default; broken fences/relative links fail |

**Now vs planned:** only `.github/workflows/tracker-audit.yml` exists today (**now**, advisory baseline: weekly cron `0 15 * * 1`, `workflow_dispatch`, `contents: read`, `TRACKER_TOKEN` with clean skip when unset). The remaining callers/reusable workflows/composite actions in this catalog are **planned (T15)**. T15 must preserve the audit workflow's skip semantics when converting it to a thin caller.

### 2.1 CI (required)

- **Purpose:** deterministic lint/format/unit gates that can be enforced on `main`.
- **Wiring:** `ci.yml` thin caller → `reusable-ci.yml`; local ref in this repo, pinned tag/SHA downstream.
- **Trigger detail:** `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`), `push` to `main`, plus `merge_group` when a merge queue is enabled.
- **Required-check set:** `lint`, `format`, `test` as listed in `workflows.ci.requiredChecks`; expose one aggregate gate (`ci-gate`) to keep protection stable (§3.2).
- **Gating:** none. A required workflow must not use `paths`/`paths-ignore`; docs-only PRs still run the cheap CI gate.
- **Permissions/secrets:** `contents: read`, no secrets, `GITHUB_TOKEN` automatic.
- **Artifacts:** none on success; capture failure logs only if they cannot contain secrets. Prefer the job summary.
- **Failure mode:** required check fails → merge blocked.
- **Local parity:** `npm run lint`, `npm run format:check`, `npm test`, `npm run validate:config` (§6).

### 2.2 E2E / integration (optional profile)

- **Purpose:** browser/API end-to-end validation where the product needs it.
- **Trigger detail:** `pull_request` path/label gated; optional nightly `schedule` off-peak.
- **Required status:** advisory by default. Promotion requires: deterministic, <15 min, Linux, no secrets, flake rate recorded over at least a week, and a project decision recorded in the tracker.
- **Permissions/secrets:** `contents: read`; no secrets. External services are stubbed/faked; no live third-party calls in the required path.
- **Artifacts:** traces/screenshots/videos captured on failure only; 7-day retention; no PII or secrets.
- **Failure mode:** advisory failure reported in summary; a required E2E job blocks merge only after promotion.
- **Local parity:** project-defined `npm run e2e` (documented in the project's own docs). If no command exists, do not adopt the workflow.

### 2.3 Desktop/app smoke

- **Purpose:** catch macOS/native shell or packaged-app breakage that Linux CI cannot see.
- **Trigger detail:** `pull_request` gated by path (`apps/desktop/**` or the project's desktop paths) and maintainer label `run-desktop-smoke`; `push` to `main` on the same paths; tags `v*` always; `workflow_dispatch`.
- **Required status:** advisory on PR (cost); required for the release tag gate.
- **Permissions/secrets:** `contents: read`; unsigned smoke uses no secrets. Signing/notarization belongs to the release profile, not smoke.
- **Artifacts:** smoke logs and a short summary, 7 days.
- **Failure mode:** advisory failure annotates the PR; failure on a release tag blocks publishing.
- **Local parity:** project-defined `npm run smoke:desktop` (or documented build+launch command).

### 2.4 Release (release gate)

- **Purpose:** turn a release tag or an explicit dispatch into validated, checksummed, published artifacts — or a safe dry-run.
- **Profiles:** `generic` (GitHub Release assets), `desktop` (signed/notarized macOS), `container` (GHCR image), `package` (npm/PyPI with provenance). The value is a free-form string in config (`workflows.release.profile`); this catalog's canonical name for the GitHub Release profile is `generic` (the example configs also use `github-release` — keep the caller, profile template, and config value identical). Additional project profiles are project-local.
- **Trigger detail:** `push` on tags matching `automation.tagPattern` (`^v\d+\.\d+\.\d+$`); `workflow_dispatch` with `publish` defaulting to `false` (dry-run). No publish path from PR events.
- **Required status:** release gate, not a PR required check.
- **Permissions/secrets:** job-scoped `contents: write`; `id-token: write` only for OIDC publishing; `packages: write` only for the container profile; signing/notarization secrets are environment secrets on protected `release`. All publish steps guarded by tag + environment (§9).
- **Artifacts:** profile artifacts plus `SHA256SUMS` (sorted, deterministic); 30–90 days and as release assets.
- **Failure mode:** fail closed. Dry-run never publishes; tag/version mismatch fails; missing signing secrets skips signing cleanly (ad-hoc fallback documented) rather than publishing unsigned silently.
- **Local parity:** build + `shasum -a 256`/`sha256sum`; generic `gh release create --draft`; desktop `codesign`/`xcrun notarytool` dry-run with placeholder env; container `docker build`; package `npm pack --dry-run` (§6).

### 2.5 Tracker audit (advisory first)

- **Purpose:** run `scripts/github/audit.mjs` against the configured project and report tracker invariant violations.
- **Trigger detail:** existing `tracker-audit.yml` runs Mondays 15:00 UTC and on `workflow_dispatch`; optionally an advisory run on `push` to `main` (throttled by the project) or on PRs once the workflow is stable.
- **Required status:** advisory first; required only at release gates after a stable policy exists (`workflows.audit.mode: required`). Never required on PRs initially.
- **Token:** `TRACKER_TOKEN` (config `workflows.audit.tokenSecret`), project-scoped read access. Absent → skip with `exit 0` in advisory mode; strict mode requires the token and fails with an actionable message if missing.
- **Permissions/secrets:** `contents: read`; token only in `env` for the audit step; never printed or uploaded.
- **Artifacts:** job summary by default; JSON output (`--json`) as a short-retention artifact if configured (14 days). Findings may name issues; treat archives as sensitive.
- **Failure mode:** advisory = exit 0 unless the script/config itself errors; strict = exit 1 on violations at the release gate; misconfiguration fails loudly.
- **Local parity:** `npm run audit -- --config tracker.config.json --advisory`, strict variant with `--strict` (§6).

### 2.6 Security

- **Purpose:** dependency review, Dependabot updates/alerts, and optional CodeQL code scanning.
- **Trigger detail:** Dependabot config runs on its own schedule; dependency review on `pull_request`; CodeQL on PR/push/schedule when opted in.
- **Required status:** Dependabot is never a required check (it opens PRs). Dependency review starts advisory, can become required after the policy/license/severity thresholds are tuned. CodeQL is opt-in and advisory first.
- **Permissions/secrets:** `contents: read`; `security-events: write` only on the CodeQL job; `pull-requests: write` only if the workflow must comment (prefer job summaries). No secrets.
- **Artifacts:** SARIF uploaded to code scanning (CodeQL); dependency-review summary otherwise.
- **Failure mode:** required dependency review blocks new vulnerable/high-severity dependencies; CodeQL advisory until stable; Dependabot never blocks merge by itself.
- **Local parity:** `npm ls --all`, optional `npm audit --audit-level=high` (network; advisory only), optional local CodeQL CLI (§6).

### 2.7 Docs (optional)

- **Purpose:** catch broken fences, relative links, and Markdown consistency in docs-heavy repos.
- **Trigger detail:** PR/push path filters on `docs/**`, `**/*.md`, `README.md`; `workflow_dispatch`.
- **Required status:** optional advisory; may be required for docs-only repos once stable.
- **Permissions/secrets:** `contents: read`; no secrets.
- **Artifacts:** job summary/report, 7 days.
- **Failure mode:** advisory by default; when required, broken fences/relative links fail the PR. External-link checking is opt-in and advisory only (it makes live calls and is flaky).
- **Local parity:** `git diff --check`; fence-parity check; Markdown lint if the project already depends on it (§6).

---

## 3. Trigger and required-check contract

### 3.1 Trigger matrix

| Event / filter | CI | E2E | Desktop smoke | Release | Tracker audit | Security | Docs |
|---|---|---|---|---|---|---|---|
| `push` to `main` | required | optional | path-gated | — | optional advisory | CodeQL if enabled | path-gated |
| `push` to other branches | — | — | — | — | — | — | — |
| `pull_request` | required | path/label | path/label | — | optional advisory | dependency review | path-gated |
| Tag `v*` | required gate | release gate | release gate | release gate | advisory gate | — | — |
| `schedule` (UTC cron) | — | optional nightly | — | — | weekly | Dependabot/CodeQL | — |
| `workflow_dispatch` | optional | optional | optional | dry-run default | rerun | optional | optional |
| `merge_group` | required if merge queue | — | — | — | — | — | — |
| Fork `pull_request` | required, no secrets | advisory, no secrets | maintainer-approved, no secrets | never runs | skipped | dependency review only | safe |

Rules:

- `schedule` runs on the default branch only and is disabled automatically after 60 days of repository inactivity — re-enable it explicitly after quiet periods.
- First-time fork contributors need maintainer approval before workflows run; required checks stay pending until approval, so reviewers should not expect green checks on an unapproved fork PR.
- `repository_dispatch` and cross-repo triggering are deliberately out of scope: they add token/attack surface with no v1.0.0 need.
- `pull_request_target` is not used for untrusted code. If a triage workflow ever needs it, it must not check out PR head, must not use secrets, and requires a security review recorded on the issue.
- Tag filters use `tags: ['v*']` in the caller plus a strict `automation.tagPattern` regex check in the release job; `v*` alone is not the version contract.

### 3.2 Required-check / branch-protection / ruleset contract

| Protection rule | Setting | Notes |
|---|---|---|
| Target | `main` | Release branches inherit only if the project creates them. |
| Require a pull request | enabled | Solo-maintainer admin bypass only for documented emergencies; record the exception. |
| Required status checks | aggregate `ci-gate` (coverage: lint, format, test) | Linux, deterministic, secret-free, no path filters, target <10 min. |
| Require up-to-date branch | recommended | Prevents green-on-stale-base merges; may be relaxed for high-velocity repos with linear history. |
| Require linear history | recommended | Squash-merge policy matches the tracker lifecycle. |
| Block force pushes / deletions | enabled on `main` and tags `v*` | Tags are release inputs; never move or delete them after publish. |
| Tag ruleset `v*` | restrict creation/update/deletion to maintainers | Protects the release authorization boundary. |
| Environment `release` | required reviewers + deployment rules tags `v*` only | Holds publish/signing secrets; never used by PR jobs. |
| Merge queue | optional; add `merge_group` to CI triggers first | Without the trigger, a queue stalls waiting on a check that never starts. |

**Required-check rules:**

1. **One aggregate gate.** Required checks should be a single job (`ci-gate`) that `needs` the real jobs and fails if any did not succeed. This keeps protection stable when internal job names change.
2. **Exact names are captured from a live run.** Branch protection stores the display string (typically `<workflow name> / <job name>`). Snapshot it from one green PR before enabling; never guess.
3. **Renaming a job is a breaking change.** Update the protection rule in the same PR that renames the check; otherwise merges stall on an expected check that no longer reports.
4. **No `paths`/`paths-ignore` on required workflows.** A skipped workflow can leave the required check pending. Keep the required workflow always-on and cheap; put path/label filters on the expensive jobs it calls.
5. **Advisory jobs are not required.** Desktop smoke on PRs, audit, E2E before promotion, and CodeQL start advisory. Promotion is a recorded decision with evidence.
6. **`requiredChecks` in config mirrors the contract.** `workflows.ci.requiredChecks` names the jobs that must pass; keep it in sync when job names change (manual drift check today, automated audit drift check planned), and T15 documents the delivered job names.

**Availability caveat (observed):** this template repo is private on a plan where the rulesets and branch-protection APIs return "Upgrade to GitHub Pro or make this repository public" (403 on 2026-11-11). Until the repo is public or upgraded, the contract above is documented and enforced by process (PR template checklist, advisory audit, status discipline), not by GitHub. Do not silently drop required checks; enable the ruleset as soon as the plan/visibility permits. Downstream projects must record the same caveat in their adoption notes if they hit it.

### 3.3 Path and label gating for expensive jobs

| Change scope | Runs | Skips / notes |
|---|---|---|
| `docs/**`, `**/*.md` | CI gate (cheap), docs check | Desktop, E2E, release |
| `.github/workflows/**`, `.github/actions/**`, `scripts/**` | CI gate + workflow lint | Product jobs; require a maintainer review |
| Product code paths (project-defined) | CI + path/label-gated E2E and desktop smoke | Release |
| Tag `v*` | All release gates required | Nothing skipped silently |
| Fork PR | Required no-secret Linux checks | Any job needing secrets |

Label and path rules:

- Labels are **convenience, not a security boundary**. Only maintainers may apply `run-e2e` / `run-desktop-smoke`; gating uses `contains(github.event.pull_request.labels.*.name, '<label>')` and a `labeled` activity type.
- A label added after the run does not retrigger the job automatically — maintainers re-run the workflow after adding the label.
- Paths gate costly jobs in the caller (`on.pull_request.paths` for optional workflows) or at job level via a `changes` job output. Required workflows stay trigger-only.
- Release and audit gates never depend on labels or paths.

---

## 4. Token and secret matrix

### 4.1 Matrix

| Consumer | Identity / token | Permissions or scopes | Storage | Rotation | Notes |
|---|---|---|---|---|---|
| CI, E2E, desktop smoke | `GITHUB_TOKEN` | `contents: read` | automatic | per-run, ephemeral | Read-only for fork PRs regardless of declared permissions |
| Tracker audit (advisory) | `TRACKER_TOKEN` — classic PAT with `project` (+ repo read) or fine-grained Projects read + Metadata read; or a GitHub App installation token with Projects: read (org-owned projects) | project read | repo/org secret, or environment secret for release-gate mode | ≤90 days for PATs; App tokens 1 h | Optional: workflow skips cleanly when absent. User-owned Projects v2 generally need an OAuth/PAT `project` scope; validate App access on your owner type |
| Tracker audit (strict release gate) | same | project read | `release` environment secret | same | Audit is read-only; no write scopes needed |
| Release publish (generic) | `GITHUB_TOKEN` | `contents: write` (publish job only) | automatic | per-run | Protected tag + `release` environment; never a PAT |
| Desktop signing/notarization | environment secrets: certificate `.p12` (base64), certificate password, Apple ID, app-specific password; team ID is a non-secret repo/environment variable | n/a | `release` environment secrets/variables | certificate ≤1 year; rotate passwords | Skipped cleanly when absent; values never printed or uploaded |
| Container publish (GHCR) | `GITHUB_TOKEN` | `contents: read`, `packages: write` | automatic | per-run | Publish job only, tag/dispatch + environment |
| Package/cloud publish | OIDC (`id-token: write`) preferred; `NPM_TOKEN` only if trusted publishing is unavailable | minimal registry/cloud role | environment secret if a static token is unavoidable | short-lived preferred | Pin trust policy to repo, tag, and `release` environment |
| Security dependency review | `GITHUB_TOKEN` | `contents: read`; `pull-requests: write` only if commenting | automatic | per-run | Prefer job summary over PR comments |
| CodeQL | `GITHUB_TOKEN` | `contents: read`, `security-events: write` | automatic | per-run | CodeQL job only; opt-in |
| Docs checks | none | `contents: read` | — | — | No external link checks by default |

Least-privilege note: the shipped audit is read-only and needs project read only. Some planning notes mention project read/write for a possible future fix mode — grant write only if that mode is explicitly implemented. Secret names are examples and placeholders: `TRACKER_TOKEN` is configurable via `workflows.audit.tokenSecret`; signing/publish names may differ per project, but the *contract* (name, scope, where it is stored) must be documented in the project's tracker config/notes. Never put a real value in this repo, config, docs, comments, logs, or artifacts.

### 4.2 Least-privilege rules

1. Start from `permissions: {}` at workflow level and grant per job — default allow is forbidden.
2. Fork/untrusted PRs get no secrets. Never use `pull_request_target` to regain them on checked-out untrusted code.
3. `secrets: inherit` is reserved for first-party called workflows in the same repo; otherwise pass explicit named secrets.
4. Publishing/signing runs only from a tag or an explicit dispatch, inside the protected `release` environment, with required reviewers.
5. Prefer OIDC/short-lived credentials for cloud/package publishing; no long-lived cloud keys in repositories when OIDC can be used.
6. Mask derived values with `::add-mask::`; never `echo` a secret; never pass secrets through command-line arguments that appear in logs.
7. Never cache, upload, or archive secrets; purge caches/artifacts if a secret is suspected to have leaked, rotate it, and report privately per [SECURITY.md](../SECURITY.md).
8. The audit runner is read-only and uses `gh` against the configured repo/project only; it must not make live third-party calls.
9. Rotate PATs quarterly or on owner/repo change; revoke unused tokens; App installation tokens rotate automatically.
10. Public template repos never hold adopter secrets; called workflows receive only the caller's explicitly passed secrets.

### 4.3 Environments and OIDC

- One protected environment for publishing: `release` (deployment rule: tags `v*` only; required reviewer). Optional `package-publish` if package publishing has a different approval group.
- Environment secrets are available only to jobs that declare `environment: release`; PR jobs never declare it.
- OIDC jobs grant `id-token: write` at job level only. Cloud trust policies must pin repository, ref/tag, and environment (`repo:OWNER/REPO:environment:release`) so a stolen workflow file cannot mint tokens for `main`.
- If a publishing profile cannot use OIDC, document the static-secret exception, its scope, and its rotation in the project tracker config — and prefer splitting it into its own environment.

---

## 5. Runner, cost, and caching guidance

### 5.1 Runner selection

| Runner | Relative billable minutes | Use for | Notes |
|---|---|---|---|
| `ubuntu-latest` | 1× (baseline) | CI, E2E, audit, security, docs, generic release | Default for every job unless a product constraint says otherwise |
| `windows-latest` | ≈2× | Windows-only desktop smoke/release | Only when the product ships Windows; otherwise skip |
| `macos-14` / `macos-15` | ≈10× | Desktop smoke and signed/notarized release only | Scarce and slow to provision; never on every push/PR |
| Larger runners | per-minute, higher | Heavy parallel builds if justified | Requires plan support; document the cost decision |
| Self-hosted | variable infrastructure cost | Private/trusted-only workloads | Never for public forked PRs without full isolation; ephemeral runners only |

Approximate multipliers reflect GitHub-hosted runner billing and may change; check the current [Actions billing documentation](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions). Public repos' standard runners are free subject to fair use; private repos consume the plan's included minutes — this template repo is private, so treat every minute as budgeted.

### 5.2 Cache matrix

| Cache | How | Key | Notes |
|---|---|---|---|
| npm dependencies | `actions/setup-node` built-in `cache: npm` | lockfile hash | Cache the npm cache directory; do not cache `node_modules` across OS/Node versions |
| pnpm/yarn store | setup action cache or `actions/cache` | lockfile hash | Same key discipline; separate OS keys |
| Playwright browsers | `actions/cache` on the browser cache dir | Playwright version + lockfile | ~0.5–1 GB; only in E2E/desktop jobs, never in CI gate |
| Build outputs (Turbo/Nx/etc.) | project cache or `actions/cache` | lockfile + source hash | Only for expensive builds; document invalidation |
| Docker layers | buildx `type=gha` | Dockerfile + lockfiles | Release/container jobs only |
| Lint caches | `.eslintcache`/tool cache | config + lockfile | Optional; small win, beware stale caching |

Rules: caches are per-OS and per-key; never cache secrets, tokens, keychains, or signed artifacts; respect the repo cache size/eviction limits; bump the key when the tool version changes; caches do not replace lockfile-pinned installs (`npm ci`).

### 5.3 Concurrency, timeouts, retention

| Workflow | Concurrency group | Cancel in progress | Timeout |
|---|---|---|---|
| CI | `ci-${{ github.workflow }}-${{ github.ref }}` | yes | 15 min |
| E2E | `e2e-${{ github.workflow }}-${{ github.ref }}` | yes | 20 min |
| Desktop smoke | `desktop-smoke-${{ github.workflow }}-${{ github.ref }}` | yes | 30 min |
| Release | `release-${{ github.ref }}` | **no** | 60 min |
| Tracker audit | `tracker-audit` | **no** | 10 min |
| Security/docs | `security-${{ github.ref }}` / `docs-${{ github.ref }}` | yes | 15 / 5 min |

- Cancel superseded PR runs; never cancel a tag or release run halfway through publishing.
- Artifact retention: 7 days for advisory failure logs/screenshots; 14 days for audit JSON; 30–90 days for release checksums/artifacts. Keep job summaries for the human-readable record.
- Cost controls beyond caching: label/path gating, schedules weekly not hourly, early-failing lint before tests, matrix minimization, single OS unless required, and no artifact upload on success unless it is a product artifact.

---

## 6. Local-parity commands

Every workflow must be reproducible locally with no CI-only steps; the commands below are the contract. Default command strings live in `profiles.node.commands` in `tracker.config.json` (`lint`, `format`, `test`, `e2e`, `verify`, `build`) — the table shows the defaults. Commands marked **project-defined** are placeholders that the adopting project must document in its tracker config/notes — a workflow without a local equivalent is not adopted.

| Workflow | Local command | Expected result | Availability |
|---|---|---|---|
| CI | `npm run lint` · `npm run format:check` · `npm test` · `npm run validate:config` | lint/format exit 0; tests report `# pass N` / `# fail 0`; config prints `OK  <file>` lines | `npm test`/`validate:config` **now**; lint/format from the [node profile](../profiles/node/README.md#command-mapping) once profile scripts are merged into the project |
| E2E | project-defined `npm run e2e` | exit 0; HTML report path printed | project-defined |
| Desktop smoke | project-defined `npm run smoke:desktop` | exit 0; smoke summary printed | project-defined |
| Release (generic) | build, then `sha256sum`/`shasum -a 256` on artifacts; `gh release create --draft` | sorted `SHA256SUMS`; draft release URL | project-defined; `gh` **now** |
| Release (desktop) | `codesign --verify --deep --strict <app>`; `xcrun notarytool submit --wait` (dry credentials) | signature valid; notary status accepted or skipped when secrets absent | project-defined |
| Release (container) | `docker build -t <image> .`; `docker run` smoke | image builds and starts locally | project-defined |
| Release (package) | `npm pack --dry-run` | tarball file list, no secrets or extra files | project-defined |
| Tracker audit | `npm run audit -- --config tracker.config.json --advisory`; strict: add `--strict` | `Tracker audit — <repo> (advisory)`; violations listed; advisory exit 0, strict exits 1 on violations | **now** |
| Security | `npm ls --all`; optional `npm audit --audit-level=high` | dependency tree resolves; audit findings listed (network, advisory only) | `npm ls` **now**; audit optional |
| Docs | `git diff --check`; fence parity; optional Markdown lint | no output from `git diff --check`; `balanced` fence count | **now** |

Docs fence-parity check (no external dependency):

````bash
git diff --check
awk '/^```/{n++} END {print n, (n % 2 ? "UNBALANCED" : "balanced")}' docs/ACTIONS_CATALOG.md
````

Additional notes:

- The template repo's own tests run with `npm test` (Node's built-in test runner); `npm run validate:config` validates the example configs.
- The Node profile is merged into adopting projects from `profiles/node/package.example.json`; do not overwrite project scripts wholesale ([profile README](../profiles/node/README.md)).
- Release/desktop commands using credentials are documented as dry-runs only; never paste real secrets into a terminal history or issue.
- External link checking is not a default local gate (network, flaky); review relative links with the docs command above and rendered Markdown previews.

---

## 7. Reusable workflow and composite action contracts

All contracts below are **documentation** until T15 lands the YAML files. Nothing in this section is a shipped workflow.

### 7.1 Naming and ref conventions

| Item | Convention |
|---|---|
| Reusable workflow file | `.github/workflows/reusable-<job>.yml` |
| Thin caller file | `.github/workflows/<job>.yml` (same base name) |
| Composite action | `.github/actions/<verb-noun>/action.yml` (e.g. `setup-node-cache`, `checksum`, `sign-notarize-macos`) |
| In-repo caller ref | `./.github/workflows/reusable-ci.yml` (local, always HEAD) |
| Downstream caller ref | `OWNER/REPO/.github/workflows/reusable-ci.yml@<exact-tag-or-sha>` |
| Composite ref | `./.github/actions/checksum` locally; `OWNER/REPO/.github/actions/checksum@<exact-tag-or-sha>` downstream |
| Pin preference | Exact release tag (`v1.0.0`) by default; full commit SHA when the project needs an immutable pin or the tag is not protected |

Called workflows run in the caller repository's context, with caller-provided inputs/secrets and a caller job permission ceiling. Callers must grant at least the permissions declared by the contract; the called workflow can never elevate beyond the caller grant.

### 7.2 `reusable-ci.yml` — required CI contract

| Interface | Definition |
|---|---|
| Inputs | `node-version` string default `'22'`; `package-manager` string default `npm`; `working-directory` string default `.`; `run-lint` boolean default `true`; `run-format` boolean default `true`; `run-test` boolean default `true`; `cache` boolean default `true` |
| Outputs | `checks-passed` — `'true'` when every enabled check succeeded |
| Secrets | none (`secrets: {}`) |
| Permissions | caller grants `contents: read`; called workflow declares `contents: read` |
| Runner | `ubuntu-latest`, timeout 15 min |
| Artifacts | none by default |
| Stability | adding an optional input/output is minor; adding a required input or renaming/removing one is major |

```yaml
# Contract: .github/workflows/reusable-ci.yml (T15 authors the file)
on:
  workflow_call:
    inputs:
      node-version:
        description: Node.js version; template default is 22
        type: string
        required: false
        default: '22'
      package-manager:
        description: Package manager used for install, cache, and scripts
        type: string
        required: false
        default: npm
      working-directory:
        description: Directory containing package.json
        type: string
        required: false
        default: .
      run-lint:
        description: Run the lint command
        type: boolean
        required: false
        default: true
      run-format:
        description: Run the formatting check
        type: boolean
        required: false
        default: true
      run-test:
        description: Run the unit test command
        type: boolean
        required: false
        default: true
      cache:
        description: Enable dependency caching
        type: boolean
        required: false
        default: true
    outputs:
      checks-passed:
        description: Set to true when all enabled checks passed
        value: ${{ jobs.ci-gate.outputs.passed }}
    secrets: {}
permissions:
  contents: read
```

Caller snippet:

```yaml
# Thin caller in the adopting repo: .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  ci:
    uses: presljf/github-project-tracker/.github/workflows/reusable-ci.yml@v1.0.0
    with:
      node-version: '22'
      package-manager: npm
```

Required-check mapping: T15 should expose a stable gate job name (`ci-gate`) and document the exact protection string; downstream projects keep the same check names in `workflows.ci.requiredChecks`.

### 7.3 `reusable-e2e.yml` — E2E contract (optional profile)

| Interface | Definition |
|---|---|
| Inputs | `node-version` default `'22'`; `working-directory` default `.`; `e2e-command` default `npm run e2e`; `browser` default `chromium` (or project matrix string); `artifact-retention-days` number default `7`; `upload-on-success` boolean default `false` |
| Outputs | `e2e-passed`, `artifact-name` |
| Secrets | none |
| Permissions | `contents: read` |
| Runner | `ubuntu-latest`; project may add a macOS/Windows variant only with a documented need |
| Artifacts | traces/screenshots/videos on failure; retention from input |
| Stability | optional-input additions minor; command/browser default changes are minor but documented in release notes; output renames major |

### 7.4 `reusable-desktop-smoke.yml` — desktop smoke contract

| Interface | Definition |
|---|---|
| Inputs | `runner-label` string default `macos-14`; `working-directory` default `.`; `build-command` string required; `smoke-command` string required; `artifact-retention-days` number default `7` |
| Outputs | `smoke-passed`, `artifact-name` |
| Secrets | none |
| Permissions | `contents: read` |
| Runner | macOS (input-controlled); timeout 30 min |
| Artifacts | smoke logs + summary |
| Stability | command inputs are required strings; changing their semantics is major; runner-label default changes are minor |

### 7.5 `reusable-release.yml` — release contract

| Interface | Definition |
|---|---|
| Inputs | `profile` string default `generic` (mirrors `workflows.release.profile`); `tag-pattern` string default `^v\d+\.\d+\.\d+$`; `dry-run` boolean default `true`; `artifact-globs` string (multiline) default `dist/**`; `checksum-algorithm` string default `sha256`; `publish` boolean default `false` |
| Outputs | `version`, `artifacts`, `checksums-file`, `release-url` (empty on dry-run), `dry-run` |
| Secrets | `RELEASE_TOKEN` (optional, only when org policy forbids the default token for publishing); `MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_PASSWORD` (optional, desktop profile); `NPM_TOKEN` (optional, package profile when OIDC trusted publishing is unavailable) — all `required: false`; team ID / signing identity are non-secret inputs |
| Permissions | caller grants `contents: write`; `id-token: write` only for OIDC publish jobs; `packages: write` only for container profile |
| Environment | called workflow declares `environment: release`; callers cannot set the environment on a reusable-workflow job |
| Runner | `ubuntu-latest` generic/container/package; macOS for desktop |
| Artifacts | profile artifacts + `SHA256SUMS`; release assets on publish |
| Stability | profile enum additions minor; changing dry-run default, tag semantics, or output names major; required secret additions major |

Input semantics: `dry-run: true` (the default) performs the full build/validation/checksum without publishing; `publish: true` is only honored when `dry-run` is false and the ref is a matching tag or an explicit dispatch. Guards: all publish steps run only when `github.ref` matches the tag pattern or `workflow_dispatch` explicitly requested publish, inside the `release` environment. Missing signing secrets are a documented skip (ad-hoc fallback), never a silent unsigned publish.

### 7.6 `reusable-audit.yml` — tracker audit contract

| Interface | Definition |
|---|---|
| Inputs | `config-path` string default `tracker.config.json`; `mode` string enum `advisory`/`strict` default `advisory`; `json` boolean default `true` |
| Outputs | `violations-count`, `ok` (`'true'`/`'false'`), summary text |
| Secrets | `TRACKER_TOKEN` (`required: false`; advisory skips cleanly when unset, strict fails with a configuration message) |
| Permissions | `contents: read`; project read comes from the token |
| Runner | `ubuntu-latest`, timeout 10 min |
| Artifacts | job summary by default; optional JSON, 14-day retention |
| Stability | new optional inputs minor; mode/default changes or output renames major; token requirement changes major |

Existing behavioral contract (preserve in T15): when `TRACKER_TOKEN` is empty the advisory run prints a skip message and exits 0; invalid config/errors exit 1; advisory violations exit 0; strict violations exit 1.

### 7.7 `reusable-security.yml` and `reusable-docs.yml`

| Interface | Definition |
|---|---|
| Security inputs | `dependency-review` boolean default `true`; `codeql` boolean default `false`; `codeql-languages` string default `javascript-typescript`; `fail-on-severity` string default `high` |
| Security outputs | `dependency-review-result`, `codeql-status` |
| Security secrets | none |
| Security permissions | `contents: read`; `security-events: write` on the CodeQL job only; optional `pull-requests: write` only if commenting |
| Docs inputs | `paths` string default `docs/**/*.md README.md`; `check-links` string enum `relative`/`none` default `relative`; `markdownlint` boolean default `false` |
| Docs outputs | `docs-passed` |
| Docs secrets | none |
| Docs permissions | `contents: read` |
| Stability | both follow the same semver rules: optional additions minor, required/renamed interfaces major |

External-link checking is not part of the default docs contract: it makes live network calls and is advisory-only if a project opts in. CodeQL ships disabled by default; enabling it is a project decision recorded in the tracker.

### 7.8 Composite action interfaces

Composite actions have `inputs` and `outputs` only — they cannot declare `secrets`. Callers pass secret values explicitly as inputs and guard their use; the action must never assume a secret exists.

#### `setup-node-cache`

| Interface | Definition |
|---|---|
| Inputs | `node-version` default `'22'`; `package-manager` default `npm`; `working-directory` default `.`; `cache` boolean default `true`; `install-dependencies` boolean default `true`; `registry-url` default `''` (empty = no registry auth) |
| Outputs | `node-version`, `cache-hit` |
| Secrets | none; registry auth stays in the caller and is configured before/after the action |
| Consumers | `reusable-ci.yml`, `reusable-e2e.yml`, desktop smoke |
| Stability | optional inputs minor; install/cache default changes minor + release-note mention; removing/renaming an input major |

#### `checksum`

| Interface | Definition |
|---|---|
| Inputs | `paths` string (newline-separated globs, required); `algorithm` string enum `sha256`/`sha512` default `sha256`; `output-file` default `SHA256SUMS`; `working-directory` default `.` |
| Outputs | `checksums-file`, `digest-count` |
| Secrets | none |
| Consumers | every release profile |
| Stability | algorithm/output-name changes major (downstream verification depends on them); optional inputs minor |

Behavior contract: deterministic sorted output, cross-platform (`sha256sum` on Linux, `shasum -a 256` on macOS), fail if no files match, never overwrite an existing checksum file silently.

#### `sign-notarize-macos`

| Interface | Definition |
|---|---|
| Inputs | `artifact-path` (required); `signing-identity` default `Developer ID Application`; `team-id` default `''`; `notarize` boolean default `false`; `dry-run` boolean default `true`; `keychain-profile` default `''` |
| Secret-valued inputs | `certificate-p12` (base64), `certificate-password`, `apple-id`, `apple-app-password` — all `required: false`; empty means "skip signing cleanly" |
| Outputs | `signed-path`, `notarized` (`'true'`/`'false'`) |
| Permissions | inherits the release job (`contents: write`); no additional permissions |
| Consumers | desktop release profile only |
| Stability | renaming an input/output major; adding optional inputs minor; guard-skip behavior is part of the contract |

Guard contract: callers invoke this action only from the tag/dispatch release job inside the protected `release` environment, with `if: ${{ inputs.dry-run == false && inputs.certificate-p12 != '' }}`. The action masks secret-derived values with `::add-mask::`, never echoes them, and returns a skipped result when credentials are absent. It performs `codesign`, `xcrun notarytool submit --wait`, and `xcrun stapler staple`; dry-run mode does not contact Apple.

Composite action rules:

1. Every `run` step declares `shell: bash`; nested `uses` are pinned by SHA.
2. Errors fail the step; do not swallow a signing/checksum failure into a success path.
3. Inputs are validated at the top (required values, supported enums) with actionable messages.
4. No credentials in `action.yml`, defaults, examples, or logs; secret values arrive at runtime as inputs.
5. Composite actions are consumable locally (`./.github/actions/...`) or cross-repo (`OWNER/REPO/.github/actions/...@tag`); private-repo access follows the same validation/fallback as reusable workflows (§8).

### 7.9 Versioning, ref pinning, and stability policy

| Change | Template version bump | Downstream action |
|---|---|---|
| Add optional input/output or an optional secret | **minor** (`v1.1.0`) | Update pin when convenient; no caller change required |
| Add a required input or change a default that alters behavior | **major** (`v2.0.0`) or major-with-deprecation | Update caller/config in the same upgrade PR |
| Rename/remove an input, output, secret, or workflow file | **major** | Migration note; old interface kept one minor with deprecation warning where feasible |
| Permission requirement increases | **major** if callers must change grants; minor if not | Update caller `permissions:` and document |
| Required-check job name changes | **major** for branch protection | Update ruleset in the same PR that upgrades the pin |
| Docs-only fix/typo in this catalog | patch or docs version | none |

- Callers pin an exact template release tag or full commit SHA. `@main` and floating major refs are prohibited.
- Tags are protected by a repo tag ruleset (when the plan allows), so a pinned tag cannot move silently. If tag immutability cannot be guaranteed, pin the SHA.
- This catalog's docs version moves with the template release; a contract change must update this page, the [REFERENCE](./REFERENCE.md#13-workflow-catalog-planned-1002) summary, and the changelog in the same release.
- Deprecations: announce in the release notes, keep the old interface one minor release with a warning in the job summary, then remove in the next major.

---

## 8. Hybrid D adoption model

"Hybrid D" means: **reusable contracts for generic jobs + thin copied callers/profile files for project-specific glue**. The template owns interfaces and implementations; adopting projects own triggers, config, and build/publish specifics. There is no automatic template sync.

### 8.1 Model

```text
Template repo (presljf/github-project-tracker, pinned vX.Y.Z)
├── .github/workflows/reusable-*.yml        reusable contracts (§7)
├── .github/actions/<name>/action.yml       composite contracts (§7.8)
└── config schema/example + docs            versioned interfaces
                    │
                    ▼  (reusable mode: cross-repo ref @exact pin)
Adopting repo (thin caller + project config)
├── .github/workflows/ci.yml                caller: triggers/inputs/permissions
├── .github/workflows/release.yml           caller: project profile/commands
├── .github/actions/… (only if copied)      copy fallback, origin recorded
└── tracker.config.json                     mode/ref/profile/tokenSecret/templateVersion

If private cross-repo reuse is blocked → copy thin callers/composite actions
(never edit reusable contracts locally), pin the template version, upgrade via UPGRADING.
```

### 8.2 Mode decision and config mapping

| Situation | Mode | Config / record |
|---|---|---|
| Private/org access to template reusable workflows validated (scratch-repo test) | `reusable` | `workflows.ci.mode: reusable`, `workflows.ci.ref: <exact pin>`, `workflows.release.ref: <pin>` |
| Cross-repo reuse blocked or policy forbids it | `copy` | `workflows.ci.mode: copy`; record copied files + origin template version in project docs |
| Generic jobs reusable, release/signing project-specific | mixed | per-workflow mode; record each file's origin/mode |
| Template repo published public | `reusable` (or copy, optionally) | same pins; public refs validated from a second scratch repo |

The config keys come from `schemas/tracker.config.schema.json` and `tracker.config.example.json`; `automation.templateVersion` remains the exact template pin in every mode.

### 8.3 Pinning and no auto-sync

- Pin the exact template version (`automation.templateVersion`, `feedback.pinnedVersion`) and exact workflow refs; never track `main`.
- No scheduled sync workflow and no bot PR that rewrites copied files. Upgrades are deliberate PRs following [UPGRADING](./UPGRADING.md#upgrade-procedure): read changelog/migration, update pins/copied files, validate config, run local parity + CI, record the new pin.
- Dependabot may propose third-party action pin updates, but those are reviewed like any PR and never auto-merged. It does not sync template contracts/copied files.
- Audit invariants include a pinned template version (a missing pin is flagged); detecting an out-of-date pin is a manual upgrade-guide check today.

### 8.4 Copy fallback procedure

1. Run the private-access validation (§8.5). If any required ref fails, choose `copy` — do not fork the template or edit reusable contracts locally.
2. Copy only the thin caller(s) and the composite action directory from the pinned template tag (download the release archive, do not copy from `main`).
3. Record in the project docs/config: copied file list, origin template version/ref, local overrides, and `workflows.ci.mode: copy`.
4. Preserve contract names and guards: same input/secret names, same dry-run/tag/environment guards, same permission model. Project-specific changes are minimal, commented, and listed as overrides.
5. Run local parity (§6), then one advisory PR run before promoting/requiring anything.
6. On upgrade: re-copy fresh files, re-apply the documented overrides, diff-review, and run the same validation; never hand-merge silently.

### 8.5 Private cross-repo reuse validation (before choosing reusable mode)

Run these on a scratch private repo with read access to the template that pins the release; record commands/results in the release or adoption tracker:

- [ ] Reusable workflow ref parses from the scratch repo: `uses: presljf/github-project-tracker/.github/workflows/reusable-ci.yml@v1.0.0` → runs, or fails with an explicit visibility/permission error (the error text is the evidence).
- [ ] Composite action ref works: `uses: presljf/github-project-tracker/.github/actions/checksum@v1.0.0`.
- [ ] Caller-granted permissions are sufficient; called workflow cannot exceed them.
- [ ] Explicit secret passing works (`secrets: TRACKER_TOKEN: ${{ secrets.TRACKER_TOKEN }}`), and the audit workflow skips cleanly when the secret is absent.
- [ ] Required check display names match the documented contract after one green run.
- [ ] Fork PR run receives no secrets and read-only token behavior is as expected.
- [ ] Environment `release` approval is required before publish; dispatch dry-run leaves no release behind.
- [ ] Personal-account vs organization behavior recorded (private cross-repo calls are commonly limited to the same organization and may be blocked by policy; personal private repos generally cannot share across repos).

If access fails: switch to `copy` (§8.4) and note the failure. This never blocks a template release — it only changes the adoption mode.

### 8.6 Public-template fallback

Publish the template repo public when private cross-repo reuse is blocked/policy-forbidden **and** copy-mode maintenance is judged worse than publishing. Publishing is a release-gate decision, not an automatic outcome.

Pre-public checklist:

- [ ] MIT license in place at publication (governance plan: MIT at/public transition) and `LICENSE` committed.
- [ ] `SECURITY.md` private reporting channel current; no secrets in working tree or git history (scan history before publishing).
- [ ] Examples/docs sanitized; no personal/org-internal data, real IDs, or tokens.
- [ ] All third-party actions pinned by SHA; workflows validated by `actionlint` and a secret-less run.
- [ ] Callers validate from a second scratch repo (public template called by a private repo, with caller-owned secrets only).
- [ ] Contract versioning/changelog published; adopters pin exact tags/SHAs.
- [ ] Public repo standard runners confirmed sufficient (free for public repos subject to fair use) or runner cost accepted.
- [ ] Template holds no adopter secrets; called workflows only receive what the caller explicitly passes.

Post-public validation: repeat the §8.5 checklist against the public template, verify required-check names and secret-less CI on a fork PR, and record the evidence in the release gate issue. The public fallback is documented here so private-access uncertainty never becomes a hidden blocker.

---

## 9. Guardrails: no secrets, no live calls, guarded publishing

### 9.1 Required guards

| Risk | Required control |
|---|---|
| Publishing from a branch/PR | Publish job only on tags matching `automation.tagPattern` or an explicit dispatch with `publish: true` |
| Unreviewed publish/signing | `environment: release` with required reviewers and tags-`v*`-only deployment rule |
| Secrets on untrusted PRs | No secrets for fork PRs; no `pull_request_target` with PR head checkout; required workflows are secret-free |
| Token over-reach | `permissions: {}` at workflow level; per-job minimum grants; job-scoped `contents: write` |
| Long-lived cloud keys | OIDC/short-lived credentials preferred; static exceptions documented, scoped, rotated |
| Shell injection from event data | Never interpolate `github.event.*` directly into `run:`; pass via `env:` and quote (`"$TITLE"`) |
| Log/artifact leakage | No secret echoes; `::add-mask::` derived values; no secrets in caches/artifacts/summaries |
| Live third-party calls | Not allowed in CI/tests; fakes/fixtures only; external link checks off by default |

### 9.2 Guarded publish job (pattern)

```yaml
jobs:
  publish:
    if: >-
      startsWith(github.ref, 'refs/tags/v') ||
      (github.event_name == 'workflow_dispatch' && inputs.publish == true)
    environment: release
    permissions:
      contents: write
    steps:
      - name: Verify tag matches the configured release pattern
        env:
          TAG: ${{ github.ref_name }}
        run: |
          if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "not a release tag: $TAG"
            exit 1
          fi
          echo "release tag: $TAG"
```

### 9.3 Guarded signing/audit patterns

```yaml
- name: Sign and notarize (skips cleanly when secrets are absent)
  if: ${{ inputs.dry-run == false && inputs.certificate-p12 != '' }}
  uses: ./.github/actions/sign-notarize-macos
  with:
    artifact-path: ${{ inputs.artifact-path }}
    certificate-p12: ${{ inputs.certificate-p12 }}
    certificate-password: ${{ inputs.certificate-password }}
    apple-id: ${{ inputs.apple-id }}
    apple-app-password: ${{ inputs.apple-app-password }}
    team-id: ${{ inputs.team-id }}
    notarize: true
    dry-run: false
```

Audit skip pattern (already shipped in `.github/workflows/tracker-audit.yml`, preserve it):

```bash
if [ -z "$GH_TOKEN" ]; then
  echo "TRACKER_TOKEN is not configured; skipping advisory audit."
  exit 0
fi
```

### 9.4 Working with untrusted input

```yaml
- name: Print PR title safely
  env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: |
    printf 'PR title: %s\n' "$PR_TITLE"
```

Never write `run: echo "${{ github.event.pull_request.title }}"`. The same rule applies to branch names, issue bodies, and dispatch inputs.

---

## 10. Validation, T15 handoff, and change protocol

### 10.1 What T15 implements from this contract

| Deliverable | Expected path(s) |
|---|---|
| Reusable workflows | `.github/workflows/reusable-ci.yml`, `reusable-e2e.yml`, `reusable-desktop-smoke.yml`, `reusable-release.yml`, `reusable-audit.yml`, `reusable-security.yml`, `reusable-docs.yml` |
| Thin callers | `.github/workflows/ci.yml`, `e2e.yml`, `desktop-smoke.yml`, `release.yml`, `security.yml`, `docs.yml`; audit converted to a thin caller while preserving skip semantics |
| Composite actions | `.github/actions/setup-node-cache/action.yml`, `.github/actions/checksum/action.yml`, `.github/actions/sign-notarize-macos/action.yml` |
| Supporting config (sibling workflow/release-profile tasks as scoped) | `.github/dependabot.yml`, release-profile templates/callers |

### 10.2 Validation gates for T15 and release

- [ ] `actionlint .github/workflows/*.yml` passes (or the documented equivalent) — workflow files, not just docs snippets.
- [ ] Callers validate from a scratch repo: reusable and copy modes both exercised (§8.5).
- [ ] Required check names captured from a green run and documented; aggregate `ci-gate` present; no `paths` filter on required workflows.
- [ ] Secret-less CI run passes; fork-PR behavior verified (no secrets, read-only token).
- [ ] Dispatch dry-run for release leaves no release/assets behind; tag guard rejects a non-matching tag (test on a scratch repo).
- [ ] Signing/checksum actions skip cleanly when secret inputs are empty and fail loudly on bad input.
- [ ] Audit caller still skips cleanly with an unset `TRACKER_TOKEN`, and strict mode fails on violations.
- [ ] No secrets/live third-party calls in examples: scan workflows for literal tokens and for unguarded `curl`/network steps.
- [ ] Docs link/consistency review: this catalog, playbook §10, REFERENCE §13–16, config schema, and UPGRADING agree.

### 10.3 T09 validation evidence (docs-only)

Performed for this catalog:

- Markdown fence balance and heading/anchor review; relative links checked against existing docs/files.
- Consistency cross-check against `docs/GITHUB_PROJECT_TRACKER_PLAYBOOK.md` §10, `docs/REFERENCE.md` §13–16, `schemas/tracker.config.schema.json` `workflows`, `docs/UPGRADING.md`, and the shipped `.github/workflows/tracker-audit.yml`.
- YAML contract snippets parsed with a YAML parser (syntax only; not full workflow semantics).
- `actionlint` is **not available** in the authoring environment, so YAML files/snippets were not lint-checked here; T15 must run it on the real workflows.
- Ruleset/branch-protection enforcement could not be verified on this private personal repo (API 403 upgrade message, §3.2); documented as a caveat.
- No secrets, real tokens, or live third-party calls are present in examples.

### 10.4 Change protocol

- Contract changes (inputs/outputs/secrets/permissions/guards/required-check names) are **template version changes**; classify them per §7.9, update this catalog + REFERENCE + changelog in the same release, and publish migration notes in [UPGRADING](./UPGRADING.md).
- Behavior changes ship with docs in the same PR; stale commands/screenshots are defects.
- Required-check renames require a coordinated ruleset update and a note in the project's tracker; never rename silently.
- Keep the catalog minimal: add a workflow/contract only when a real adoption need exists, with owner, trigger, required status, and local parity defined before YAML lands.
- Open v1.0.0 validation items: public-template decision at the release gate (§8.6); audit promotion from advisory to required at release gates; optional Windows desktop profile; external-link checking stays opt-in.

---

## 11. Related documents

| Document | Why it matters here |
|---|---|
| [Playbook §10 — Actions / CI-CD contract](./GITHUB_PROJECT_TRACKER_PLAYBOOK.md#10-actions--ci-cd-contract) | Conceptual model and portfolio-level decisions |
| [REFERENCE §13–16 — workflow, token, runner, release profiles](./REFERENCE.md#13-workflow-catalog-planned-1002) | Quick lookup tables |
| [UPGRADING — version semantics, copy vs reusable, rollback](./UPGRADING.md#copy-vs-reusable) | How pins, copied files, and contract upgrades move |
| [ADOPTION §5 — audit, CI, protection](./ADOPTION.md#5-audit-ci-protection) | Where CI/audit/token decisions fit adoption |
| [HOW TO USE §13 — audit](./HOW_TO_USE.md#13-audit) | Manual audit checklist until automation is stable |
| [Node profile command mapping](../profiles/node/README.md#command-mapping) | Local parity for lint/format/verify |
| [tracker config schema](../schemas/tracker.config.schema.json) | `workflows.ci`, `workflows.audit`, `workflows.release` contract keys |
| [SECURITY.md](../SECURITY.md) | Private vulnerability reporting; never expose tokens |
| [Shipped audit workflow](../.github/workflows/tracker-audit.yml) | Current advisory baseline and skip behavior |
| [GitHub: reusing workflows](https://docs.github.com/en/actions/sharing-automations/reusing-workflows) · [OIDC hardening](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect) · [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) | Upstream behavior reference for integrators |
