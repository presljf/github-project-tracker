# Template repository guide

**Docs version:** v1.2.0-docs.1 · Template target: v1.2.0

This repository is the **source of truth** for Project Tracker OS. It is a public GitHub template repository (published after private reusable access was validated as blocked) containing the playbook, docs, scripts, workflows, config schema, profiles, and validation.

## Use this template

1. Create a new repository from the template (GitHub **Use this template**), or copy the full set into an existing repo: `docs/`, `scripts/github/`, `schemas/`, `profiles/`, `tests/`, `.github/`, `package.json`, `tracker.config.example.json`, `README.md`, `LICENSE`, `SECURITY.md`.
2. Follow [docs/ADOPTION.md](./ADOPTION.md) / [QUICKSTART](./QUICKSTART.md).
3. Copy `tracker.config.example.json` to `tracker.config.json`, edit for your project, validate:
   ```bash
   node scripts/github/validate-config.mjs tracker.config.json
   # OK   tracker.config.json
   ```
4. Preview setup:
   ```bash
   node scripts/github/bootstrap.mjs --config tracker.config.json --dry-run
   ```
   Apply only after reviewing the plan:
   ```bash
   node scripts/github/bootstrap.mjs --config tracker.config.json --apply
   ```
5. Run the tracker audit and first task lifecycle.

## Structure

| Path | Purpose |
|---|---|
| `docs/` | playbook, HOW TO USE, reference, troubleshooting, adoption/upgrading, agent/multi-project, downstream, cards/style |
| `scripts/github/` | bootstrap, audit, task CLI, validate-config, shared adapters |
| `schemas/`, `examples/` | config contract and generic/pilot examples |
| `profiles/node/` | generic lint/format profile |
| `profiles/release/`, `.github/workflows/release*` | release profile examples (T10) |
| `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md` | intake/PR forms |
| `.github/workflows/` | CI, security, audit, reusable contracts, release profiles, no-copy guard |
| `docs/GUARD_DISTRIBUTION.md` | adoption: transport guard + teammate scope guard |
| `tests/` | dependency-free Node test suite (`npm test`) |
| `tracker.config.json` | this repo's self-config for audit/CI |

## Versioning and pinning

- Adopters pin `automation.templateVersion` exactly (e.g. `1.0.0`) and record it in their tracker config/docs.
- Patch = compatible fixes; minor = compatible features; major = breaking changes with migration notes.
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
- Public after the v1.0.0/v1.2.0 validation and the T01 private-access result; branch protection/private reporting follow T03/T04.
- Branch protection/rulesets pending platform availability (private personal repo 403); apply when public/Pro.
- Advisory tracker audit skips safely when `TRACKER_TOKEN` is unavailable.
- License: MIT (see `LICENSE`).

## Downstream reporting

Report bugs/features upstream via [DOWNSTREAM_FEEDBACK](./DOWNSTREAM_FEEDBACK.md); no forks, pin exact versions, follow [UPGRADING](./UPGRADING.md).
