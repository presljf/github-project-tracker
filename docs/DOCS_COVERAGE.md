# Documentation coverage enforcement

Documentation updates are enforced by CI, not by a checklist.

## Mechanism

`docs/DOCS_COVERAGE.json` maps changed source areas to the docs that must change in the same PR. `scripts/adopt/docs/guard-docs.mjs`:

1. computes the PR diff against the base SHA;
2. matches changed source paths to coverage rules;
3. fails when a mapped source area changes without at least one mapped docs file changing;
4. fails on unmapped source files;
5. supports an auditable `docs:no-change` + reason exception.

`docs-guard` runs `docs:check`, `guard:versions`, `verify:tooling`, `guard:gh`, `guard:deps`, `guard-docs`, config validation, and `verify:surface`; branch protection requires it on `main`. Adopters use the no-copy reusable guard workflow.

**Script families (v1.4.0 reorg):** coverage rules follow the class-first tree instead of one flat
automation directory. `scripts/adopt/cli/` + `scripts/adopt/lib/` (adopter CLIs and shared libs) map
to REFERENCE + TASK_CLI + ADOPTION; `scripts/adopt/docs/` (docs-QA CLIs) maps to DOCS_VALIDATION +
DOCS_STYLE_GUIDE + GUARD_DISTRIBUTION + this page; `scripts/internal/` (template-maintainer tools)
maps to REFERENCE + UPGRADING; `contract/` maps to REFERENCE + ADOPTION; the `scripts/` catch-all
still requires REFERENCE + HOW_TO_USE.

**Repo-surface contract (v1.4.0):** `contract/repo-surface.json` is the machine-checkable
class/status/docs/audience source of truth for the shipped surface (classes: `adopter-cli`,
`adopter-lib`, `reusable-workflow`, `reusable-action`, `copy-mode`, `internal`, `generated`;
statuses: `shipped`/`contract-only`). `npm run verify:surface`
(`node scripts/internal/verify-surface.mjs --root . --manifest contract/repo-surface.json
--require-manifest`) runs in the `docs-guard` CI job and fails on: a missing manifest; manifest ↔
filesystem drift (missing `shipped` entry, present `contract-only` entry, unclassified or
double-classified path); a `reusable-*` workflow that is not a `workflow_call` contract; a
copy-mode example outside `profiles/` or without its `COPY-MODE EXAMPLE` header; catalog claims
that disagree with the manifest; manifest-referenced docs anchors that do not resolve; and
generated entries outside `generatedRoots` without an existing `generatedBy` script. Soft warnings
(unclassified docs, npm-alias drift, adopter→internal imports, stale catalog section docs) fail
only with `--strict`. T02 generates `docs/SURFACE.md` from the manifest — treat that page as
generated.

**Counts contract rule (v1.3.0):** `counts-contract` maps
`scripts/adopt/cli/suite-counts.mjs`, `scripts/adopt/cli/guard-docs-counts.mjs`, and `profiles/counts/` to
REFERENCE + AGENT_GUIDE + this page, so a change to the counted-runner/guard wiring must update its
docs. When a repo declares `docs.counts`, `guard:docs:counts` additionally enforces baseline
agreement metadata and generated `docs/TEST_COUNTS.md`/inline-marker freshness (no test execution);
it is a separate docs-job step, not part of `guard-docs`.

## Exceptions

Apply label `docs:no-change` **and** provide a reason:

```bash
DOCS_GUARD_EXCEPTION_REASON="internal refactor, no user-facing change" npm run guard:docs -- --labels docs:no-change --base origin/main
```

The exception is reviewable in the PR; it is not silent.

## Current limits

- Native Feature/Bug issue-type wiring is supported by the guard (`--linked-issue-type`) but the CI caller does not yet fetch linked issue types; labels/coverage mapping are the current enforced path.
- Generated-doc staleness is covered by `docs:check` and card checks; `guard:docs:counts` covers the counts baseline/markers when `docs.counts` is configured (absent = no-op). The tracker template does not self-adopt the counts contract yet; adopters wire it per [profiles/counts](../profiles/counts/README.md).


## Lint/format self-check (T18)

Tracker OS now self-applies ESLint and Prettier: `npm ci`, `npm run lint`, and
`npm run format:check`. A missing or broken lint/format command fails CI rather than succeeding
as a no-op. Dev tooling is approved in `tracker.dependencies.json`; see issue #82.
