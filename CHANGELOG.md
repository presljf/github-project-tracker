## [1.0.2] — 2026-11-11

- Migrate release-profile defaults/callers from retired `macos-14` to `macos-15`.
- Make release artifact matching portable on macOS bash 3.2 (avoid `globstar`/globstar).
- Correct the macOS runner-image retirement diagnosis in release docs.
- Refresh template pin to `1.0.2`.

# Changelog

All notable changes to Project Tracker OS are documented here. The format follows semantic versioning; see [docs/UPGRADING.md](docs/UPGRADING.md).

## v1.4.0 — Reusable verification workflows, repo-surface cleanup, required adoption contract

Minor release (D1 second delivery). **Breaking for adopters that re-pin (D3):** six new reusable
callers are now required and must be present, pinned to the exact `@v1.4.0` release tag, with a
matching `tracker-ref`; the scripts tree moved to class-first families with no shims, and release
caller examples moved under `profiles/`. Read the consolidated old→new table and rollback rules in
[UPGRADING § v1.4.0](docs/UPGRADING.md#v140-breaking-class-first-script-families-and-non-runnable-release-examples)
before upgrading a pin.

- **Repo surface + scripts reorg (T01, #134):** `contract/repo-surface.json` classifies every
  workflow/action/profile/script/doc audience; blocking `verify-surface` guard (SURFACE_* codes)
  wired into CI; scripts moved to `scripts/adopt/{cli,lib,docs}` + `scripts/internal` (no shims,
  stable `npm run` aliases); release examples moved to `profiles/release/reusable/`; migration docs.
- **Catalog truth + setup-node-cache + batching + debt guard (T02, #137):** shipped
  `.github/actions/setup-node-cache` consumed by the reusable workflows; generated `docs/SURFACE.md`
  and the catalog §2 status block; `npm run gate:local` ordered checkpoint (skip-not-pass);
  generated `docs/TECH_DEBT.md` + debt register/guard; coverage baseline.
- **Contract + metadata reusable (T03, #138):** `reusable-contract.yml` with `contract`/`metadata`
  jobs and an isolated `version-guard`; dogfooded self caller; `profiles/contract` + check-name
  migration docs; `release:bump` covers `tracker-ref` pins; tooling-profile metadata gap recorded
  as accepted debt `debt-019`.
- **Audit family reusables (T04, #139):** `reusable-audit.yml` (advisory/strict, optional
  `TRACKER_TOKEN`), `reusable-post-merge-audit.yml` (caller-granted audit scopes, script-owned
  merged-state revalidation), `reusable-pr-close-guard.yml` (read-only); tracker callers converted
  to thin dogfooded wrappers; branch protection + `guard.requiredChecks` migrated in the same
  window; transport-only rule preserved (no raw `gh` in workflows).
- **E2E + counts reusables (T05, #140):** `reusable-e2e.yml` Playwright wrapper consuming
  `setup-node-cache` via `job.workflow_repository`/`job.workflow_sha`, failure-only pinned
  artifacts; `reusable-counts.yml` counts-docs guard (no suite inventory); live `counts-docs /
  counts` no-op and `e2e-fixture` dispatch proof; tracked `node_modules` symlink removed and
  `.gitignore` fixed.
- **Required adoption contract + release gate (T06, #141):** the six v1.4.0 callers are
  `requiredWorkflows` in `contract/adoption-contract.json`; `verify-contract` enforces presence, the
  exact `@v1.4.0` tag, and a matching `tracker-ref` (line-anchored, job-scoped; commented/expression
  bypasses rejected); `reusable-release.yml` gains an opt-in `contract-gate` (default false,
  `contents: read` only) that runs `verify-tooling` + `verify-contract` + the offline release gate
  before build; new `guard:hygiene` tracked-file check wired into `gate:local` (17 steps) and CI.
- **Local-first batching + health:** `gate:local` one-command checkpoint, batch/evidence conventions,
  debt register + expiry/label guard, generated tech-debt report, and bounded low-risk fixes.
- **Docs/version record:** UPGRADING six-caller migration table + required-contract rules + opt-in
  release gate + post-tag CastDeck C1–C3 verification; ADOPTION / ACTIONS CATALOG / CI SECURITY
  PROFILE / GUARD DISTRIBUTION / REFERENCE / RELEASE PROFILES / profile READMEs refreshed; version,
  docs version, contract metadata, examples, and reference cards at **v1.4.0**; `docs/SURFACE.md` +
  `docs/TECH_DEBT.md` regenerated.
- **Known limitations:** the reusable release gate enforces the offline contract half only; the open
  `tracker-contract-exception` OI check stays the release-procedure step
  (`npm run gate:release -- --repo owner/repo`) because requiring `issues: read` would invalidate
  existing caller permission grants. `debt-019` (tooling-profile-aware `verify-metadata`) remains
  accepted for v1.5.0. Real Playwright/browser and counts-baseline downstream validation is CastDeck
  C3 after the tag; the template's E2E fixture proves wiring only (`browsers: none`).
- **Verification:** 421 tests, `GATE_LOCAL_OK 17/17`, docs check 64 md, surface 131 entries
  (130 shipped/1 contract-only), self-repo `verify:tooling`/`verify:contract`/`gate:release`; live
  release dry-run `43480677464` on the release head (contract-gate/build/checksum success, publish
  skipped). The release PR's post-merge audit and stream close evidence will be recorded on #142/#132.

## v1.3.2 — Patch release: post-v1.3.0 fixes + close-out reconciliation

Patch release of the v1.3.0 contract surface: fixes merged to `main` after the v1.3.0 tag, with no
v1.4.0 reusable-workflow API change. The annotated `v1.3.2` tag is the version record.

- **Adopt the tooling work profile in this repository** (#123): `workProfile: "tooling"` lands
  post-tag (the v1.3.0 tag records the contract; subsequent deliveries are `[Stream]` → Task with
  tag-based version records). Product history stays valid.
- **Fix live `[Stream]` open:** use the GraphQL `ProjectV2SingleSelectField` shape for the
  `gh project field-create` fallback so `stream.mjs open` works against live project fields (#124).
- **Document the tag-only v1.3.0 release record** (#127): release evidence lives on #116; no GitHub
  Release/artifacts for tag-only contract releases.
- **Post-merge-audit caller permissions correction:** add `actions: read` on top of `checks: read` +
  `statuses: read`. `gh pr view --json statusCheckRollup` also resolves `checkSuite.workflowRun`,
  which needs Actions read — without it private-repo merged-PR audits degrade to closure-only
  (observed on CastDeck run `43276236147`: success-but-degraded despite `checks: read`).
  Docs corrected (ACTIONS CATALOG / CI SECURITY PROFILE / REFERENCE); the v1.3.0 tag predates the
  correction, which ships in this v1.3.2 patch (#129).
- **Close-out Project-status reconciliation + hierarchy integrity** (#131): new advisory audit
  warning `PROJECT_STATUS_STALE` for closed project items not `Done` (never changes the exit code,
  including `--strict`), new violation `SPRINT_HIERARCHY_MISSING_RELEASE` for an open product sprint
  with no `[Release]` ancestor (closed/historical and tooling exempt), and a new `reconcile-status`
  command (`npm run reconcile:status`; report-only default, `--apply`, `--json`) to list and fix
  status drift left by `Closes #` auto-closes. Close-out and hierarchy verification procedures are
  documented (REFERENCE §5.8–5.9, AGENT GUIDE, PLAYBOOK, close templates); adopters running
  `--strict` audits should expect the new sprint-hierarchy check (see UPGRADING).
- **Version pins refreshed** to `1.3.2` across config, contract metadata, docs headers, examples and
  reference cards (cards rebuilt).

## v1.3.0 — Verification & documentation contract

- Add the enforced **tooling work profile** (`workProfile: "product" | "tooling"`, default
  `product`; absent config keeps `product`): `[Stream]` container → Task lifecycle with a `Stream`
  project field, tooling DoR/WIP/`done` enforcement, `stream.mjs open|close` lifecycle gates,
  mode-aware audit, safe single-select project-field option append, and a `profiles/tooling/`
  selection guide. Product behaviour and historical records are unchanged.
- Add the enforced **remote-only / hidden-local verification suite policy**
  (`verification.remoteOnly[]`, absent = no-op): offline `guard-local-suite.mjs` with
  `enforce`/`report` modes, strict `GITHUB_ACTIONS === 'true'` remote detection, loud
  human-only override env, `DEFERRED_REMOTE` aggregator output, a dependency-free Playwright
  `globalSetup` factory (`playwright-remote-guard.mjs`), schema/validate-config/verify-tooling
  validation, and docs for the hidden-local (non-authoritative) vs remote-visible (evidence) split.
- Add the **verified PASS/FAIL/SKIP counts contract** (`docs.counts`, absent = no-op): committed
  per-suite/mode baseline with named+agreed `knownSkips` and `reviewed` evidence, counted-runner
  parsers (Playwright JSON, node-test summary/TAP, verify-json), `compareResults` drift on counts and
  skip identity, flaky>0/hard-fail policy, `check`/`record`/`render` CLI with deterministic
  `docs/TEST_COUNTS.md` + inline markers, and `guard:docs:counts` docs/staleness guard with historical
  exemption.
- Harden the **post-merge bypass audit**: caller permissions now include `checks: read` +
  `statuses: read` (documented in ACTIONS_CATALOG/REFERENCE/CI_SECURITY_PROFILE), required check
  names are configurable via `guard.requiredChecks[]` (backwards-compatible default), and an
  unreadable `statusCheckRollup` degrades loudly to a metadata-only closure audit (warning + job
  summary, advisory exit 0, no false check-related OI; real closing-keyword violations still open an
  OI; other errors still fail).
- Fix contract verification for the **contract's own repository**: `verify-contract`/`release-gate`
  detect `config.repository === contract.repository`, print an explicit
  `self-repo: downstream contract checks skipped` result, keep version/config alignment enforced, and
  let `stream.mjs close`'s default gate command work for Tracker OS Streams (T06 prerequisite).
  Downstream repositories keep the full downstream-adopter checks.
- Release housekeeping: version plus docs/cards/contract pins bumped to **v1.3.0**; no downstream
  adoption in this release (CastDeck pins v1.3.0 separately in Sprint 0.5.7).

## v1.2.2 — Qualified release tooling

- Add `release:bump` with explicit allowlist, exclusions, dry-run diff, and v/dotted-key preservation.
- Stabilize lockfile resolution and historical-doc handling after the v1.2.1 release.
- No downstream contract change.

## v1.2.1 — Tooling contract

- Shared `profiles/node/eslint.config.mjs` baseline.
- Tooling section in the adoption contract with ESLint/Prettier/globals ranges.
- `verify:tooling`: version ranges, exact `.tracker-os` tag, shared baseline import, and undeclared-override rejection.
- Tracker lint runs through the shared baseline.

## v1.2.0 — Downstream contract hardening

- Reusable desktop-smoke workflow + thin caller contract.
- Adoption contract manifest/verifier, no-admin merge enforcement, PR closure guard, post-merge bypass audit, release gate.
- Docs/version consistency, cards/PDF regeneration, clean-tree/dependency preflight.
- Remote macOS release fallback + checksum verifier.
- Self-applied ESLint/Prettier.
- Project metadata contract/verifier, historical reconciliation, branch-hygiene hooks, main-history detection.

## v1.0.0 — 2026-11-11 (release candidate; tag pending T08 live validation + release close)

> The `v1.0.0` tag is created only after T08 replication/upgrade validation and T12 fresh-eyes docs QA pass. This section is the release-candidate record; the tag/date are finalized at release close.

### Added

- Portable playbook, exhaustive HOW TO USE docs, reference, troubleshooting, adoption/upgrading/agent/multi-project guides.
- Versioned `tracker.config.json` schema, generic/pilot examples, config validator, lifecycle comment templates, issue/PR forms.
- Generic Node profile (ESLint/Prettier/editorconfig/ignore) with sample validation.
- Idempotent bootstrap CLI (dry-run/apply) for projects, fields/statuses, milestones, labels, skeleton issues/hierarchy.
- Read-only tracker audit (advisory/strict/JSON) plus scheduled advisory CI.
- Task lifecycle CLI (start/checkpoint/review/block/done/status) with DoR/WIP/DoD checks.
- GitHub App bot-identity spike (NO-GO on personal repo; Option A fallback documented).
- Actions catalog/contracts, reusable CI/security workflows, Dependabot/dependency review, opt-in CodeQL, required-check runbook.
- Downstream feedback intake (forms, Source field, triage/versioning/no-fork policy), SECURITY policy, SUPPORT.
- Template repository packaging: README, LICENSE (MIT), structure/versioning guide.

### Changed

- Project fields/types/milestones are the single source of truth; labels limited to risk/process.
- Status model: Todo/In Progress/In Review/Blocked/Done; WIP=1; explicit check-in/out.
- Hybrid D Actions reuse: reusable contracts + thin copied callers; exact template pinning.

### Security

- No secrets in repo/config/examples; least-privilege token guidance; action SHA pinning documented.
- Private vulnerability reporting/private maintainer channel documented; no public vulnerability details.

### Validation

- Config positive/negative validation, issue-form YAML, docs link/anchor checks, bootstrap dry-run/apply-idempotency tests, audit seeded violations, task CLI tests.
- Branch protection/rulesets unavailable on the private personal repo (403); contract documented and applied when public/Pro.

## v1.0.1 — template patch (2026-11-11)

- Fixed `updateFieldOptions` GraphQL variables (array → object), which blocked bootstrap apply when adding Status options. Found by T08 scratch replication; regression test added.
- Docs QA follow-up: copy-path completeness, required `project.number`, quickstart native type/milestone, bootstrap acceptance placeholder guidance, audit-claim narrowing, checksum working-directory fixes, action SHA pinning, and status-output wording.
- Validation: live scratch repo/project bootstrap apply + idempotent re-run + task lifecycle + strict audit; `npm test` 37/37.

## v1.0.2+ (planned)

Patch = compatible fixes; minor = compatible features; major = breaking changes with migration notes. Downstream projects pin exact versions and upgrade explicitly.
