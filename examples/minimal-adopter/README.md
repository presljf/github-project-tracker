# Minimal adopter example (Tier 0)

This is the smallest complete tracker integration: the four files a project needs to get the core
guards, and nothing else. It is a consumer bundle, not a copy of the engine — see
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for the boundary and
[docs/CONSUMING.md](../../docs/CONSUMING.md) for the step-by-step guide.

## What is here

| Path | Purpose |
| --- | --- |
| `tracker.config.json` | Board owner/number, fields, pinned tracker version, advisory audit settings |
| `.github/workflows/tracker.yml` | One caller: PR close guard + weekly advisory audit (both pinned) |
| `.github/ISSUE_TEMPLATE/task.yml` | Definition-of-Ready task form |
| `.github/ISSUE_TEMPLATE/bug.yml` | Bug form with reproduction/evidence requirements |
| `docs/TRACKER.md` | Required project pointer to the board and lifecycle |

## Validation

From a checkout of `github-project-tracker` at the adopted tag:

```bash
# 1. The config must validate against the schema.
node scripts/adopt/cli/validate-config.mjs examples/minimal-adopter/tracker.config.json

# 2. The bundle must satisfy the adoption contract (after replacing OWNER/PROJECT/number).
node scripts/adopt/cli/verify-contract.mjs \
  --root examples/minimal-adopter \
  --config examples/minimal-adopter/tracker.config.json \
  --contract contract/adoption-contract.json
```

The shipped example keeps placeholder values (`OWNER`, `PROJECT`, `number: 1`) so it can live in
this repository without a live board; replace them before copying it into a project.

## What is deliberately absent

CI, security scanning, releases, macOS signing, desktop smoke, post-merge audit, contract/metadata,
E2E, and counts are **optional profiles** under `profiles/`. Add a caller only when the project needs
that capability; most existing projects already have CI and releases and do not need the tracker's
copies.
