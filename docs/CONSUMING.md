# CONSUMING — add the tracker to a project in 10 minutes

**Docs version:** v1.4.0-docs.1 · Target template: v1.4.0

This is the consumer path. It is intentionally smaller than the engine: four integration files plus
the required `docs/TRACKER.md`, one pinned version line, and a single command to verify. The template-internal guards and meta workflows are
not part of it — see [ARCHITECTURE](./ARCHITECTURE.md) for why.

## The promise

| Item | Budget |
| --- | --- |
| Files added to the project | 5 (`tracker.config.json`, one workflow, two issue forms, `docs/TRACKER.md`) |
| Setup time | ≤10 minutes |
| Upgrade | bump `@v<version>` and `tracker-ref` in one file |
| Engine code copied | none |

## Step 1 — config

Copy [examples/minimal-adopter/tracker.config.json](../examples/minimal-adopter/tracker.config.json)
to `tracker.config.json` and replace `OWNER`/`PROJECT` plus `project.number` with the real project:

- `project.owner` — user or org that owns the GitHub Project.
- `project.title`, `project.number` — the board the tracker reads (required; `gh project list --owner OWNER` shows the number).
- `automation.templateVersion` — the adopted tracker release; must equal the contract version.
- `fields` — Area/Kind/Estimate options; rename them to fit the project.
- `releases` — the example ships one placeholder release/sprint; replace them. Tooling-style repos set `workProfile: tooling`, declare a `Stream` field instead, and may leave `releases` empty.

Validate before committing:

```bash
node path/to/github-project-tracker/scripts/adopt/cli/validate-config.mjs tracker.config.json
# OK   tracker.config.json
```

## Step 2 — one workflow

Copy [examples/minimal-adopter/.github/workflows/tracker.yml](../examples/minimal-adopter/.github/workflows/tracker.yml)
to `.github/workflows/tracker.yml`. It is the whole tracker integration:

```yaml
name: Tracker
on:
  pull_request:
    types: [opened, edited, synchronize, reopened, labeled, unlabeled]
  schedule:
    - cron: '0 15 * * 1'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: tracker-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  pr-close-guard:
    name: pr-close-guard
    if: ${{ github.event_name == 'pull_request' }}
    permissions:
      contents: read
      issues: read
      pull-requests: read
    uses: presljf/github-project-tracker/.github/workflows/reusable-pr-close-guard.yml@v1.4.0
    with:
      tracker-ref: v1.4.0
  audit:
    name: audit
    permissions:
      contents: read
    uses: presljf/github-project-tracker/.github/workflows/reusable-audit.yml@v1.4.0
    with:
      tracker-ref: v1.4.0
      mode: advisory
      json: true
    secrets:
      TRACKER_TOKEN: ${{ secrets.TRACKER_TOKEN }}
```

Notes:

- Both refs must be the **exact release tag** (`@v1.4.0`, `tracker-ref: v1.4.0`). `verify-contract`
  rejects floating, SHA, and no-`v` refs.
- The audit is advisory and read-only. Without `TRACKER_TOKEN` it skips cleanly; add the secret
  (project + repo read, ≤90 days) when the project wants live drift evidence.
- The guard is read-only: it checks that the closing PR belongs to a task in the right state and
  carries evidence. It does not write to the board.
- Make `pr-close-guard / pr-close-guard` a required check only if the project wants closure to be
  merge-blocking; presence of the caller is what the contract requires, not the protection rule.

## Step 3 — issue forms

Copy the two forms from [examples/minimal-adopter/.github/ISSUE_TEMPLATE/](../examples/minimal-adopter/.github/ISSUE_TEMPLATE/)
into `.github/ISSUE_TEMPLATE/`. The required fields are the Definition of Ready made executable:
context, goal, acceptance criteria, test plan, evidence, dependencies, estimate.

Projects in an organization can inherit default forms from the org `.github` repository instead of
copying them; personal repositories must copy.

## Step 4 — required tracker doc

The contract requires `docs/TRACKER.md` as the project's pointer to its board and lifecycle. Copy
[examples/minimal-adopter/docs/TRACKER.md](../examples/minimal-adopter/docs/TRACKER.md) and edit the
board link and owner.

## Step 5 — verify

From a checkout of the tracker at the adopted tag:

```bash
node scripts/adopt/cli/verify-contract.mjs \
  --root path/to/project \
  --config path/to/project/tracker.config.json \
  --contract contract/adoption-contract.json
# Adoption contract OK — tracker v1.4.0.
```

The verifier checks: template version, required config paths, the required profile/doc, and the
core required callers at the exact pin. Missing/expired overrides and stale pins fail.

## Upgrade

1. Read the release notes/CHANGELOG and [UPGRADING](./UPGRADING.md).
2. Bump the two `@v<version>` refs and the `tracker-ref` value in the caller workflow.
3. Set `automation.templateVersion` to the same version.
4. Re-run `verify-contract`.
5. Run the project's own CI; the tracker's checks are additive.

## Optional profiles (adopt only when the project needs them)

These ship in the template but are **not** required by the contract. Each has a copy-mode caller in
`profiles/`:

| Profile | Reusable | Adopt when |
| --- | --- | --- |
| Node CI | `reusable-ci.yml` | The project does not already have CI (otherwise keep its own) |
| Security defaults | `reusable-security.yml` | Dependency review is wanted on pull requests |
| Release (generic/container/package) | `reusable-release.yml` | The project publishes artifacts/images/packages |
| macOS release/desktop smoke | `reusable-release.yml` (`macos` profile), `reusable-desktop-smoke.yml` | macOS signing/notarization or GUI smoke is needed |
| Post-merge audit | `reusable-post-merge-audit.yml` | Bypass detection for merged PRs is wanted |
| Contract/metadata check | `reusable-contract.yml` | The project wants board metadata verified in CI |
| E2E wrapper | `reusable-e2e.yml` | Playwright E2E runs remotely |
| Counts docs guard | `reusable-counts.yml` | The project adopts the verified counts contract |

## Do not copy

- `scripts/internal/` — tracker QA (surface, debt, version, counts, local gate).
- `.github/workflows/` meta runners of this repository — they validate the template, not a project.
- The tracker's 40+ docs and release pipelines — consumers get [this page](./CONSUMING.md) plus the
  reference page they need.

If onboarding needs more than the five files, the interface is wrong: file the gap against
[ARCHITECTURE](./ARCHITECTURE.md) rather than copying engine internals.
