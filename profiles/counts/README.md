# Counts contract profile (verified PASS/FAIL/SKIP)

Adopter wiring for the **"aware and agree"** counts contract. Numbers become verified machine
output instead of remembered prose: every suite/mode records `collected / passed / failed /
skipped / flaky`, every non-zero skip is named and agreed, and CI fails when reality, the baseline,
the generated doc, or inline markers drift.

Absent `docs.counts` config is a no-op; existing projects keep current behaviour. The
`counts-docs.yml` caller is a `requiredWorkflows` entry in the v1.4.0 adoption contract (presence +
pin enforced); without `docs.counts` it stays a documented no-op and must not be a required check.

## 1. Config

```json
"docs": {
  "counts": {
    "baseline": "docs/test-counts.baseline.json",
    "generated": "docs/TEST_COUNTS.md",
    "markers": ["docs/REFERENCE.md"],
    "inventoryCommand": "npm test -- --test-reporter=tap",
    "updateCommand": "npm run docs:counts:update"
  }
}
```

| Key | Meaning |
|---|---|
| `baseline` | committed JSON baseline: one entry per suite id + mode (`remote-visible`, `local-hidden`, `offline`, `full`, or repo-specific) |
| `generated` | canonical doc regenerated from the baseline (`docs/TEST_COUNTS.md`) |
| `markers` | current-state docs that may carry inline markers; **historical docs are never listed** (exemption by construction) |
| `inventoryCommand` | command that produces the counted output (shown in drift guidance) |
| `updateCommand` | command that records new counts + regenerates docs (shown in drift guidance) |

Validate: `node scripts/adopt/cli/validate-config.mjs tracker.config.json` and
`npm run verify:tooling`. Baseline shape:
[`test-counts.baseline.example.json`](./test-counts.baseline.example.json) /
[`schemas/test-counts.baseline.schema.json`](../../schemas/test-counts.baseline.schema.json).

## 2. Wire the suite job

The counted-runner CLI parses the output of the suite and compares it with the baseline. Run the
inventory, then `check`; CI must run both (or the wrapper script):

```json
"scripts": {
  "test:counts": "node --test --test-reporter=tap tests/*.test.mjs > test-results/unit.tap",
  "test:counts:check": "npm run test:counts && node scripts/adopt/cli/suite-counts.mjs check --suite unit --mode full --results test-results/unit.tap",
  "test:e2e:remote": "playwright test --reporter=json > test-results/e2e.json",
  "test:e2e:check": "node scripts/adopt/cli/suite-counts.mjs check --suite e2e --mode remote-visible --results test-results/e2e.json",
  "docs:counts:update": "node scripts/adopt/cli/suite-counts.mjs record --suite unit --mode full --results test-results/unit.tap",
  "guard:docs:counts": "node scripts/adopt/cli/guard-docs-counts.mjs"
}
```

Supported result formats (`--runner auto|playwright|node-test|verify`):

| Runner | Input | Notes |
|---|---|---|
| Playwright JSON | `npx playwright test --reporter=json` output | `stats` -> counts incl. flaky; skipped **test titles** are extracted from the suite tree (`suite > spec`); interrupted runs fail loudly |
| node:test | summary or `--test-reporter=tap` | `skipped` + `todo` map to contract `skipped`; `cancelled` maps to `failed`; TAP gives skip/todo titles (summary output cannot name skips) |
| verify JSON | `verify.mjs --json` (`checks`/`results`/`suites`/`items` with `{name, status}`) | `PASS` -> passed, `FAIL`/`WARN` -> failed, `SKIP`/`DEFERRED_REMOTE` -> skipped |

`check` output: zero drift prints one machine-readable line
(`COUNTS_OK suite=... mode=... collected=... passed=... failed=... skipped=... flaky=...`) and exits 0;
drift prints the exact count/skip diff plus `docs:counts:update` guidance and exits 1. `--json`
gives a machine-readable result. Flaky > 0 always fails. Unknown/malformed runner output fails loudly.

## 3. Reusable counts-docs caller (T05)

The docs-side half of the contract ships as a pinned reusable workflow
(`.github/workflows/reusable-counts.yml`); the counted-runner suite job stays adopter-side. Copy
[`counts-docs.yml`](./counts-docs.yml) into `.github/workflows/` and replace both pinned `@v1.3.2`
refs (the `uses:` reusable-workflow ref and the `tracker-ref` input) with the exact release tag
(`@v<version>`; the contract requires the tag form and a matching `tracker-ref`) you
adopted (v1.4.0+ — the first release that ships it).

