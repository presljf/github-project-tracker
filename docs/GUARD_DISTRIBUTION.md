# No-copy guard distribution

**Applies to:** tracker automation and adopting projects. **Implementation lives in this repo; adopters add thin references/config, not copies.**

## Adopting project: transport guard

Add one thin caller workflow:

```yaml
name: Tracker guard
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  guard:
    uses: presljf/github-project-tracker/.github/workflows/reusable-guard.yml@v1.4.0
    with:
      tracker-ref: v1.4.0
      config-path: tracker.config.json
```

The reusable workflow checks out the project and the pinned tracker guard, then runs the same checked-in implementation. No guard code is copied into the project. It invokes the pinned tracker checkout's npm aliases (`guard:gh`, `guard:docs`), so the workflow body does not hard-code either script layout and the same caller works across the v1.4.0 class-first move. Align `tracker-ref` with the layout your project copies: v1.3.2 and earlier ship `scripts/github|docs/**`; v1.4.0+ ships `scripts/adopt/**`. An old-layout guard run against a new-layout project copy (or vice versa) reports missing paths, so upgrade the ref together with the copied scripts.

Project config allowlist:

```json
"guard": {
  "transportOnly": true,
  "allow": [".github/workflows/reusable-release.yml"]
}
```

`allow` is only for explicit migration exceptions. Raw `gh`/GitHub HTTP outside the allowlist fails the guard.

Once branch protection is available, require this check (`Tracker guard / guard` or the caller job context) in addition to CI.

## Adopting project: audit family (no-copy reusable)

The audit family follows the same no-copy model as the transport guard: only thin callers live in
the adopting repository, and the implementation runs from the pinned tracker checkout. v1.4.0 ships
them as reusable workflows and makes all three **required callers** in the adoption contract
(`requiredWorkflows`); copy the caller examples from
[profiles/audit](../profiles/audit/README.md) and pin both the `uses:` ref and the `tracker-ref`
input to the adopted tag. `verify-contract` fails a missing or non-pinned caller; check contexts
stay caller-defined.

| Workflow | Caller | Check context | Caller job permissions |
|---|---|---|---|
| Tracker audit | `tracker-audit.yml` → `reusable-audit.yml` | `tracker-audit / audit` | `contents: read`; optional `TRACKER_TOKEN` secret (advisory skips cleanly, strict requires it) |
| Post-merge audit | `post-merge-audit.yml` → `reusable-post-merge-audit.yml` | `post-merge-audit / audit` | `contents: read`, `issues: write`, `pull-requests`/`checks`/`statuses`/`actions` read |
| PR close guard | `pr-close-guard.yml` → `reusable-pr-close-guard.yml` | `pr-close-guard / guard` | `contents`/`issues`/`pull-requests` read (read-only) |

Copying a whole audit workflow or its script is now the **fallback**, not the model — this supersedes
the v1.3.x copied-workflow guidance. If private cross-repo access is blocked, keep the previous
copied workflows as a documented rollback until access is restored or the template is public, and
update `guard.requiredChecks[]` plus branch-protection contexts in the same change (old and new
contexts must not be required side by side). Workflow contracts: [ACTIONS CATALOG
§2](./ACTIONS_CATALOG.md#2-workflow-catalog) and §7.6 (tracker audit), §7.11 (post-merge
audit), §7.12 (PR close guard); permission and check-context details:
[CI/SECURITY PROFILE](./CI_SECURITY_PROFILE.md).

## Adopting project: release contract gate (opt-in)

`reusable-release.yml` carries the same no-copy contract for releases: set `contract-gate: true`
and `tracker-ref: <adopted tag>` on the release caller and the reusable runs `verify-tooling` +
`verify-contract` + the offline `release-gate` before build. It needs no new permission
(`contents: read` only) and no secret; the default `false` keeps old caller permission graphs valid.
The open `tracker-contract-exception` OI check needs `issues: read` and stays an explicit
release-procedure step (`npm run gate:release -- --repo owner/repo`) — see
[ACTIONS CATALOG §7.5](./ACTIONS_CATALOG.md#75-release-workflow-contract) and
[CI/SECURITY PROFILE §3.8](./CI_SECURITY_PROFILE.md#38-release-contract-gate-opt-in-reusable-release).
The release caller's own `guard.requiredChecks[]` and branch-protection contexts still need the
v1.4.0 names (`pr-close-guard / guard`, etc.).

## Local projects

If the project carries `scripts/adopt/**` (copied mode), run:

```bash
npm run guard:gh
```

This is local parity; CI is the authoritative gate. After a tracker upgrade that moves script
paths, re-copy `scripts/adopt/**` and update the copied alias targets (alias names are unchanged)
— see [UPGRADING](./UPGRADING.md).

## Teammates: worktree scope guard

```bash
# example from a teammate worktree
npm run guard:scope -- --base origin/main --scope "docs/GUARD_DISTRIBUTION.md,.github/workflows/reusable-guard.yml"
```

Exit 1 lists every changed file outside the declared task scope. The Lead runs the same check before merge. Worktrees, one-writer rules, and serialized merges are the isolation layers; this guard makes accidental scope creep visible.

## What this does not enforce

- It cannot stop a human/external process from running `gh` in a terminal.
- It cannot make DSH/bash a hard sandbox. Full isolation requires a container/VM with a restricted PATH/network.
- It does not replace code review, audit, tests, or branch protection.
- Remote pre-commit is intentionally not shipped yet; local parity is `npm run guard:gh`, CI is the gate.

## Files

- `scripts/adopt/lib/guards.mjs` — pure scanner/scope logic.
- `scripts/adopt/cli/guard-gh-transport.mjs` — transport scanner CLI.
- `scripts/adopt/cli/guard-scope.mjs` — worktree scope CLI.
- `.github/workflows/reusable-guard.yml` — no-copy remote guard.
- `tests/guards.test.mjs` — seeded scanner/scope tests.


## Lint/format self-check (T18)

Tracker OS now self-applies ESLint and Prettier: `npm ci`, `npm run lint`, and
`npm run format:check`. A missing or broken lint/format command fails CI rather than succeeding
as a no-op. Dev tooling is approved in `tracker.dependencies.json`; see issue #82.
