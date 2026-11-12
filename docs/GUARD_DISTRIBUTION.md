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
    uses: presljf/github-project-tracker/.github/workflows/reusable-guard.yml@v1.3.2
    with:
      tracker-ref: v1.3.2
      config-path: tracker.config.json
```

The reusable workflow checks out the project and the pinned tracker guard, then runs the same checked-in implementation. No guard code is copied into the project. It invokes the pinned tracker checkout's npm aliases (`guard:gh`, `guard:docs`), so the caller is layout-independent: the same `tracker-ref` works for a v1.3.x checkout (old script layout) and a v1.4.0+ checkout (`scripts/adopt/**`), because the aliases resolve inside the pinned checkout.

Project config allowlist:

```json
"guard": {
  "transportOnly": true,
  "allow": [".github/workflows/reusable-release.yml"]
}
```

`allow` is only for explicit migration exceptions. Raw `gh`/GitHub HTTP outside the allowlist fails the guard.

Once branch protection is available, require this check (`Tracker guard / guard` or the caller job context) in addition to CI.

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