| Input | Type | Default | Meaning |
|---|---|---|---|
| `tracker-ref` | string | `v1.3.2` | Exact release tag to load `guard-docs-counts.mjs` from (ignored in the template repo itself). |
| `config-path` | string | `tracker.config.json` | Tracker config path (repository-root-relative); `docs.counts` configures the contract. |
| `runs-on` | string | `ubuntu-latest` | Runner label. |
| `node-version` | string | `'22'` | Node.js version used by the guard. |

Output: `counts-ok` (`'true'` when the guard passed, or when no `docs.counts` policy is configured).
Caller job `counts-docs` / called job `counts` → check context `counts-docs / counts`; permissions
`contents: read` only; no secrets; no artifacts.

Behavior: self mode keys on the canonical template slug (the template's own caller passes
`tracker-ref: ''`); downstream checks the pinned template tag out to `.tracker/` and runs
`guard-docs-counts.mjs --root <workspace> --config <config-path>`. Absent `docs.counts` is a
documented no-op (`docs counts guard: docs.counts is not configured (no-op).`, exit 0), so adopting
the caller before wiring counts is safe; once counts are adopted, make `counts-docs / counts` a
required check. The reusable workflow never runs the suite inventory — pair it with the
adopter-side `suite-counts check` job (§2).

Local parity:

```bash
npm run guard:docs:counts -- --root . --config tracker.config.json
```

Expected: the no-policy no-op line, or
`docs counts contract OK — N suite(s) / M mode(s); generated doc and K marker file(s) current.`;
drift/stale output exits 1 with exact fix guidance. Downstream acceptance is CastDeck C3 (first
real baseline after the v1.4.0 tag); the template repo has no `docs.counts` policy yet, so its own
`counts-docs.yml` run is a documented no-op.

## 4. Update + agree workflow

Counts change => **the same PR** changes the baseline, generated doc, and markers:

1. Run the inventory (e.g. `npm run test:counts`) and then the update command:
   `node scripts/adopt/cli/suite-counts.mjs record --suite unit --mode full --results test-results/unit.tap`
   (or `render` to regenerate docs only from the existing baseline).
2. `record` writes new counts, regenerates `docs/TEST_COUNTS.md` + markers, preserves agreed skips,
   and adds **placeholder** `knownSkips` for new skips.
3. Complete the agreement in the baseline: for every new skip fill `reason`, `coveredBy`,
   `agreedOn`; for a new mode fill `reviewed { on, by, evidence[] }`. Removing a skip removes its
   entry (the update command drops it).
4. Review the docs/baseline diff in the PR; `guard-docs-counts` fails until agreement metadata is
   complete and docs/markers are current.

CI gates for adopters:

- suite job: inventory + `suite-counts check` (fails on drift/flaky/malformed output);
- docs job: `guard-docs-counts` (baseline schema/agreement + generated doc/marker freshness);
  it does **not** run tests, so it stays fast and deterministic.

## 5. Inline markers

Current-state docs can quote verified numbers without hardcoding them:

```markdown
Unit: <!-- counts:unit/full -->156 collected · 156 passed · 0 failed · 0 skipped · 0 flaky<!-- /counts:unit/full -->
Passed only: <!-- counts:unit/full/passed -->156<!-- /counts:unit/full/passed -->
```

Marker keys: `<suite>/<mode>` renders the summary line; `<suite>/<mode>/<metric>` renders one
number (metric: `collected|passed|failed|skipped|flaky`). `render` rewrites every marker in the
configured marker files; the guard fails on stale/unknown/unclosed markers and on stale
`docs/TEST_COUNTS.md` (deterministic ordering: suites sorted by id, modes in canonical order
`remote-visible`, `local-hidden`, `offline`, `full`, then alphabetical).

Historical docs are exempt by construction: only files listed in `docs.counts.markers` are checked,
so past release/acceptance records are never rewritten.

## 6. Rollback

Delete the `docs.counts` block (and the generated/baseline/marker files if desired). Absent config is
a no-op; suite jobs and docs return to their previous behaviour.
