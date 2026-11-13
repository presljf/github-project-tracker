# ACTIONS CATALOG

**Docs version:** v1.3.2-docs.1 · Target template: v1.3.2
**Scope:** canonical catalog and contracts for GitHub Actions in Project Tracker OS — workflows, triggers, required checks, tokens/secrets, runners/costs, local parity, reusable-workflow and composite-action interfaces, and the hybrid D adoption model.
**Status:** T09 authored the catalog; T15/T10 implemented the CI/security/release workflows and actions; T12 reconciled interfaces/availability before the v1.0.0 tag.
**Availability key:** **shipped** = a runnable workflow/action YAML exists in this repo (`.github/workflows/` or `.github/actions/`); **contract-only** = interface documented here but not yet implemented. Files under `profiles/` are non-runnable examples/copy sources — GitHub never executes them, so they are not counted as shipped workflows. Contract-only items are never claimed as shipped.

This page is the single source of truth for the Actions layer. The [playbook §10](./GITHUB_PROJECT_TRACKER_PLAYBOOK.md#10-actions-and-ci-cd-contract) keeps the conceptual model, [REFERENCE §13–16](./REFERENCE.md#13-workflow-catalog) keeps the quick lookup tables, and this catalog keeps the full catalog and stable interfaces. All three must stay consistent.

**Hard rules (apply to every workflow in this catalog):**

- No secrets are ever committed, printed, uploaded as artifacts, or interpolated into shell commands.
- No live third-party calls from automated CI/tests; test doubles and committed fixtures only.
- Sensitive steps are guarded by tag (`v*`), `workflow_dispatch` input, and/or a protected `release` environment.
- Workflows that run on untrusted pull requests get no secrets and a read-only token.
- Third-party actions and reusable workflows are pinned by SHA or exact template release tag — never `@main` or a floating major tag.

---

## Contents

- [1. How to read this catalog](#1-how-to-read-this-catalog)
- [2. Workflow catalog](#2-workflow-catalog)
  - [2.8 Tracker contract + metadata verification](#28-tracker-contract-metadata-verification)
  - [2.9 Post-merge bypass audit (shipped)](#29-post-merge-bypass-audit-shipped)
  - [2.10 PR close guard (shipped)](#210-pr-close-guard-shipped)
  - [2.12 Counts docs verification](#212-counts-docs-verification)
- [3. Trigger and required-check contract](#3-trigger-and-required-check-contract)
- [4. Token and secret matrix](#4-token-and-secret-matrix)
- [5. Runner, cost, and caching guidance](#5-runner-cost-and-caching-guidance)
- [6. Local-parity commands](#6-local-parity-commands)
- [7. Reusable workflow and composite action contracts](#7-reusable-workflow-and-composite-action-contracts)
  - [7.10 `reusable-contract.yml` — contract + metadata verification contract](#710-reusable-contractyml-contract-metadata-verification-contract)
  - [7.11 `reusable-post-merge-audit.yml` — post-merge bypass audit contract](#711-reusable-post-merge-audityml-post-merge-bypass-audit-contract)
  - [7.12 `reusable-pr-close-guard.yml` — PR close guard contract](#712-reusable-pr-close-guardyml-pr-close-guard-contract)
  - [7.13 `reusable-counts.yml` — counts docs verification contract](#713-reusable-countsyml-counts-docs-verification-contract)
- [8. Hybrid D adoption model](#8-hybrid-d-adoption-model)
- [9. Guardrails: no secrets, no live calls, guarded publishing](#9-guardrails-no-secrets-no-live-calls-guarded-publishing)
- [10. Validation, T15 handoff, and change protocol](#10-validation-t15-handoff-and-change-protocol)
- [11. Related documents](#11-related-documents)

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
| E2E — `e2e.yml` → `reusable-e2e.yml` | PR path/label; optional nightly | advisory by default; required only if project opts in; context `e2e / e2e` | `ubuntu-latest` | Playwright browser E2E wrapper (browsers per run) | `contents: read` | none | failure-only traces/screenshots/videos when `artifact-path` set; 7d default | Advisory unless promoted; flaky E2E never auto-promoted; install/test failures fail the job |
| Counts docs — `counts-docs.yml` → `reusable-counts.yml` | `pull_request`; `push` main; `workflow_dispatch` | advisory until `docs.counts` adopted, then required (`counts-docs / counts`) | `ubuntu-latest` | Verified counts docs contract: baseline agreement + generated doc + inline markers | `contents: read` | none | none — console output only | Drift/stale doc or markers fail; absent `docs.counts` is a documented no-op (exit 0); local parity `npm run guard:docs:counts` |
| Desktop smoke — `desktop-smoke.yml` → `reusable-desktop-smoke.yml` | PR path/label; `push` main paths; tags `v*`; `workflow_dispatch` | advisory on PR; **required release gate** | macOS (`macos-15` baseline) | Native shell/package smoke | `contents: read` | none (unsigned smoke) | smoke logs/summary, 7d | Advisory on PR; blocks release tag gate |
| Release — `release.yml` → `reusable-release.yml` | `push` tags matching `automation.tagPattern`; `workflow_dispatch` (dry-run default) | **release gate** (not a PR check) | Linux generic/container/package; macOS for signed desktop | Validate version, build, checksum, publish or dry-run | `contents: write` (publish job only); `id-token: write` for OIDC; `packages: write` for container profile | `release` environment secrets; OIDC; `RELEASE_TOKEN` only if org policy requires | archives/dmg/image digest/package + `SHA256SUMS`, 30–90d | Fail closed; dry-run never publishes; tag/version mismatch fails |
| Tracker audit — `tracker-audit.yml` → `reusable-audit.yml` | weekly `schedule`; `workflow_dispatch`; advisory `pull_request` | advisory (default); strict opt-in per project | `ubuntu-latest` | Tracker invariants via `audit.mjs` | caller + job `contents: read`; project read via scoped token | `TRACKER_TOKEN` (`required: false`; project read; advisory skips cleanly when absent, strict fails actionably) | none — JSON in the job log + job summary | Advisory = never blocks; strict = fails gate; invalid mode/config errors fail; missing token skips advisory |
| Post-merge audit — `post-merge-audit.yml` → `reusable-post-merge-audit.yml` | `pull_request` closed (merged only); `workflow_dispatch` with `pr-number` | advisory (opens OI on a real bypass); context `post-merge-audit / audit` | `ubuntu-latest` | Required-check + closing-keyword/partial-PR audit of merged PRs | caller grants `contents: read`, `issues: write`, `pull-requests: read`, `checks: read`, `statuses: read`, `actions: read` (called job's union) | `GITHUB_TOKEN` (automatic; caller must grant the same block) | none — job summary | Advisory: opens `tracker-contract-exception` OI instead of a red X; unreadable rollup degrades to warning + closure-only (exit 0, no false OI); non-merged `pr-number` fails actionably |
| PR close guard — `pr-close-guard.yml` → `reusable-pr-close-guard.yml` | `pull_request` opened/edited/synchronize/reopened/labeled/unlabeled | required: `pr-close-guard / guard` | `ubuntu-latest` | Closing-keyword and partial-PR rules for tracker task PRs | caller grants `contents: read`, `issues: read`, `pull-requests: read` (read-only) | none (`GITHUB_TOKEN` automatic) | none — job summary | Violations fail the PR check; guard is read-only (no `issues: write`) |
| Tracker contract — `tracker-contract.yml` → `reusable-contract.yml` | `pull_request`; `push` main; `workflow_dispatch` | required: `tracker-contract / contract`; `tracker-contract / metadata` per project | `ubuntu-latest` | Contract + metadata verification (pinned tooling + adoption contract; live Project metadata) | `contents: read` | `GITHUB_TOKEN` automatic; `TRACKER_TOKEN` (project read) only for metadata — absent with `metadata: true` fails with an actionable message; callers skip metadata on fork PRs | none | Contract/metadata violations fail; missing token or unreadable project fails closed; local parity `npm run verify:tooling`/`verify:contract`/`verify:metadata` |
| Security — `security.yml` (Dependabot + dependency review + optional CodeQL) | PR dependency review; weekly/monthly `schedule`; CodeQL opt-in | Dependabot default; dependency review advisory then required; CodeQL opt-in advisory | `ubuntu-latest` | Dependency/supply-chain/code scanning | `contents: read`; `security-events: write` (CodeQL job only); `pull-requests: write` only if commenting | none | CodeQL SARIF → code scanning; summary otherwise | Dependency-review policy failure when required; CodeQL advisory until stable |
| Docs — `docs.yml` → `reusable-docs.yml` | PR/push paths `docs/**`, `**/*.md`; `workflow_dispatch` | optional advisory; can be required for docs-only repos | `ubuntu-latest` | Markdown fence/link/consistency checks | `contents: read` | none | report summary, 7d | Advisory by default; broken fences/relative links fail |

The three reusable-mode profile callers (`release-macos.yml`, `release-container.yml`, `release-package.yml`) are **non-runnable copy examples** under `profiles/release/reusable/`: `.github/workflows/` holds only the internal runners plus the `reusable-*` contracts, and `release.yml` is the only runnable release caller. Copy an example into `.github/workflows/` and pin the adopted tag — `profiles/` itself is never executed by GitHub.

<!-- surface-status:start -->
<!-- Generated by `node scripts/internal/render-surface.mjs` from `contract/repo-surface.json`. Do not edit by hand. -->
**Shipped vs contract-only (generated from `contract/repo-surface.json`):**
- shipped: `checksum`, `reusable-audit.yml`, `reusable-ci.yml`, `reusable-contract.yml`, `reusable-counts.yml`, `reusable-desktop-smoke.yml`, `reusable-e2e.yml`, `reusable-guard.yml`, `reusable-post-merge-audit.yml`, `reusable-pr-close-guard.yml`, `reusable-release.yml`, `reusable-security.yml`, `setup-node-cache`, `sign-notarize-macos`
- contract-only: `reusable-docs.yml`
<!-- surface-status:end -->

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

- **Shipped (T05):** thin caller `e2e.yml` → [`reusable-e2e.yml`](#73-reusable-e2eyml-e2e-contract-optional-profile); copy the caller from [`profiles/e2e/e2e.yml`](../profiles/e2e/e2e.yml) and pin the adopted tag/SHA. Check context: `e2e / e2e`.
- **Purpose:** browser end-to-end validation where the product needs it — a Playwright wrapper that keeps caller logic thin.
- **Trigger detail:** `pull_request` path- or `run-e2e`-label gated; optional nightly `schedule` off-peak; `workflow_dispatch`.
- **Required status:** advisory by default. Promotion requires deterministic behavior, <15 min on Linux, no secrets, a flake rate recorded over at least a week, and a recorded project decision. Never required on PRs before promotion.
- **Permissions/secrets:** `contents: read` only; no secrets. External services are stubbed/faked; no live third-party calls in the required path (the Playwright browser download is an install step).
- **Wrapper behavior:** the reusable workflow checks out the adopter, self-checks the tracker action source out to `.tracker-actions` via `job.workflow_repository`/`job.workflow_sha` and runs `setup-node-cache` (§7.8), installs Playwright browsers (`browsers: chromium` default; comma-separated lists; `none` skips), runs `test-command` (default `npm run e2e`) from `working-directory`, and uploads failure artifacts only when `artifact-path` is set (`upload-on-success: false` default; retention 7; workspace-relative globs — treat traces/screenshots as sensitive/PII).
- **Failure mode:** advisory failure reported in the job result/summary; a promoted required E2E job blocks merge after promotion. Browser-install and test-command failures fail the job.
- **Local parity:** `npx playwright install --with-deps chromium` (Linux) then `npm run e2e` (or the project's documented command). The Playwright/browser path is validated downstream at CastDeck C3; the template's `e2e-fixture.yml` proves wiring only (`browsers: none`, trivial command).

### 2.3 Desktop/app smoke

- **Purpose:** catch macOS/native shell or packaged-app breakage that Linux CI cannot see.
- **Trigger detail:** `pull_request` gated by path (`apps/desktop/**` or the project's desktop paths) and maintainer label `run-desktop-smoke`; `push` to `main` on the same paths; tags `v*` always; `workflow_dispatch`.
- **Required status:** advisory on PR (cost); required for the release tag gate.
- **Permissions/secrets:** `contents: read`; unsigned smoke uses no secrets. Signing/notarization belongs to the release profile, not smoke.
- **Artifacts:** smoke logs and a short summary, 7 days.
- **Failure mode:** advisory failure annotates the PR; failure on a release tag blocks publishing.
- **Local parity:** project-defined `npm run smoke:desktop` (or documented build+launch command).
- **Remote-only guard:** desktop smoke is remote-only by policy — declare it in
  `verification.remoteOnly[]` and gate local runs with the offline `guard-local-suite.mjs`.
  Local visible runs exit 1 with the remote workflow/label/override instructions; hidden local mode
  (when declared) is non-authoritative; `--mode report` records `DEFERRED_REMOTE` for aggregators.
  Remote detection is `GITHUB_ACTIONS === 'true'` only (a local `CI=true` is not remote). Agents
  must never set the override env. See §7.4.1.

### 2.4 Release (release gate)

- **Purpose:** turn a release tag or an explicit dispatch into validated, checksummed, published artifacts — or a safe dry-run.
- **Profiles:** `generic` (GitHub Release assets), `desktop` (signed/notarized macOS), `container` (GHCR image), `package` (npm/PyPI with provenance). The value is a free-form string in config (`workflows.release.profile`); this catalog's canonical name for the GitHub Release profile is `generic` (the example configs also use `github-release` — keep the caller, profile template, and config value identical). Additional project profiles are project-local. The macOS/container/package callers for these profiles ship as non-runnable copy examples under `profiles/release/reusable/`; copy one into `.github/workflows/` and pin the adopted tag before use (`profiles/` is never executed).
- **Trigger detail:** `push` on tags matching `automation.tagPattern` (`^v\d+\.\d+\.\d+$`); `workflow_dispatch` with `publish` defaulting to `false` (dry-run). No publish path from PR events.
- **Required status:** release gate, not a PR required check.
- **Permissions/secrets:** job-scoped `contents: write`; `id-token: write` only for OIDC publishing; `packages: write` only for the container profile; signing/notarization secrets are environment secrets on protected `release`. All publish steps guarded by tag + environment (§9).
- **Artifacts:** profile artifacts plus `SHA256SUMS` (sorted, deterministic); 30–90 days and as release assets.
- **Failure mode:** fail closed. Dry-run never publishes; tag/version mismatch fails; missing signing secrets skips signing cleanly (ad-hoc fallback documented) rather than publishing unsigned silently.
- **Local parity:** build + `shasum -a 256`/`sha256sum`; generic `gh release create --draft`; desktop `codesign`/`xcrun notarytool` dry-run with placeholder env; container `docker build`; package `npm pack --dry-run` (§6).

### 2.5 Tracker audit (advisory first)

- **Purpose:** run `audit.mjs` against the configured project and report tracker invariant violations; advisory by default, strict only as a deliberate release-gate opt-in.
- **Reusable caller:** `tracker-audit.yml` (thin caller) → [`reusable-audit.yml`](#76-reusable-audityml-tracker-audit-contract); adopters copy [`profiles/audit/tracker-audit.yml`](../profiles/audit/README.md) and pin the adopted tag/SHA. Check context: `tracker-audit / audit`.
- **Trigger detail:** weekly `schedule` (Mondays 15:00 UTC), `workflow_dispatch`, and — new in T04 — advisory `pull_request`; projects may also run it on `push` to `main`.
- **Required status:** advisory first; strict is a release-gate opt-in (`mode: strict`), never the default PR check.
- **Token:** `TRACKER_TOKEN` (`required: false`) with project read **and** repo/issues read for private adopters (classic PAT `project` + `repo`; fine-grained Projects read + Metadata read + repository contents/issues read; project-scoped PAT ≤90 days — or a GitHub App installation token with Projects: read + repository read). Advisory mode with no token prints a notice and skips cleanly (exit 0); strict mode requires the token and fails with an actionable message. Never printed or uploaded.
- **Permissions/secrets:** caller and job are `contents: read`; project read comes only from the passed token.
- **Artifacts:** none — when `json: true` (default) the JSON result is echoed to the job log and a job summary is written; nothing is uploaded.
- **Failure mode:** advisory = exit 0 on violations/warnings; strict = exit 1 on violations; invalid mode, missing config, or missing audit tooling fails closed.
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

### 2.8 Tracker contract + metadata verification

- **Purpose:** verify that an adopting repository still satisfies the pinned tracker contract — tooling versions/config and the adoption contract — and that its live GitHub Project metadata matches that contract (fields/options, issue types, release → sprint → task hierarchy).
- **Reusable caller:** `tracker-contract.yml` (thin caller) → [`reusable-contract.yml`](#710-reusable-contractyml-contract-metadata-verification-contract); copy the caller from [`profiles/contract/`](../profiles/contract/README.md) and pin the adopted tag/SHA. The template repository dogfoods the same contract with its own thin caller.
- **Trigger detail:** `pull_request`; `push` to `main`; `workflow_dispatch`. The contract job is offline and runs on every event. The metadata job needs `TRACKER_TOKEN`, so fork PRs run contract-only; **adopter callers** set `metadata` from the event (for example `${{ github.event_name != 'pull_request' }}`) and push/dispatch runs exercise both jobs.
- **Template self caller (dogfood):** `.github/workflows/tracker-contract.yml` keeps `metadata: false` — the template repository runs the **tooling** work profile (Stream → Task), whose native types/hierarchy do not match the product-mode metadata mapping the contract encodes, and `verify-metadata` is not `workProfile`-aware yet. The gap is recorded as accepted debt (`contract/debt-register.json`) and its metadata verification is deferred to that follow-up; the contract job still dogfoods the reusable on every PR/push.
- **Required status / check contexts:** contract verification is required per project (`tracker-contract / contract`); metadata is project-defined (`tracker-contract / metadata`) and only requirable where the caller actually runs metadata on the gated events. The bundled callers skip metadata on pull requests (`metadata: false`), so keep that context off PR required-check lists unless the project deliberately runs metadata on every PR.
- **Permissions/secrets:** caller and both jobs use `contents: read` only; no write scopes. `TRACKER_TOKEN` is optional and used only by the metadata job: project-scoped PAT (Projects read + Metadata read, ≤90 days) or a GitHub App installation token; pass it explicitly by name, never `secrets: inherit`.
- **Artifacts:** none — job logs/summary only.
- **Failure mode:** fail closed. Contract/tooling/version violations fail the contract job; a contract mismatch, missing `project.number`, unreadable project, or a metadata run without `TRACKER_TOKEN` fails the metadata job with an actionable message (no silent skip when `metadata: true`).
- **Local parity:** `npm run verify:tooling -- --root . --contract <contract> --tracker-config <config>`, `npm run verify:contract -- --root . --contract <contract>`, and `npm run verify:metadata -- --repo owner/repo --contract <contract>` (live API + project-read token); see §6.
- **Migration/check-name note:** v1.3.x adopters copied two workflows with contexts `tracker-contract` and `tracker-metadata`; v1.4.0 emits `tracker-contract / contract` and `tracker-contract / metadata`. Update branch protection/ruleset required checks in the same upgrade PR (major per §7.9) and keep the old copies until the new contexts are green — full steps and token setup in [profiles/contract/README.md](../profiles/contract/README.md).

### 2.9 Post-merge bypass audit (shipped)

- **Purpose:** audit a merged PR for bypassed required checks and invalid closing-keyword/partial-PR usage, and open a `tracker-contract-exception` OI when a real bypass is found (instead of a red X after merge).
- **Reusable caller:** `post-merge-audit.yml` (thin caller) → [`reusable-post-merge-audit.yml`](#711-reusable-post-merge-audityml-post-merge-bypass-audit-contract); install from [`profiles/audit/post-merge-audit.yml`](../profiles/audit/post-merge-audit.yml). Check context: `post-merge-audit / audit`.
- **Trigger detail:** `pull_request` closed (the caller runs only when `merged == true`) and `workflow_dispatch` with a required `pr-number` for manual re-audits. The audit script (`post-merge-audit.mjs`) re-validates `state == MERGED` through the API before auditing (the reusable workflow stays transport-only — no raw `gh` steps), so a dispatch on an open/closed-unmerged PR fails actionably.
- **Required context / status:** `post-merge-audit / audit` — advisory: a detected bypass opens an OI and the job succeeds; it is never a PR-blocking check because it runs after merge.
- **Caller permissions (must grant the called job's union):** `contents: read` (checkout); `issues: write` (open the `tracker-contract-exception` OI/label); `pull-requests: read` (merged PR metadata); `checks: read` + `statuses: read` + `actions: read` (read `statusCheckRollup`; its GraphQL query also resolves `checkSuite.workflowRun`, which needs Actions read on private repos).
- **Secrets/artifacts:** none beyond the automatic `GITHUB_TOKEN`; no artifacts — job summary only.
- **Failure mode:** a real bypass opens an OI (documented advisory record, not a red X); an unreadable rollup (missing `checks`/`statuses`/`actions` read) degrades loudly — warning + job summary — to a closure-only audit and exits 0 so it cannot create a false check-related OI; non-permission/API errors fail closed.
- **Config note:** required check names come from `guard.requiredChecks[]` in `tracker.config.json`; absent config falls back to the legacy default list (`ci / ci-gate`, `docs-guard`, `pr-close-guard`). Update it to the new reusable contexts when migrating, otherwise every merge is flagged as a bypass.
- **Local parity:** `GH_TOKEN=... GITHUB_REPOSITORY=owner/repo PR_NUMBER=<merged-pr> npm run audit:post-merge -- --config tracker.config.json` (§6).

### 2.10 PR close guard (shipped)

- **Purpose:** enforce the tracker's PR closing rules on every PR update: a task PR must carry a closing keyword (`Closes/Fixes/Resolves #N`) targeting a task issue; a `partial` PR must use `Refs`/`Part of` and must not close the task; closing a sprint/release/stream tracker is rejected.
- **Reusable caller:** `pr-close-guard.yml` (thin caller) → [`reusable-pr-close-guard.yml`](#712-reusable-pr-close-guardyml-pr-close-guard-contract); install from [`profiles/audit/pr-close-guard.yml`](../profiles/audit/pr-close-guard.yml). Check context: `pr-close-guard / guard`.
- **Trigger detail:** `pull_request` `opened`, `edited`, `synchronize`, `reopened`, `labeled`, `unlabeled` (a label edit can change the `partial` decision).
- **Required/optional status:** required in this repository (`pr-close-guard / guard`); adopters should require it as they migrate (old copied context: `pr-close-guard`).
- **Permissions:** read-only least privilege — caller and job grant `contents: read`, `issues: read`, `pull-requests: read`. The guard script fetches the live PR and referenced issues through the API (event env vars optional), so no `issues: write` is needed; a future write requirement would be a documented permission increase (§7.9).
- **Secrets/artifacts:** none (automatic `GITHUB_TOKEN`); no artifacts.
- **Failure mode:** violations fail the PR check with the specific rule; API/permission errors fail closed; fork PRs are supported because the token is read-only.
- **Local parity:** `GH_TOKEN=... GITHUB_REPOSITORY=owner/repo PR_NUMBER=<pr> npm run guard:pr-close` (§6).

### 2.12 Counts docs verification

- **Purpose:** verify the committed "aware and agree" counts contract — baseline schema + named-skip/reviewed agreement, the generated `docs/TEST_COUNTS.md`, and inline `<!-- counts:... -->` markers — without running the suite inventory. Counts become machine-checked instead of remembered.
- **Reusable caller:** `counts-docs.yml` (thin caller) → [`reusable-counts.yml`](#713-reusable-countsyml-counts-docs-verification-contract); copy the caller from [`profiles/counts/counts-docs.yml`](../profiles/counts/counts-docs.yml) and pin both refs. Check context: `counts-docs / counts` (caller job `counts-docs` / called job `counts`).
- **Trigger detail:** `pull_request`, `push` to `main`, `workflow_dispatch`.
- **Required status:** no-op/advisory until `docs.counts` is adopted; once the counts policy is wired, require `counts-docs / counts` — it is cheap, deterministic, and runs no tests.
- **Permissions/secrets:** `contents: read` only; no secrets.
- **Artifacts:** none — console output only (no artifact upload, no API calls).
- **No-op behavior:** absent `docs.counts` config is a documented no-op — the guard prints `docs counts guard: docs.counts is not configured (no-op).` and exits 0. The template repository itself has no counts policy yet, so its own caller run is this no-op; real-baseline validation is CastDeck C3 after the v1.4.0 tag.
- **Failure mode:** baseline schema/agreement errors, a missing or stale generated doc, or stale/unknown/unclosed markers fail with exact fix guidance (`docs.counts.updateCommand` / `suite-counts render`). The workflow never runs the suite inventory.
- **Local parity:** `npm run guard:docs:counts -- --root . --config tracker.config.json` (§6); the suite-side inventory and `suite-counts check` job stay adopter-side ([profiles/counts/README.md](../profiles/counts/README.md)).

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
- E2E runs path/label-gated on PRs and stays advisory until promoted; counts docs runs on `pull_request`/`push` to `main`/`workflow_dispatch` and is a documented no-op until `docs.counts` is configured.

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
7. **E2E and counts docs gating.** E2E is advisory by default (`e2e / e2e`); promote it only after the §2.2 criteria and a recorded decision. Counts docs (`counts-docs / counts`) becomes required only when the project adopts `docs.counts` — before that the check is a documented no-op. Contexts are `<caller job> / <job name>`; capture them from a green run.

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
| Counts docs (`reusable-counts.yml`) | `GITHUB_TOKEN` (automatic) | `contents: read` only | automatic | per-run, ephemeral | No token/secret and no API calls: the guard validates the committed baseline/generated doc/markers only (no test execution). No-op when `docs.counts` is absent |
| Post-merge audit (`reusable-post-merge-audit.yml`) | `GITHUB_TOKEN` (automatic) | caller grants `contents: read`, `issues: write`, `pull-requests: read`, `checks: read`, `statuses: read`, `actions: read` — the same union the called job declares | automatic | per-run, ephemeral | `issues: write` opens the `tracker-contract-exception` OI; `checks`/`statuses`/`actions` read are needed for `statusCheckRollup` (its GraphQL query resolves `checkSuite.workflowRun`). Unreadable rollup degrades to warning + closure-only (exit 0, no false OI); fork-originated PRs get a read-only token by default, so OI creation can fail loudly there |
| PR close guard (`reusable-pr-close-guard.yml`) | `GITHUB_TOKEN` (automatic) | caller and job grant `contents: read`, `issues: read`, `pull-requests: read` (read-only) | automatic | per-run, ephemeral | The guard script reads the PR and referenced issues through the API; no write scope is needed or granted. Fork PRs are supported (read-only token is sufficient) |
| Tracker audit (advisory) | `TRACKER_TOKEN` (`required: false`) — classic PAT with `project` + `repo` read (private repos also need repository contents/issues read to load the config/tooling), fine-grained Projects read + Metadata read + repository contents/issues read, or a GitHub App installation token with Projects: read + repository read (org-owned projects) | project read **and** repo/issues read for private adopters | repo/org secret | ≤90 days for PATs; App tokens 1 h | Optional: advisory mode with no token prints a notice and skips cleanly (exit 0). User-owned Projects v2 generally need an OAuth/PAT `project` scope; validate App access on your owner type |
| Tracker audit (strict release gate) | same | project read | repo/org secret (or a protected environment secret when the gate runs in one) | same | Audit is read-only; no write scopes needed. Missing token fails actionably in strict mode |
| Contract + metadata verification (`reusable-contract.yml`) | `GITHUB_TOKEN` for the offline contract job; `TRACKER_TOKEN` for the metadata job only | contract: `contents: read`; metadata token: project read (Projects read + Metadata read) | `GITHUB_TOKEN` automatic; `TRACKER_TOKEN` repo/org secret | PAT ≤90 days; App installation tokens 1 h | Metadata runs only when `metadata: true` — fork PRs pass `false`; missing token with metadata enabled fails with an actionable message instead of skipping. Read-only, no write scopes; contract job sends no secrets |
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
| `macos-15` / `macos-15` | ≈10× | Desktop smoke and signed/notarized release only | Scarce and slow to provision; never on every push/PR |
| Larger runners | per-minute, higher | Heavy parallel builds if justified | Requires plan support; document the cost decision |
| Self-hosted | variable infrastructure cost | Private/trusted-only workloads | Never for public forked PRs without full isolation; ephemeral runners only |

Approximate multipliers reflect GitHub-hosted runner billing and may change; check the current [Actions billing documentation](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions). Public repos' standard runners are free subject to fair use; private repos consume the plan's included minutes — this template repo is private, so treat every minute as budgeted.

### 5.2 Cache matrix

| Cache | How | Key | Notes |
|---|---|---|---|
| npm dependencies | `setup-node-cache` composite action (§7.8) wrapping `actions/setup-node` `cache: npm` | lockfile hash | Cache the npm cache directory; do not cache `node_modules` across OS/Node versions; with no lockfile, caching is disabled rather than failing |
| pnpm/yarn store | `setup-node-cache` with `package-manager: pnpm` or `yarn` (or `actions/cache`) | lockfile hash | Same key discipline; separate OS keys |
| Playwright browsers | `reusable-e2e.yml` installs browsers per run (`browsers: chromium` default; comma lists; `none` skips) | Playwright version + lockfile | ~0.5–1 GB per install; no browser cache in v1.4.0 (a future minor may add one); E2E/desktop jobs only, never the CI gate |
| Build outputs (Turbo/Nx/etc.) | project cache or `actions/cache` | lockfile + source hash | Only for expensive builds; document invalidation |
| Docker layers | buildx `type=gha` | Dockerfile + lockfiles | Release/container jobs only |
| Lint caches | `.eslintcache`/tool cache | config + lockfile | Optional; small win, beware stale caching |

Rules: caches are per-OS and per-key; never cache secrets, tokens, keychains, or signed artifacts; respect the repo cache size/eviction limits; bump the key when the tool version changes; caches do not replace lockfile-pinned installs (`npm ci`).

Node setup, cache, and dependency install in the reusable workflows now run through the shipped `.github/actions/setup-node-cache` action (§7.8): one place for the Node version, the cache decision, and install semantics. Reusable workflows consume it by checking the tracker repository out again via the reusable workflow's own `${{ job.workflow_repository }}`/`${{ job.workflow_sha }}` into `.tracker-actions`; the cache is restored only when the selected package manager's lockfile exists.

### 5.3 Concurrency, timeouts, retention

| Workflow | Concurrency group | Cancel in progress | Timeout |
|---|---|---|---|
| CI | `ci-${{ github.workflow }}-${{ github.ref }}` | yes | 15 min |
| E2E | `e2e-${{ github.workflow }}-${{ github.ref }}` | yes | 20 min |
| Counts docs | `counts-docs-${{ github.workflow }}-${{ github.ref }}` | yes | no explicit timeout (GitHub default) |
| Desktop smoke | `desktop-smoke-${{ github.workflow }}-${{ github.ref }}` | yes | 30 min |
| Release | `release-${{ github.ref }}` | **no** | 60 min |
| Tracker audit | `tracker-audit-${{ github.event_name }}-${{ github.ref }}` | yes | no explicit timeout (GitHub default) |
| Post-merge audit | `post-merge-audit-${{ github.event.pull_request.number || inputs['pr-number'] }}` | **no** | no explicit timeout (GitHub default) |
| PR close guard | `pr-close-guard-${{ github.event.pull_request.number }}` | yes | no explicit timeout (GitHub default) |
| Security/docs | `security-${{ github.ref }}` / `docs-${{ github.ref }}` | yes | 15 / 5 min |

- Cancel superseded PR runs; never cancel a tag or release run halfway through publishing. The post-merge audit is not cancelled (`cancel-in-progress: false`) because a half-run audit could skip a bypass check.
- The E2E job timeout is the reusable workflow's `timeout-minutes` input (default 20 min), so browser install + tests are bounded and configurable per caller; counts docs follows the runner default (fast, deterministic).
- Artifact retention: 7 days for advisory failure logs/screenshots; 30–90 days for release checksums/artifacts. Keep job summaries for the human-readable record — the audit family uploads no artifacts (JSON is echoed to the log + summary). Audit-family callers set no explicit timeout; add `timeout-minutes` when a project's audit can be slow.
- Cost controls beyond caching: label/path gating, schedules weekly not hourly, early-failing lint before tests, matrix minimization, single OS unless required, and no artifact upload on success unless it is a product artifact.

---

## 6. Local-parity commands

Every workflow must be reproducible locally with no CI-only steps; the commands below are the contract. Default command strings live in `profiles.node.commands` in `tracker.config.json` (`lint`, `format`, `test`, `e2e`, `verify`, `build`) — the table shows the defaults. Commands marked **project-defined** are placeholders that the adopting project must document in its tracker config/notes — a workflow without a local equivalent is not adopted.

| Workflow | Local command | Expected result | Availability |
|---|---|---|---|
| CI | `npm run lint` · `npm run format:check` · `npm test` · `npm run validate:config` | lint/format exit 0; tests report `# pass N` / `# fail 0`; config prints `OK  <file>` lines | `npm test`/`validate:config` **now**; lint/format from the [node profile](../profiles/node/README.md#command-mapping) once profile scripts are merged into the project |
| E2E | `npx playwright install --with-deps chromium` (Linux) then project-defined `npm run e2e` | browsers installed; exit 0; HTML report path printed | Playwright **now**; test command project-defined |
| Desktop smoke | project-defined `npm run smoke:desktop` | exit 0; smoke summary printed | project-defined |
| Release (generic) | build, then `sha256sum`/`shasum -a 256` on artifacts; `gh release create --draft` | sorted `SHA256SUMS`; draft release URL | project-defined; `gh` **now** |
| Release (desktop) | `codesign --verify --deep --strict <app>`; `xcrun notarytool submit --wait` (dry credentials) | signature valid; notary status accepted or skipped when secrets absent | project-defined |
| Release (container) | `docker build -t <image> .`; `docker run` smoke | image builds and starts locally | project-defined |
| Release (package) | `npm pack --dry-run` | tarball file list, no secrets or extra files | project-defined |
| Tracker audit | `npm run audit -- --config tracker.config.json --advisory`; strict: add `--strict` | `Tracker audit — <repo> (advisory)`; violations listed; advisory exit 0, strict exits 1 on violations | **now** |
| Post-merge audit | `GH_TOKEN=... GITHUB_REPOSITORY=owner/repo PR_NUMBER=<merged-pr> npm run audit:post-merge -- --config tracker.config.json` | audit summary; `tracker-contract-exception` OI opened on a real bypass; unreadable rollup warns + closure-only, exit 0 | **now** |
| PR close guard | `GH_TOKEN=... GITHUB_REPOSITORY=owner/repo PR_NUMBER=<pr> npm run guard:pr-close` | `PR closing-keyword guard OK.` or the violation list; exit 1 on violations | **now** |
| Security | `npm ls --all`; optional `npm audit --audit-level=high` | dependency tree resolves; audit findings listed (network, advisory only) | `npm ls` **now**; audit optional |
| Docs | `git diff --check`; fence parity; optional Markdown lint | no output from `git diff --check`; `balanced` fence count | **now** |
| Counts docs | `npm run guard:docs:counts -- --root . --config tracker.config.json` | no-op line when `docs.counts` is absent; otherwise `docs counts contract OK — N suite(s) / M mode(s); generated doc and K marker file(s) current.`; stale baseline/doc/markers exit 1 | **now** |

Docs fence-parity check (no external dependency):

````bash
git diff --check
awk '/^```/{n++} END {print n, (n % 2 ? "UNBALANCED" : "balanced")}' docs/ACTIONS_CATALOG.md
````

Additional notes:

- The template repo's own tests run with `npm test` (Node's built-in test runner); `npm run validate:config` validates the example configs.
- The audit-family scripts read `GITHUB_REPOSITORY`/`PR_NUMBER` from the environment (plus optional `PR_BODY`/`PR_BRANCH`/`PR_LABELS` for the close guard and `--config` for the audits); there is no `--repo`/`--pr` flag. The guard fetches the live PR when the event env vars are absent.
- The Node profile is merged into adopting projects from `profiles/node/package.example.json`; do not overwrite project scripts wholesale ([profile README](../profiles/node/README.md)).
- Release/desktop commands using credentials are documented as dry-runs only; never paste real secrets into a terminal history or issue.
- External link checking is not a default local gate (network, flaky); review relative links with the docs command above and rendered Markdown previews.

---

## 7. Reusable workflow and composite action contracts

Contracts for CI/security/release are implemented as shipped YAML; the tracker contract + metadata verification workflow (§7.10), the audit family (§7.6, §7.11, §7.12), and the E2E and counts-docs reusables (§7.3, §7.13) are shipped too. The docs reusable (`reusable-docs.yml`) remains **contract-only**. Each contract states its status where relevant. Machine-checkable class/status/audience truth (generated from `contract/repo-surface.json`): [SURFACE](./SURFACE.md).

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
| Inputs | `node-version` string default `'22'`; `working-directory` string default `.`; `tracker-config` string default `''`; `install-command` string default `''` (auto-detect lockfile); `lint-command`, `format-command`, `test-command`, `build-command` strings default `''` (resolve from tracker config/package scripts, then documented no-op success) |
| Outputs | `result` (`success`/`failure`), `checks-passed` (`'true'`/`'false'`) |
| Secrets | none |
| Permissions | `contents: read` |
| Runner | `ubuntu-latest` |
| Artifacts | none by default |
| Stability | adding an optional input/output is minor; adding a required input or renaming/removing an input/output is major |

```yaml
# Implemented contract: .github/workflows/reusable-ci.yml (T15)
on:
  workflow_call:
    inputs:
      node-version: { type: string, required: false, default: '22' }
      working-directory: { type: string, required: false, default: '.' }
      tracker-config: { type: string, required: false, default: '' }
      install-command: { type: string, required: false, default: '' }
      lint-command: { type: string, required: false, default: '' }
      format-command: { type: string, required: false, default: '' }
      test-command: { type: string, required: false, default: '' }
      build-command: { type: string, required: false, default: '' }
    outputs:
      result: { value: "${{ jobs.summary.outputs.result }}" }
      checks-passed: { value: "${{ jobs.summary.outputs.checksPassed }}" }
permissions:
  contents: read
```

Caller snippet (implemented `.github/workflows/ci.yml`):

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
  merge_group:
permissions:
  contents: read
jobs:
  ci:
    uses: presljf/github-project-tracker/.github/workflows/reusable-ci.yml@<exact-tag-or-sha>
    with:
      node-version: '22'
      # Omit commands to resolve from tracker config/package.json, or pass explicit commands.
```

Required-check mapping: the implementation exposes `ci / prepare`, `ci / lint`, `ci / format`, `ci / test`, `ci / build`, and the aggregate `ci / ci-gate` through the caller job id `ci`. Require the aggregate `ci / ci-gate` (recommended) or the individual deterministic jobs; never require CodeQL while opt-in. Capture contexts from a green run before enabling protection. `tracker.config.json` `workflows.ci.requiredChecks` stores short names; T12 documents the mapping.

### 7.3 `reusable-e2e.yml` — E2E contract (optional profile)

**Availability:** shipped (T05) — `.github/workflows/reusable-e2e.yml`, `on: workflow_call` only, job `e2e`. The template's own plumbing fixture is `.github/workflows/e2e-fixture.yml` (dispatch-only, `browsers: none`; context `e2e-fixture / e2e`, never an adopter check); adopters copy [`profiles/e2e/e2e.yml`](../profiles/e2e/e2e.yml) and pin the adopted tag/SHA. Check context: `e2e / e2e`. There is no `tracker-ref` input — the wrapper runs only the adopter's commands plus the pinned tracker composite action it checks out itself.

| Interface | Definition |
|---|---|
| Inputs | `node-version` string default `'22'`; `working-directory` string default `'.'`; `package-manager` string default `npm`; `install-command` string default `''` (empty = action's lockfile-driven install; literal `none` skips); `test-command` string default `npm run e2e`; `browsers` string default `chromium` (comma-separated list; empty/`none` skips browser install); `artifact-path` string default `''` (empty disables upload); `artifact-name` string default `e2e-artifacts`; `artifact-retention-days` number default `7`; `upload-on-success` boolean default `false`; `runs-on` string default `ubuntu-latest`; `timeout-minutes` number default `20` |
| Outputs | `e2e-passed` (`'true'` when the test command succeeded); `artifact-name` (the configured artifact name; upload only when `artifact-path` is set) |
| Secrets | none |
| Permissions | `contents: read` (caller and job) |
| Runner | `ubuntu-latest` (`runs-on` input); job timeout from `timeout-minutes` (default 20) |
| Artifacts | failure-only upload when `artifact-path` is set (`upload-on-success: false` default); retention from input; `if-no-files-found: warn` |
| Stability | optional-input additions are minor; command/browser default changes are minor but documented in release notes; output/check-context renames are major per §7.9 |

**Behavior:**
- No `tracker-ref` and no tracker checkout: the workflow checks out the adopter repository, then self-checks the tracker action source to `.tracker-actions` using its own `job.workflow_repository`/`job.workflow_sha`, and runs `setup-node-cache` (§7.8) with the node/working-directory/package-manager/install inputs.
- Browser policy: `browsers` is a comma-separated list; on Linux the install is `npx playwright install --with-deps <browsers>`, on other runners the plain install; empty or `none` skips the step for projects that manage their own browsers. There is no Playwright browser cache in v1.4.0.
- `test-command` runs from `working-directory` with `bash -euo pipefail`; any non-zero exit fails the job. Failure artifacts upload only after a failure (or with `upload-on-success`), only when `artifact-path` is non-empty; artifact globs are workspace-relative (not `working-directory`-relative).
- No secrets and no live third-party assertions in the wrapper: tests must stub external services; the browser download is an install step. No `pull_request_target`; `contents: read` only.

**Consumers:** adopting repositories using [`profiles/e2e/e2e.yml`](../profiles/e2e/e2e.yml) (context `e2e / e2e`) and the template's `e2e-fixture.yml` plumbing fixture (`e2e-fixture / e2e`). Playwright/browser validation is CastDeck C3 after the v1.4.0 tag; the template fixture proves wiring only.

**Migration note (v1.3.x adopters):** copied E2E jobs reported their project-specific job context (for example `e2e`); the reusable caller reports `e2e / e2e`. Update branch protection in the same PR that upgrades the pin (major per §7.9), and promote to required only after the §2.2 criteria are met.

### 7.4 `reusable-desktop-smoke.yml` — desktop smoke contract (shipped)

| Interface | Definition |
|---|---|
| Inputs | `runner-label` default `macos-15`; `node-version`; `working-directory`; optional `install-command`/`build-command`; required `smoke-command`; optional `artifact-path`/`artifact-name`/`artifact-retention-days` |
| Outputs | `smoke-passed`, `artifact-name` |
| Secrets | none |
| Permissions | `contents: read` |
| Runner | macOS (input-controlled); timeout 30 min |
| Artifacts | smoke logs + summary |
| Stability | command inputs are required strings; changing their semantics is major; runner-label default changes are minor |

#### 7.4.1 Remote-only local guard (`guard-local-suite.mjs`, shipped)

The desktop-smoke suite is disruptive locally, so local visible runs are machine-blocked by the
optional remote-only policy. Config (`tracker.config.json`, absent = no-op):

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

| Interface | Definition |
|---|---|
| CLI | `node scripts/adopt/cli/guard-local-suite.mjs --suite <id> [--mode enforce|report] [--hidden] [--json] [--root DIR] [--config FILE]`; offline (reads config only, no GitHub API) |
| Remote signal | `GITHUB_ACTIONS === 'true'` **only**; a local `CI=true` is not remote |
| `enforce` (default) | visible local run exits 1 with workflow/PR-label/hidden/override/docs instructions (`BLOCKED_LOCAL_VISIBLE`); remote, declared hidden local (`--hidden`), and override-env runs are allowed |
| `report` | local runs print `DEFERRED_REMOTE suite=... workflow=... prLabel=... overrideEnv=... docs=...` and exit 0 for verify aggregators (`--json` for object form) |
| Override | suite `overrideEnv` truthy ⇒ allowed with a loud warning; deliberate human debugging only — agents must never set it |
| Playwright helper | `scripts/adopt/lib/playwright-remote-guard.mjs` exports `createPlaywrightRemoteGuard({ suite, hidden, config, configPath, env })` returning a `globalSetup` function; no `@playwright/test` import; throws before any window is created |
| Config validation | `validate-config` + `verify:tooling` reject bad `localMode`/`overrideEnv`/unknown keys and duplicate suite ids |
| Caller wiring | Remote run stays label/path-gated in the caller (`run-desktop-smoke`); local wrappers are `npm run guard:local-suite -- --suite desktop-smoke` (visible) and `... --hidden` (hidden local). See [profiles/desktop](../profiles/desktop/README.md) |

Hidden local = fast, non-authoritative feedback; the remote visible run is the release evidence.

### 7.5 Release workflow contract

**Availability:** `reusable-release.yml` is the shipped reusable contract (T10). Its only runnable
in-repo caller is `.github/workflows/release.yml` (generic); the macOS/container/package callers are
non-runnable copy examples under `profiles/release/reusable/` (copy into `.github/workflows/` and pin
the adopted tag), with standalone copy-mode templates under `profiles/release/copy/`.

| Interface | Definition |
|---|---|
| Inputs | `profile` (generic/macos/container/package) default `generic`; `version`; `tag-pattern` default `^v\d+\.\d+\.\d+$`; `dry-run` default `true`; `publish` default `false`; `artifact-globs` default `dist/**`; `checksum-algorithm` default `sha256`; `build-command`; `working-directory`; `node-version`; `macos-runner`; `macos-team-id`; `macos-signing-identity`; `image-name`; `package-registries`; `artifact-name`; `retention-days`; release metadata inputs (`release-name`, `draft`, `prerelease`) |
| Outputs | `version`, `artifacts`, `checksums-file`, `release-url` (empty on dry-run), `dry-run` |
| Secrets | `RELEASE_TOKEN` (optional, only when org policy forbids the default token for publishing); `MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_PASSWORD` (optional, desktop profile); `NPM_TOKEN` (optional, package profile when OIDC trusted publishing is unavailable) — all `required: false`; team ID / signing identity are non-secret inputs |
| Permissions | caller grants `contents: write`; `id-token: write` only for OIDC publish jobs; `packages: write` only for container profile |
| Environment | called workflow declares `environment: release`; callers cannot set the environment on a reusable-workflow job |
| Runner | `ubuntu-latest` generic/container/package; macOS for desktop |
| Artifacts | profile artifacts + `SHA256SUMS`; release assets on publish |
| Stability | profile enum additions minor; changing dry-run default, tag semantics, or output names major; required secret additions major |

Input semantics: `dry-run: true` (the default) performs the full build/validation/checksum without publishing; `publish: true` is only honored when `dry-run` is false and the ref is a matching tag or an explicit dispatch. Guards: all publish steps run only when `github.ref` matches the tag pattern or `workflow_dispatch` explicitly requested publish, inside the `release` environment. Missing signing secrets are a documented skip (ad-hoc fallback), never a silent unsigned publish.

### 7.6 `reusable-audit.yml` — tracker audit contract

**Availability:** shipped (T04) — `.github/workflows/reusable-audit.yml`, `on: workflow_call` only, job `audit`. The template's own caller is `.github/workflows/tracker-audit.yml` (self mode passes `tracker-ref: ''`); adopters copy [`profiles/audit/tracker-audit.yml`](../profiles/audit/tracker-audit.yml) into `.github/workflows/` and pin the adopted tag/SHA. Check context: `tracker-audit / audit` (caller job `tracker-audit` / called job `audit`).

| Interface | Definition |
|---|---|
| Inputs | `tracker-ref` string default `v1.3.2` (exact tag/SHA to load `audit.mjs` from; ignored in the template repo itself); `config-path` string default `tracker.config.json` (working-directory-relative); `mode` string default `advisory` — validated `advisory`/`strict`; `json` boolean default `true` (echo the JSON result in the job log); `working-directory` string default `'.'`; `runs-on` string default `ubuntu-latest`; `node-version` string default `'22'` |
| Outputs | `ok` (`'true'`/`'false'`), `violations-count`, `warnings-count` (empty when the advisory run skips for a missing token) |
| Secrets | `TRACKER_TOKEN` (`required: false`; project read **and** repo/issues read for private adopters — classic PAT `project` + `repo`; fine-grained Projects read + Metadata read + repository contents/issues read). Advisory mode with no token: notice + clean skip (exit 0). Strict mode with no token: actionable failure |
| Permissions | `contents: read` (caller and job); project read comes only from the token |
| Runner | `ubuntu-latest` (`runs-on` input) |
| Artifacts | none — JSON is echoed to the job log (`json: true`) and a job summary is written; nothing is uploaded |
| Stability | optional input additions are minor; mode/default changes, output renames, or required-secret changes are major per §7.9 |

**Behavior:**
- Self mode is keyed on the canonical repository slug (`presljf/github-project-tracker`); the template's caller passes `tracker-ref: ''` and the script comes from the checkout. Downstream, the pinned template ref is checked out to `.tracker/` and `audit.mjs` comes from that tag.
- `mode` is validated up front (`advisory`/`strict`; invalid values fail the job). `config-path` is resolved under `working-directory`.
- Advisory mode with an empty `TRACKER_TOKEN` emits a notice and skips the audit step (job succeeds; the outputs are empty). Strict mode requires the token and fails actionably without it.
- When `json: true` the JSON result is parsed to set `ok`/`violations-count`/`warnings-count` and to write the job summary; warnings are never blocking (the script exits 0 for them). Invalid config or missing tooling fails closed.
- No artifacts, no `pull_request_target`, no write permissions; the only secret is the optional `TRACKER_TOKEN`.

**Consumers:** the template's own `.github/workflows/tracker-audit.yml` (advisory on `schedule`, `workflow_dispatch`, and `pull_request`; context `tracker-audit / audit`) and adopting repositories using [`profiles/audit/tracker-audit.yml`](../profiles/audit/tracker-audit.yml).

**Migration note (v1.3.x adopters):** the copied tracker-audit workflow reported the bare context `audit` (from its job name); the reusable caller reports `tracker-audit / audit`. Update protection in the same PR that upgrades the pin (major per §7.9); the copy-mode example header shows both pins to replace.

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

**Status: shipped** (T02) — file: `.github/actions/setup-node-cache/action.yml`; usage/interface reference: [action README](../.github/actions/setup-node-cache/README.md). Replaces the inline `actions/setup-node` + install steps the reusable workflows used to repeat.

| Interface | Definition |
|---|---|
| Inputs | `node-version` default `'22'` (version or range label such as `22`, `22.x`, `lts/*`); `package-manager` default `npm` (`npm`/`pnpm`/`yarn`); `working-directory` default `.`; `cache` boolean default `true` (cache restored only when the selected package manager's lockfile exists); `install-dependencies` boolean default `true`; `registry-url` default `''` (empty = no registry auth); `cache-dependency-path` default `''` (empty auto-detects the lockfile under `working-directory`, relative to the repo root like `actions/setup-node`); `install-command` default `''` (empty installs `npm ci` when an npm lockfile exists, otherwise skips with a notice; literal `none` always skips) |
| Outputs | `node-version`, `cache-hit` (`'true'`/`'false'`; empty when caching is off) |
| Secrets | none; registry auth stays in the caller and is configured before/after the action |
| Consumers | `reusable-ci.yml`, `reusable-desktop-smoke.yml`, `reusable-e2e.yml`. Reusable workflows cannot see the caller's local actions, so they first check the tracker repository out again using the reusable workflow's own `${{ job.workflow_repository }}`/`${{ job.workflow_sha }}` into `.tracker-actions` and then use `./.tracker-actions/.github/actions/setup-node-cache` (same version as the reusable workflow the caller pinned). In-repo callers use `./.github/actions/setup-node-cache`; adopters may also consume the action directly by pinned exact tag/SHA. |
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
- This catalog's docs version moves with the template release; a contract change must update this page, the [REFERENCE](./REFERENCE.md#13-workflow-catalog) summary, and the changelog in the same release.
- Deprecations: announce in the release notes, keep the old interface one minor release with a warning in the job summary, then remove in the next major.

### 7.10 `reusable-contract.yml` — contract + metadata verification contract

**Availability:** shipped (T03) — `.github/workflows/reusable-contract.yml`, `on: workflow_call` only. The template's own thin caller is `.github/workflows/tracker-contract.yml` (self mode passes `tracker-ref: ''` so the contract and tooling come from the caller checkout). Adopters copy the caller example from [`profiles/contract/`](../profiles/contract/README.md) into `.github/workflows/tracker-contract.yml` and pin the adopted tag/SHA. Behavior summary: §2.8.

| Interface | Definition |
|---|---|
| Inputs | `tracker-ref` string default `v1.3.2` (exact template tag/SHA to load the adoption contract + verification tooling from; self mode passes `''` to use the caller checkout); `config-path` string default `tracker.config.json` (working-directory-relative; default `.` = repository root; feeds `verify-tooling` only); `contract-path` string default `''` (empty auto-detects `contract/adoption-contract.json` in self mode and `.tracker/contract/adoption-contract.json` downstream); `runs-on` string default `ubuntu-latest`; `version-guard-command` string default `''` (optional trusted offline command; runs in a separate `version-guard` job that never checks out the pinned template ref); `metadata` boolean default `true` (live metadata job; requires the secret; pass `false` on fork PRs); `working-directory` string default `'.'`; `submodule-path` string default `.tracker-os` (tracker submodule whose pinned tag `verify-tooling` checks; missing → notice + skip); `node-version` string default `'22'` |
| Outputs | `contract-ok` (`'true'` when `verify-tooling` and `verify-contract` both pass); `metadata-ok` (`'true'` when the metadata job passes; empty when the job is skipped) |
| Secrets | `TRACKER_TOKEN` (`required: false`; required only when `metadata: true`) — project read (Projects read + Metadata read); PAT ≤90 days or a GitHub App installation token; pass explicitly by name, never `secrets: inherit` |
| Permissions | `contents: read` only (workflow and both jobs); no write scopes, no artifacts, no `pull_request_target` |
| Runner | `ubuntu-latest` (`runs-on` input) |
| Artifacts | none — job logs/summary only |
| Stability | optional input/output additions are minor; changing a default (for example `metadata`), adding required inputs, renaming outputs, or changing the emitted check contexts is major per §7.9 |

**Jobs and check contexts:** one caller job (named `tracker-contract` in the profile example) calls this workflow and produces two check runs — `tracker-contract / contract` and `tracker-contract / metadata` (the metadata run is skipped when `metadata: false`); setting `version-guard-command` adds a third `version-guard` job/check. v1.3.x copies emitted `tracker-contract` and `tracker-metadata`; see the migration note below.

**Behavior:**
- The contract job checks out the adopter repository with `submodules: recursive`, then in downstream mode checks the pinned template ref into `.tracker/`; self mode (`github.repository` equals the canonical template slug) uses the caller workspace instead. The contract and verification tooling always come from the pinned tracker checkout (or the workspace in self mode) — never from a local copy, and never from the PR merge SHA.
- It fetches tags for `submodule-path` when that directory is a git checkout so `verify-tooling` can check the pinned `.tracker-os` tag; a missing/non-git path logs a notice and skips that check. An optional `version-guard-command` runs in a **separate `version-guard` job** (no pinned-template checkout, no secrets) from `working-directory`; it must be trusted and offline (no runtime fetch).
- The job then runs `verify-tooling` (with the resolved `config-path`) and `verify-contract`; both must pass for `contract-ok: 'true'`.
- The metadata job runs only when `metadata` is true, requires `TRACKER_TOKEN` (fails with an actionable message when unset), and runs `verify-metadata --repo <github.repository> --contract <contract>` from `working-directory` with the token as `GH_TOKEN`.
- `config-path` only feeds `verify-tooling`; `verify-contract`/`verify-metadata` read the repository-root/`working-directory` `tracker.config.json`, so keep `project.number` set there for metadata checks.
- No artifacts are uploaded, no write permissions are requested, and there is no `pull_request_target` path; fork PRs get no secrets and should pass `metadata: false`.

**Consumers:** the template's own `.github/workflows/tracker-contract.yml` self caller (required checks in this repository) and adopting repositories that copy [`profiles/contract/tracker-contract.yml`](../profiles/contract/tracker-contract.yml) into `.github/workflows/` and pin the adopted tag/SHA. Release workflows do not call this contract.

**Migration note (v1.3.x adopters):** replace the copied `tracker-contract.yml` + `tracker-metadata.yml` workflows with one caller that pins this reusable workflow. The old contexts `tracker-contract`/`tracker-metadata` become `tracker-contract / contract` and `tracker-contract / metadata`; update branch protection/ruleset required checks in the same PR that upgrades the pin (major per §7.9) and keep the old copies until the new contexts are green. Full steps, token setup, and local verification: [profiles/contract/README.md](../profiles/contract/README.md).

### 7.11 `reusable-post-merge-audit.yml` — post-merge bypass audit contract

**Availability:** shipped (T04) — `.github/workflows/reusable-post-merge-audit.yml`, `on: workflow_call` only, job `audit`. The template's own caller is `.github/workflows/post-merge-audit.yml` (self mode, `tracker-ref: ''`); adopters copy [`profiles/audit/post-merge-audit.yml`](../profiles/audit/post-merge-audit.yml) into `.github/workflows/` and pin the adopted tag/SHA. Check context: `post-merge-audit / audit` (caller job `post-merge-audit` / called job `audit`).

| Interface | Definition |
|---|---|
| Inputs | `tracker-ref` string default `v1.3.2` (exact tag/SHA for the audit tooling; ignored in the template repo itself); `config-path` string default `tracker.config.json` (working-directory-relative; required-check names come from `guard.requiredChecks[]`); `working-directory` string default `'.'`; `pr-number` string default `''` (empty resolves `github.event.pull_request.number`; manual dispatch must pass it); `runs-on` string default `ubuntu-latest`; `node-version` string default `'22'` |
| Outputs | `ok` (`'true'` when the audit job completed; a detected bypass still completes by opening the OI, and a degraded rollup passes with a warning) |
| Secrets | none — the automatic `GITHUB_TOKEN` is used |
| Permissions | called job declares `contents: read`, `issues: write`, `pull-requests: read`, `checks: read`, `statuses: read`, `actions: read`; the caller must grant at least that union |
| Runner | `ubuntu-latest` (`runs-on` input) |
| Artifacts | none — job summary only |
| Stability | optional input additions are minor; changing the required permission union, output names, trigger semantics, or the emitted check context is major per §7.9 |

**Behavior:**
- Resolves the target PR from `pr-number` or the triggering event, then `post-merge-audit.mjs` **re-validates `state == MERGED` through the API** before auditing (the reusable workflow stays transport-only — no raw `gh` steps); a dispatch for an open/closed-unmerged PR fails actionably instead of auditing it.
- Runs `post-merge-audit.mjs --config <config-path>` from `working-directory` with `GH_TOKEN` (automatic), `GITHUB_REPOSITORY`, and `PR_NUMBER`: required checks from `guard.requiredChecks[]`, closing-keyword/partial-PR rules, and an OI on a real bypass.
- On a real bypass it opens a `tracker-contract-exception` OI (advisory record, not a red X) and the job completes (`ok: 'true'`). An unreadable `statusCheckRollup` — missing `checks`/`statuses`/`actions` read — degrades loudly (warning + job summary) to closure-only auditing and exits 0, so it cannot create a false check-related OI. Non-permission/API errors still fail closed.
- Fork caveat: fork-originated `pull_request` events get a read-only `GITHUB_TOKEN` by default, so `issues: write` (OI creation) can fail; the audit fails loudly rather than silently skipping. Enable "Send write tokens to workflows from pull requests" only as a documented decision.
- No artifacts, no `pull_request_target`, no secrets beyond the automatic token. Self mode is keyed on the canonical repository slug; downstream checks the pinned ref into `.tracker/`.

**Consumers:** the template's own `.github/workflows/post-merge-audit.yml` (context `post-merge-audit / audit`) and adopting repositories using [`profiles/audit/post-merge-audit.yml`](../profiles/audit/post-merge-audit.yml).

**Migration note (v1.3.x adopters):** the copied post-merge workflow reported the bare context `audit` (its job name matched the tracker audit's); the reusable caller reports `post-merge-audit / audit`. Keep the same caller permission union, update branch protection in the same PR (major per §7.9), and update `guard.requiredChecks[]` to the new reusable contexts — otherwise the audit flags every merge as a bypass.

### 7.12 `reusable-pr-close-guard.yml` — PR close guard contract

**Availability:** shipped (T04) — `.github/workflows/reusable-pr-close-guard.yml`, `on: workflow_call` only, job `guard`. The template's own caller is `.github/workflows/pr-close-guard.yml` (self mode, `tracker-ref: ''`); adopters copy [`profiles/audit/pr-close-guard.yml`](../profiles/audit/pr-close-guard.yml) into `.github/workflows/` and pin the adopted tag/SHA. Check context: `pr-close-guard / guard` (caller job `pr-close-guard` / called job `guard`).

| Interface | Definition |
|---|---|
| Inputs | `tracker-ref` string default `v1.3.2` (exact tag/SHA for the guard tooling; ignored in the template repo itself); `pr-number` string default `''` (empty resolves `github.event.pull_request.number`; manual invocations must pass it); `runs-on` string default `ubuntu-latest`; `node-version` string default `'22'` |
| Outputs | none (pass/fail job) |
| Secrets | none — the automatic `GITHUB_TOKEN` is used |
| Permissions | called job declares `contents: read`, `issues: read`, `pull-requests: read`; the caller grants the same read-only union. No `issues: write` is required or granted |
| Runner | `ubuntu-latest` (`runs-on` input) |
| Artifacts | none |
| Stability | optional input additions are minor; permission increases, output/check-context changes, or trigger-semantics changes are major per §7.9 |

**Behavior:**
- Resolves the target PR from `pr-number` or the triggering event, then fetches the live PR and referenced issues through the API (event env vars are optional — this is robust against stale payloads).
- Enforces: task PRs carry a closing keyword targeting a task issue; `partial` PRs use `Refs`/`Part of` and never a closing keyword; closing a sprint/release/stream tracker is rejected; closing references to missing issues fail.
- Read-only by design: the older copy-mode assumption that the guard needed `issues: write` is obsolete — the script only reads. A future write requirement would be a documented permission increase and caller change (§7.9).
- Fork PRs are supported: the read-only token is sufficient and no secrets are involved. No artifacts, no `pull_request_target`.

**Consumers:** the template's own `.github/workflows/pr-close-guard.yml` (required context `pr-close-guard / guard`) and adopting repositories using [`profiles/audit/pr-close-guard.yml`](../profiles/audit/pr-close-guard.yml).

**Migration note (v1.3.x adopters):** the copied guard reported the bare context `pr-close-guard`; the reusable caller reports `pr-close-guard / guard`. Update branch protection/rulesets in the same PR that upgrades the pin (major per §7.9).

### 7.13 `reusable-counts.yml` — counts docs verification contract

**Availability:** shipped (T05) — `.github/workflows/reusable-counts.yml`, `on: workflow_call` only, job `counts`. The template's own caller is `.github/workflows/counts-docs.yml` (self mode passes `tracker-ref: ''`; the repo has no `docs.counts` policy yet, so its run is a documented no-op); adopters copy [`profiles/counts/counts-docs.yml`](../profiles/counts/counts-docs.yml) and pin both refs. Check context: `counts-docs / counts` (caller job `counts-docs` / called job `counts`).

| Interface | Definition |
|---|---|
| Inputs | `tracker-ref` string default `v1.3.2` (exact tag/SHA to load `guard-docs-counts.mjs` from; ignored in the template repo itself); `config-path` string default `tracker.config.json` (repository-root-relative; `docs.counts` configures the contract); `runs-on` string default `ubuntu-latest`; `node-version` string default `'22'` |
| Outputs | `counts-ok` (`'true'` when the guard passed, or when no `docs.counts` policy is configured) |
| Secrets | none |
| Permissions | `contents: read` (caller and job) |
| Runner | `ubuntu-latest` (`runs-on` input) |
| Artifacts | none — console output only |
| Stability | optional-input additions are minor; changing the guard invocation, output names, or the emitted check context is major per §7.9 |

**Behavior:**
- Self mode is keyed on the canonical repository slug; the template's caller passes `tracker-ref: ''` and reads the guard from its checkout. Downstream checks the pinned template tag out to `.tracker/`.
- Runs `guard-docs-counts.mjs --root <GITHUB_WORKSPACE> --config <config-path>`: validates the committed baseline (schema + named-skip/reviewed agreement), regenerates the expected generated doc, and fails when that doc or any configured inline marker is stale. It never runs the suite inventory and never uploads artifacts.
- Absent `docs.counts` config is a documented no-op — `docs counts guard: docs.counts is not configured (no-op).`, exit 0 — so adopting the caller before wiring counts is safe. The template repository itself is in this state; real-baseline validation is CastDeck C3 after the v1.4.0 tag.
- No secrets, no artifacts, no `pull_request_target`; `contents: read` only. Missing config/tooling fails actionably.

**Consumers:** the template's own `.github/workflows/counts-docs.yml` (no-op until counts are adopted; context `counts-docs / counts`) and adopting repositories using [`profiles/counts/counts-docs.yml`](../profiles/counts/counts-docs.yml). The suite-side inventory and `suite-counts check` job stay adopter-side ([profiles/counts/README.md](../profiles/counts/README.md)).

**Migration note (v1.3.x adopters):** the counts docs check is new in v1.4.0 (no old context). Adopters wiring `docs.counts` add this caller as `counts-docs / counts` and make it required once the policy is live; before that it is a no-op.

---

## 8. Hybrid D adoption model

"Hybrid D" means: **reusable contracts for generic jobs + thin copied callers/profile files for project-specific glue**. The template owns interfaces and implementations; adopting projects own triggers, config, and build/publish specifics. There is no automatic template sync.

### 8.1 Model

```text
Template repo (presljf/github-project-tracker, pinned vX.Y.Z)
├── .github/workflows/reusable-*.yml        reusable contracts (§7)
├── .github/workflows/<internal>.yml        internal runners; release.yml is the only runnable release caller
├── .github/actions/<name>/action.yml       composite contracts (§7.8)
├── profiles/release/reusable/*.yml         NON-RUNNABLE reusable-mode caller examples (copy + pin)
├── profiles/release/copy/*.yml             NON-RUNNABLE copy-mode caller templates
└── config schema/example + docs            versioned interfaces
                    │
                    ▼  (reusable mode: cross-repo ref @exact pin)
Adopting repo (thin caller + project config)
├── .github/workflows/ci.yml                caller: triggers/inputs/permissions
├── .github/workflows/release.yml           caller: copied from profiles/release/ + pinned ref
├── .github/actions/… (only if copied)      copy fallback, origin recorded
└── tracker.config.json                     mode/ref/profile/tokenSecret/templateVersion

If private cross-repo reuse is blocked → copy thin callers/composite actions
(never edit reusable contracts locally), pin the template version, upgrade via UPGRADING.
GitHub executes only .github/workflows/; files under profiles/ are copy sources and never run in place.
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
2. Copy only the thin caller(s) and the composite action directory from the pinned template tag (download the release archive, do not copy from `main`). Release callers are copy sources under `profiles/release/reusable/` (reusable-mode caller: copy into `.github/workflows/`, then replace the pinned `uses: ...@v1.3.2` ref with the tag you adopted) and `profiles/release/copy/` (standalone copy-mode callers). `profiles/` is never executed by GitHub, so a copied caller must land in `.github/workflows/` to run.
3. Record in the project docs/config: copied file list, origin template version/ref, local overrides, and `workflows.ci.mode: copy`.
4. Preserve contract names and guards: same input/secret names, same dry-run/tag/environment guards, same permission model. Project-specific changes are minimal, commented, and listed as overrides.
5. Run local parity (§6), then one advisory PR run before promoting/requiring anything.
6. On upgrade: re-copy fresh files, re-apply the documented overrides, diff-review, and run the same validation; never hand-merge silently.

### 8.5 Private/public cross-repo reuse validation (before choosing reusable mode)

**Result recorded 2026-11-11:** a private downstream repo could not resolve `presljf/github-project-tracker/.github/workflows/reusable-ci.yml@v1.2.1`; GitHub failed with “workflow was not found.” The template was then made **public**; the same downstream test resolved and ran both the reusable CI workflow and the remote `checksum` composite action successfully. Public access is the validated no-copy path. Copy-mode remains documented as fallback; branch protection/private vulnerability reporting remain T03/T04.

Run these on a scratch private repo with read access to the template that pins the release; record commands/results in the release or adoption tracker:

- [ ] Reusable workflow ref parses from the scratch repo: `uses: presljf/github-project-tracker/.github/workflows/reusable-ci.yml@v1.2.1` → runs, or fails with an explicit visibility/permission error (the error text is the evidence).
- [ ] Composite action ref works: `uses: presljf/github-project-tracker/.github/actions/checksum@v1.2.1`.
- [ ] Caller-granted permissions are sufficient; called workflow cannot exceed them.
- [ ] Explicit secret passing works (`secrets: TRACKER_TOKEN: ${{ secrets.TRACKER_TOKEN }}`), and the audit workflow skips cleanly when the secret is absent.
- [ ] Required check display names match the documented contract after one green run.
- [ ] Audit-family contexts (`tracker-audit / audit`, `post-merge-audit / audit`, `pr-close-guard / guard`) captured from a green run before protecting.
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

Audit-family callers use the reusable workflows instead of inline skip logic — the skip/fail policy
lives in `reusable-audit.yml` (§7.6): advisory mode with no token prints a notice and skips (exit 0),
strict mode fails actionably. Call shape:

```yaml
jobs:
  audit:
    permissions:
      contents: read
    uses: presljf/github-project-tracker/.github/workflows/reusable-audit.yml@v1.4.0
    with:
      mode: advisory        # strict for a release-gate opt-in
    secrets:
      TRACKER_TOKEN: ${{ secrets.TRACKER_TOKEN }}   # optional in advisory mode
```

The post-merge audit and PR close guard consume the automatic `GITHUB_TOKEN` and pass no secret
(§7.11, §7.12); their caller permissions are the least-privilege contracts documented there.

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

### 10.1 Implementation status

Machine-checkable implementation status — every class, path, status, audience, and docs anchor — is generated from the repo-surface manifest: see [SURFACE](./SURFACE.md). Edit `contract/repo-surface.json`, run `npm run surface:render`, and the `verify:surface` + `render-surface --check` gates (CI, §10.2) enforce the truth. The hand-maintained deliverable table that used to live here was replaced in T02 to prevent status drift.

### 10.2 Validation gates for T15 and release

- [ ] `actionlint .github/workflows/*.yml` passes (or the documented equivalent) — workflow files, not just docs snippets.
- [ ] Callers validate from a scratch repo: reusable and copy modes both exercised (§8.5).
- [ ] Required check names captured from a green run and documented; aggregate `ci-gate` present; no `paths` filter on required workflows.
- [ ] Secret-less CI run passes; fork-PR behavior verified (no secrets, read-only token).
- [ ] Dispatch dry-run for release leaves no release/assets behind; tag guard rejects a non-matching tag (test on a scratch repo).
- [ ] Signing/checksum actions skip cleanly when secret inputs are empty and fail loudly on bad input.
- [ ] Audit caller still skips cleanly with an unset `TRACKER_TOKEN`, and strict mode fails on violations.
- [ ] E2E fixture run recorded (or the CastDeck C3 dependency recorded for the Playwright/browser path).
- [ ] Counts-docs caller green (the template repo's documented no-op until C3; baseline/doc/markers current once `docs.counts` is adopted).
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
| [Playbook §10 — Actions / CI-CD contract](./GITHUB_PROJECT_TRACKER_PLAYBOOK.md#10-actions-and-ci-cd-contract) | Conceptual model and portfolio-level decisions |
| [REFERENCE §13–16 — workflow, token, runner, release profiles](./REFERENCE.md#13-workflow-catalog) | Quick lookup tables |
| [UPGRADING — version semantics, copy vs reusable, rollback](./UPGRADING.md#copy-vs-reusable) | How pins, copied files, and contract upgrades move |
| [ADOPTION §5 — audit, CI, protection](./ADOPTION.md#5-audit-ci-protection) | Where CI/audit/token decisions fit adoption |
| [HOW TO USE §13 — audit](./HOW_TO_USE.md#13-audit) | Manual audit checklist until automation is stable |
| [Node profile command mapping](../profiles/node/README.md#command-mapping) | Local parity for lint/format/verify |
| [profiles/contract](../profiles/contract/README.md) | Reusable-mode contract + metadata caller, token setup, check-name mapping, and v1.3.x migration steps |
| [profiles/audit](../profiles/audit/README.md) | Reusable-mode audit-family callers (tracker audit, post-merge audit, PR close guard), caller permissions, check-name mapping, token setup, rollback |
| [profiles/e2e](../profiles/e2e/README.md) | Reusable Playwright E2E caller: advisory→required gating, browser/artifact policy, monorepo working-directory, check-name mapping, C3 note |
| [profiles/counts](../profiles/counts/README.md) | Verified counts contract wiring, reusable counts-docs caller, markers/update workflow |
| [tracker config schema](../schemas/tracker.config.schema.json) | `workflows.ci`, `workflows.audit`, `workflows.release` contract keys |
| [SECURITY.md](../SECURITY.md) | Private vulnerability reporting; never expose tokens |
| [Shipped audit workflow](../.github/workflows/tracker-audit.yml) | Current advisory baseline and skip behavior |
| [GitHub: reusing workflows](https://docs.github.com/en/actions/sharing-automations/reusing-workflows) · [OIDC hardening](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect) · [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) | Upstream behavior reference for integrators |


## Lint/format self-check (T18)

Tracker OS now self-applies ESLint and Prettier: `npm ci`, `npm run lint`, and
`npm run format:check`. A missing or broken lint/format command fails CI rather than succeeding
as a no-op. Dev tooling is approved in `tracker.dependencies.json`; see issue #82.

**Branch hygiene guard:** `main-history-guard.yml` runs on push to main, verifies commits are
associated with merged PRs, and opens a `tracker-contract-exception` OI for direct commits. Hooks
prevent the common cases locally; this is the remote backstop.
