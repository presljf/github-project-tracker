## [1.0.2] — 2026-11-11

- Migrate release-profile defaults/callers from retired `macos-14` to `macos-15`.
- Make release artifact matching portable on macOS bash 3.2 (avoid `globstar`/globstar).
- Correct the macOS runner-image retirement diagnosis in release docs.
- Refresh template pin to `1.0.2`.

# Changelog

All notable changes to Project Tracker OS are documented here. The format follows semantic versioning; see [docs/UPGRADING.md](docs/UPGRADING.md).

## v1.3.0 — Verification & documentation contract (in progress)

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
- Remaining v1.3.0 item (release metadata/tag) lands in T05 and is recorded at release close.

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
