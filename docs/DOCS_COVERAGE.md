# Documentation coverage enforcement

Documentation updates are enforced by CI, not by a checklist.

## Mechanism

`docs/DOCS_COVERAGE.json` maps changed source areas to the docs that must change in the same PR. `scripts/docs/guard-docs.mjs`:

1. computes the PR diff against the base SHA;
2. matches changed source paths to coverage rules;
3. fails when a mapped source area changes without at least one mapped docs file changing;
4. fails on unmapped source files;
5. supports an auditable `docs:no-change` + reason exception.

`docs-guard` runs `docs:check`, `guard:gh`, and `guard-docs`; branch protection requires it on `main`. Adopters use the no-copy reusable guard workflow.

## Exceptions

Apply label `docs:no-change` **and** provide a reason:

```bash
DOCS_GUARD_EXCEPTION_REASON="internal refactor, no user-facing change" npm run guard:docs -- --labels docs:no-change --base origin/main
```

The exception is reviewable in the PR; it is not silent.

## Current limits

- Native Feature/Bug issue-type wiring is supported by the guard (`--linked-issue-type`) but the CI caller does not yet fetch linked issue types; labels/coverage mapping are the current enforced path.
- Generated-doc staleness is covered by `docs:check` and card checks; T12/T15 will add more generated checks.
