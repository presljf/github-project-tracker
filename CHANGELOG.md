# Changelog

All notable changes to Project Tracker OS are documented here. The format follows semantic versioning; see [docs/UPGRADING.md](docs/UPGRADING.md).

## v1.0.0 — release candidate (tag pending validation)

> The `v1.0.0` tag is created only after T08 replication/upgrade validation and T12 fresh-eyes docs QA pass. This section is the release-candidate record.

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

## v1.0.1+ (planned)

Patch = compatible fixes; minor = compatible features; major = breaking changes with migration notes. Downstream projects pin exact versions and upgrade explicitly.
