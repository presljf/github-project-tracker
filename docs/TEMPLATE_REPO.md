# Template repository guide

**Docs version:** v1.4.0-docs.1 · Template target: v1.4.0

This repository is the **source of truth** for Project Tracker OS. It is a public GitHub template repository (published after private reusable access was validated as blocked) containing the playbook, docs, scripts, workflows, config schema, profiles, and validation.

## Use this template

1. Create a new repository from the template (GitHub **Use this template**), or copy the full set into an existing repo: `docs/`, `scripts/adopt/**` (adopter CLIs, shared libs, docs-QA CLIs), `schemas/`, `profiles/`, `tests/`, `.github/` (issue/PR forms and caller workflows; `reusable-*` contracts only if you cannot call the template by pinned ref), `package.json`, `tracker.config.example.json`, `README.md`, `LICENSE`, `SECURITY.md`.
   - `scripts/internal/` is template-maintainer-only (card build, release bump, repo-surface guard) and is **never** copied.
   - Release examples: `profiles/release/reusable/` holds reusable-mode callers (copy into `.github/workflows/` and pin the tracker tag you adopted); `profiles/release/copy/` holds copy-mode templates.
   - Audit family: copy the thin callers from `profiles/audit/` (`tracker-audit.yml`, `post-merge-audit.yml`, `pr-close-guard.yml`) into `.github/workflows/` and pin both the `uses:` reusable-workflow ref and the `tracker-ref` input to the adopted tag; then update required-check contexts (see [profiles/audit/README.md](../profiles/audit/README.md)). The `reusable-*` workflow bodies stay in this repository — do not copy them. The three copied callers are the only runnable audit-family entry points; `reusable-audit.yml`, `reusable-post-merge-audit.yml`, and `reusable-pr-close-guard.yml` are `workflow_call` contracts and never run on their own.
2. Follow [docs/ADOPTION.md](./ADOPTION.md) / [QUICKSTART](./QUICKSTART.md).
3. Copy `tracker.config.example.json` to `tracker.config.json`, edit for your project, validate:
   ```bash
   node scripts/adopt/cli/validate-config.mjs tracker.config.json
   # OK   tracker.config.json
   ```
4. Preview setup:
   ```bash
   node scripts/adopt/cli/bootstrap.mjs --config tracker.config.json --dry-run
   ```
   Apply only after reviewing the plan:
   ```bash
   node scripts/adopt/cli/bootstrap.mjs --config tracker.config.json --apply
   ```
5. Run the tracker audit and first task lifecycle.

## Structure

| Path | Purpose |
|---|---|
| `docs/` | playbook, HOW TO USE, reference, troubleshooting, adoption/upgrading, agent/multi-project, downstream, cards/style |
| `scripts/adopt/cli/` | adopter CLIs: bootstrap, audit, task/stream lifecycle, reconciliation, guards, verification |
| `scripts/adopt/lib/` | shared libraries imported by the CLIs (GitHub transport, guards, work profiles, Playwright guard) |
| `scripts/adopt/docs/` | docs-QA CLIs: `check-docs`, `check-versions`, `guard-docs` |
| `scripts/internal/` | template-maintainer-only tools: `build-cards`, `bump-version`, `verify-surface` (never copied) |
| `contract/adoption-contract.json` | downstream adoption contract consumed by `verify-contract`/`release-gate` |
| `contract/repo-surface.json` | repo-surface manifest: machine-checkable class/status/docs source of truth for scripts/workflows/examples |
| `schemas/`, `examples/` | config contract and generic/pilot examples |
| `profiles/node/` | generic lint/format profile |
| `profiles/desktop/`, `profiles/tooling/`, `profiles/counts/` | opt-in desktop-smoke, tooling-work-profile, and counts-contract wiring |
| `profiles/release/reusable/` | reusable-mode release caller examples (copy into `.github/workflows/` and pin the adopted tag; non-runnable here) |
| `profiles/release/copy/` | copy-mode standalone release templates |
| `profiles/audit/` | audit-family reusable caller examples (`tracker-audit.yml`, `post-merge-audit.yml`, `pr-close-guard.yml`) + permissions/check-name/rollback guidance |
| `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md` | intake/PR forms |
| `.github/workflows/` | internal thin runner callers (CI/security/audit family/guards) + `reusable-*` workflow contracts; `release.yml` is the only runnable release caller here |
| `docs/GUARD_DISTRIBUTION.md` | adoption: transport guard + teammate scope guard |
| `tests/` | dependency-free Node test suite (`npm test`) |
| `tracker.config.json` | this repo's self-config for audit/CI |

## Versioning and pinning

- Adopters pin `automation.templateVersion` exactly (e.g. `1.0.0`) and record it in their tracker config/docs.
- Patch = compatible fixes; minor = compatible features; major = breaking changes with migration notes.
- v1.4.0 reorganized scripts into class-first families: `scripts/adopt/**` is copied,
  `scripts/internal/**` is template-maintainer-only, and release examples live under
  `profiles/release/{reusable,copy}/`. Older tags keep the older layout (no shims), so re-copy
  scripts on upgrade — see [UPGRADING](./UPGRADING.md).
- Upgrade with [docs/UPGRADING.md](./UPGRADING.md); never fork silently.
- Template tags are immutable. The `v1.0.0` tag is created only after T08 replication/upgrade validation and T12 fresh-eyes docs QA pass.

## Release/tag policy (v1.0.0)

- [ ] Scripts/docs/config/workflows complete.
- [ ] `npm test`, config validation, link/anchor checks pass.
- [ ] T08 scratch replication + upgrade/versioning validation passes.
- [ ] T12 fresh-eyes docs QA passes (agent round + human review).
- [ ] Tag `v1.0.0` created from the validated `main` commit; release notes/changelog finalized.
- [ ] Publication decision recorded (private through v1.0.0; public at/after if reusable access blocked or validation complete).
- [ ] No secrets in history/tree/artifacts.

## Repository settings

- Template repository: **enabled**; visibility: **public**.
- Public after the v1.0.0/v1.2.1 validation and the T01 private-access result; branch protection/private reporting follow T03/T04.
- Branch protection/rulesets pending platform availability (private personal repo 403); apply when public/Pro.
- Advisory tracker audit (`reusable-audit.yml`) skips cleanly (exit 0, notice in the log) when
  `TRACKER_TOKEN` is unavailable; strict mode requires the token and fails actionably when it is
  missing.
- License: MIT (see `LICENSE`).

## Downstream reporting

Report bugs/features upstream via [DOWNSTREAM_FEEDBACK](./DOWNSTREAM_FEEDBACK.md); no forks, pin exact versions, follow [UPGRADING](./UPGRADING.md).
