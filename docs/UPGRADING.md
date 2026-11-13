# UPGRADING

**Docs version:** v1.3.2-docs.1 · Target template: v1.3.2
The tracker is versioned; downstream projects pin an exact version and upgrade deliberately.

## Version semantics

| Change | Version | Examples |
|---|---|---|
| Compatible bug fix | **patch** `vX.Y.Z` | broken workflow, docs/config fix, security patch |
| Compatible feature | **minor** `vX.Y+1.0` | new profile, new optional config field, new caller |
| Breaking change | **major** `vX+1.0.0` | config key removal/rename, status/field contract change, required workflow change |

- Downstream config records `automation.templateVersion` (exact, e.g. `1.0.0`).
- No `main` tracking; no silent sync.
- Patch/minor upgrades should be low-risk; major upgrades require a migration plan.

## v1.3.2 — advisory close-out warning and sprint hierarchy check

Patch release: run an advisory audit after upgrading to see whether either new check flags your
existing board. No config change is required.

- New audit warning `PROJECT_STATUS_STALE` (closed project items not `Done`); advisory only, never
  changes the exit code, including `--strict`. Repair the drift with
  `node scripts/adopt/cli/reconcile-status.mjs --config tracker.config.json --apply` (see
  [REFERENCE §5.8](./REFERENCE.md#58-reconcile-status-close-out-project-status)).
- New audit violation `SPRINT_HIERARCHY_MISSING_RELEASE` (open product sprint without a `[Release]`
  ancestor). Advisory runs still exit 0, but `--strict` audits will now fail on pre-existing
  unlinked open sprints — fix them (link the sprint as a sub-issue of its release) before relying
  on a strict audit gate. Closed/historical sprints are exempt; the tooling profile is unaffected.
- New `reconcile-status` command (`npm run reconcile:status`) to list and fix Project Status drift
  left by `Closes #N` auto-closes.

## v1.4.0 — breaking: class-first script families and non-runnable release examples

v1.4.0 ships a **breaking change**: the scripts tree moved into class-first families and the old
paths are gone (no shims). The break is an accepted exception (D10) on the v1.x line; tags at or
before v1.3.2 keep the old layout, so a pinned old checkout's documented commands still work for
that pin, and adopters upgrade deliberately.

| Before v1.4.0 | v1.4.0 |
|---|---|
| `scripts/github` CLI files (bootstrap, audit, task/stream, guards, verify, reconcile, rate-limit…) | `scripts/adopt/cli/` |
| `scripts/github` shared libraries (`lib/`) and `playwright-remote-guard.mjs` | `scripts/adopt/lib/` |
| `scripts/docs` docs-QA CLIs (`check-docs`, `check-versions`, `guard-docs`) | `scripts/adopt/docs/` |
| `scripts/docs` card builder and `scripts/release` bump tool | `scripts/internal/` (template-maintainer-only) |

Adopter steps:

1. Re-copy `scripts/adopt/**` (adopter CLIs, shared libs, docs-QA CLIs) over the old copies and
   delete the pre-v1.4.0 script files you replaced. `scripts/internal/**` is template-maintainer-only
   — do not copy it.
2. Update copied `package.json` alias targets: alias **names are unchanged** (`audit`, `task`,
   `docs:check`, `guard:versions`, `docs:counts:check`, `docs:counts:update`, …) but each target now
   points under `scripts/adopt/…`.
3. Update copied runner workflows that invoke scripts directly: `post-merge-audit.yml`,
   `pr-close-guard.yml`, `tracker-audit.yml`, `main-history-guard.yml` (and any copied caller whose
   `run:` lines name a script path).
4. If the counts contract is adopted, re-run `npm run docs:counts:update` after the moves: the
   generated doc header records the update command path, so refresh `docs/TEST_COUNTS.md` + markers
   in the upgrade PR.
5. Release profiles: reusable-mode caller examples moved to `profiles/release/reusable/` — copy the
   caller you use into `.github/workflows/` and pin your adopted tracker tag; copy-mode templates
   stay in `profiles/release/copy/`. The template no longer ships runnable release examples in
   `.github/workflows/`; `release.yml` is the only runnable release caller there.
6. Reusable/hybrid mode needs no script-copy work: `reusable-guard.yml` now invokes the pinned
   tracker checkout's npm aliases, so it stays layout-independent across v1.3.x and v1.4.0+ refs.
7. Template-internal only: new `contract/repo-surface.json` manifest + `scripts/internal/verify-surface.mjs`
   (`npm run verify:surface`) keep the shipped surface machine-checkable; adopters do not copy
   either.

No config change is required beyond bumping `automation.templateVersion` to the exact target tag;
adopters who migrate to the reusable contract caller also provision the `TRACKER_TOKEN` secret (below).

### Required adoption contract (six reusable callers)

v1.4.0 marks the six new reusable callers as **required** for every repository that re-pins.
`contract/adoption-contract.json` gains `requiredWorkflows[]` entries for them and
`verify-contract` fails when one is absent **or** when its `uses:` ref is not pinned to the exact
adopted tag (`@v<trackerVersion>`). This is the breaking-upgrade decision D3; the callers are thin
and trigger-owned, so a project that does not run a suite still needs the caller file (make it
dispatch-only or path/label-gated), while only the documented contexts below are merge-required.

| Required reusable | Bundled caller | Replaces (v1.3.x) | Old context | New context | Gating |
|---|---|---|---|---|---|
| `reusable-contract.yml` | `profiles/contract/tracker-contract.yml` | copied `tracker-contract.yml` + `tracker-metadata.yml` | `tracker-contract`, `tracker-metadata` | `tracker-contract / contract`, `tracker-contract / metadata` | `contract` required; `metadata` project-defined |
| `reusable-post-merge-audit.yml` | `profiles/audit/post-merge-audit.yml` | inline `post-merge-audit.yml` | `audit` (post-merge) | `post-merge-audit / audit` | post-merge record; not a merge check |
| `reusable-pr-close-guard.yml` | `profiles/audit/pr-close-guard.yml` | inline `pr-close-guard.yml` | `pr-close-guard` | `pr-close-guard / guard` | required |
| `reusable-audit.yml` | `profiles/audit/tracker-audit.yml` | inline `tracker-audit.yml` | `audit` (tracker) | `tracker-audit / audit` | advisory; strict is a release-gate opt-in |
| `reusable-e2e.yml` | `profiles/e2e/e2e.yml` | inline `web-e2e` job | `e2e` | `e2e / e2e` | advisory unless deliberately promoted |
| `reusable-counts.yml` | `profiles/counts/counts-docs.yml` | inline `counts-docs` job | `counts-docs` | `counts-docs / counts` | required only once `docs.counts` is adopted; otherwise documented no-op |

Rules:

1. Copy each required caller from `profiles/` into `.github/workflows/` and pin **both** refs — the
   reusable-workflow `uses:` ref and the `tracker-ref` input — to the exact adopted release tag
   (`@v<version>`, v1.4.0+; earlier tags do not contain `scripts/adopt/**` or the v1.4.0 contract).
   The `requiredWorkflows` check accepts only the tag form and a matching `tracker-ref`: a SHA,
   no-`v` ref, empty `tracker-ref`, or stale tooling pin fails. `reusable-e2e.yml` has no
   `tracker-ref` input; its `uses:` ref is the only pin. The examples use `v1.3.2` placeholders
   until the tag exists; replace them with the acquired tag.
2. The contract enforces **presence + exact pin**, not caller job names or triggers (those stay
   project-owned). The contexts in the table are the bundled callers' defaults; capture your real
   names from a green run and update branch protection/rulesets plus `guard.requiredChecks[]` in the
   same PR. Do not require `post-merge-audit / audit`, `tracker-audit / audit`, or `e2e / e2e`
   unless the project records that decision; `counts-docs / counts` becomes required only with the
   counts policy.
3. `tracker.overrides.json` is the only exception path: an entry needs `id` (the
   `requiredWorkflows[].id`), an upstream GitHub issue URL, a reason, and a non-expired expiry. A
   missing caller with no override fails; an expired override fails.
4. The template repository self-dogfoods all six with local `./.github/workflows/reusable-*.yml`
   refs (self mode: `tracker-ref: ''` where the workflow has that input; the E2E fixture has no
   `tracker-ref`). `verify-contract` intentionally skips downstream `requiredWorkflows` checks in
   the contract's own repository; the shipped contract shape is covered by tests instead.
5. Rollback: before the v1.4.0 tag exists, revert the contract entries; after the tag, remove a
   caller only through a dated `plan-change` and an OI-linked override. The v1.3.2 tag keeps the old
   inline workflows for a full rollback.

### Opt-in release contract gate (`contract-gate`)

`reusable-release.yml` adds an opt-in `contract-gate` input (default `false`, so existing release
workflows keep their behaviour). When enabled, a `contract-gate` job runs **before build**:
`verify-tooling` + `verify-contract` + the offline half of `release-gate`, against the pinned
`tracker-ref` checkout (downstream) or the caller checkout (self mode). It requests `contents: read`
only; enabling it therefore needs **no new caller permission** or secret.

```yaml
jobs:
  release:
    permissions:
      contents: write
      packages: write
      id-token: write
    uses: presljf/github-project-tracker/.github/workflows/reusable-release.yml@v1.4.0
    with:
      contract-gate: true
      tracker-ref: v1.4.0
```

The open `tracker-contract-exception` OI half of `release-gate` needs `issues: read`. Because GitHub
validates the reusable-workflow permission graph even for skipped jobs, requiring it here would
invalidate every existing caller that only grants contents/packages/id-token; the open-OI check
therefore stays an explicit **release-procedure** step:
`npm run gate:release -- --repo owner/repo` (it fails on open OIs) before tagging/publishing. The
gate's offline half still fails the release on a missing/stale required caller, tooling drift, or a
contract violation.

### Reusable contract + metadata check migration

v1.4.0 adds `.github/workflows/reusable-contract.yml` (dogfooded here by
`.github/workflows/tracker-contract.yml`); the **v1.4.0 tag is the first release shipping it**.
Pre-v1.4.0 pinned copies keep their old copied workflows and layout until the pin is upgraded, so
migrate in the same PR as the pin bump:

| Old copied v1.3.x workflow | Old check context | New reusable check context |
|---|---|---|
| `tracker-contract.yml` (verify-contract) | `tracker-contract` | `tracker-contract / contract` |
| `tracker-metadata.yml` (verify-metadata) | `tracker-metadata` | `tracker-contract / metadata` |

1. Copy `profiles/contract/tracker-contract.yml` into `.github/workflows/` and replace **both**
   `@v1.3.2` refs — the reusable-workflow `uses:` ref and the `tracker-ref` input — with the exact
   release tag (`@v<version>`) you adopt (v1.4.0+; the requiredWorkflows check does not accept a
   SHA pin). `tracker-ref` must be a released tag that contains the new `scripts/adopt/**` tooling
   and `contract/adoption-contract.json`; replace the example's `v1.3.2` placeholders rather than
   relying on them.
2. Create/refresh the `TRACKER_TOKEN` repository secret: project-scoped PAT with Projects +
   Metadata **read** (≤90 days) or a GitHub App installation token, stored as a repository secret
   (never in config, comments, or artifacts), passed explicitly by name (never `secrets: inherit`),
   and rotated on the tracker's token schedule. It is required only when `metadata: true` (the
   default).
3. Update branch protection/rulesets to the new contexts in the **same PR** as the pin upgrade:
   require `tracker-contract / contract`; treat `tracker-contract / metadata` as project-defined.
   The bundled caller sets `metadata: false` on pull requests (fork PRs never receive the secret),
   so a required **PR** context for metadata would stay pending — keep it advisory unless the
   project runs metadata on every PR deliberately.
4. Fork PRs: `metadata: false` is mandatory there (GitHub withholds secrets from forks); the
   `contract` job still runs offline with no secrets. Keep
   `secrets: TRACKER_TOKEN: ${{ secrets.TRACKER_TOKEN }}` so push/`workflow_dispatch` runs metadata.
5. `config-path` caveat: it feeds `verify-tooling` only (default `tracker.config.json`, resolved
   under `working-directory`); `verify-contract` and the `metadata` job read `tracker.config.json`
   from the repository root / working directory. A renamed config file is not followed by metadata.
6. `project.number` must be set in `tracker.config.json` or metadata verification fails (it reads
   live project fields). `submodule-path` defaults to `.tracker-os` and only feeds the
   pinned-submodule tag check — a missing submodule is a notice + skip, not a failure.

See [ADOPTION contract verify](./ADOPTION.md#adoption-contract-verify),
[ACTIONS CATALOG §7.10](./ACTIONS_CATALOG.md#710-reusable-contractyml-contract-metadata-verification-contract),
and [profiles/contract](../profiles/contract/README.md).

### Audit-family reusable workflow migration

v1.4.0 adds three audit-family reusables — `reusable-pr-close-guard.yml`,
`reusable-post-merge-audit.yml`, and `reusable-audit.yml` (shipping the previously contract-only
tracker-audit wrapper) — and **the v1.4.0 tag is the first release shipping them**. The old inline
copied workflows stay on their pinned pre-v1.4.0 tags; migrate in the same PR as the pin bump.

| Old inline copy (v1.3.x) | Old check context | New reusable check context |
|---|---|---|
| `pr-close-guard.yml` | `pr-close-guard` | `pr-close-guard / guard` |
| `post-merge-audit.yml` | `audit` (post-merge) | `post-merge-audit / audit` |
| `tracker-audit.yml` | `audit` (tracker) | `tracker-audit / audit` |

1. Copy the callers you need from `profiles/audit/` into `.github/workflows/`
   (`pr-close-guard.yml`, `post-merge-audit.yml`, `tracker-audit.yml`) and pin **both** the
   reusable-workflow `uses:` ref and the `tracker-ref` input to the exact release tag
   (`@v<version>`) you adopt (v1.4.0+; the requiredWorkflows check does not accept a SHA pin).
   Replace the `v1.3.2` placeholders in the examples; `tracker-ref` must be a released tag
   containing the current `scripts/adopt/**` tooling.
2. Grant caller permissions exactly as documented (called workflows can only downgrade them):
   - `pr-close-guard.yml`: `contents: read`, `issues: read`, `pull-requests: read` — read-only.
   - `post-merge-audit.yml`: `contents: read`, `issues: write`, `pull-requests: read`,
     `checks: read`, `statuses: read`, `actions: read` (`issues: write` opens the
     `tracker-contract-exception` OI; the read scopes feed `statusCheckRollup`, which resolves
     `checkSuite.workflowRun`).
   - `tracker-audit.yml`: `contents: read` plus the optional `TRACKER_TOKEN` secret (project read).
3. Update `tracker.config.json` `guard.requiredChecks` to the reusable contexts — the template's
   audited config sets `["ci / ci-gate", "docs-guard", "pr-close-guard / guard"]` — and update
   branch protection/ruleset required checks **in the same PR** as the caller migration: the old
   `pr-close-guard` context disappears when the inline workflow is replaced. An absent
   `guard.requiredChecks` falls back to the legacy default list (`ci / ci-gate`, `docs-guard`,
   `pr-close-guard`), which no longer matches the reusable context, so set it explicitly. This is
   a **major** interface change per ACTIONS CATALOG §7.9.
4. Provision `TRACKER_TOKEN` as a repository secret if the tracker audit should run with the
   token: project read **and** repo/issues read on private repos (project-scoped PAT with `project`
   + `repo` scopes, ≤90 days, or a GitHub App installation token with Projects + Metadata + Issues
   read). Advisory runs without it log a notice and skip (exit 0); strict release-gate runs fail
   with an actionable message without it.
5. Exercise both paths: a PR launches `pr-close-guard / guard` and the advisory
   `tracker-audit / audit`; a merged PR launches `post-merge-audit / audit`. Manual post-merge
   dispatch passes `pr-number`; `scripts/adopt/cli/post-merge-audit.mjs` (via the repo transport,
   no raw `gh` in workflows) revalidates `state == MERGED` and re-fetches the PR before auditing.
6. Keep the old inline workflow files until the new contexts are green, then delete them. Do not
   keep old and new required contexts required side by side for long.
7. Rollback: restore the v1.3.2 inline copies (`post-merge-audit.yml`, `pr-close-guard.yml`,
   `tracker-audit.yml` at that tag) and the old protection contexts.

Caveats: the post-merge audit degrades loudly to a closure-only audit (warning + job summary) when
`statusCheckRollup` is unreadable — degraded is advisory, not a clean pass. A PR merged from a fork
may lack `issues: write`, so OI creation can return 403 (documented pre-existing limitation: a
detected bypass is reported in the job log and the run fails loudly instead of recording the OI).
None of the three reusables upload artifacts; tracker-audit JSON goes to the job log/summary. The
post-merge audit's `ok` output means the job completed — a detected bypass still completes the job
by opening the OI, so `ok=true` does not mean "no bypass". All three audit reusables are in the
v1.4.0 adoption contract's `requiredWorkflows`; `verify:contract` fails a missing or non-pinned
caller, while the check contexts above remain caller-defined.

See [profiles/audit](../profiles/audit/README.md),
[ACTIONS CATALOG §7.6/§7.11/§7.12](./ACTIONS_CATALOG.md), and
[CI profile §3.7](./CI_SECURITY_PROFILE.md#37-audit-family-caller-contexts-reusable-mode).

### E2E and counts reusable caller migration

v1.4.0 also ships the remaining previously contract-only reusables: `reusable-e2e.yml` (Playwright
E2E) and `reusable-counts.yml` (docs counts guard), with the self callers `e2e-fixture.yml` /
`counts-docs.yml`. The **v1.4.0 tag is the first release shipping them**; pre-v1.4.0 pins keep
their inline/copied layout. The consolidated six-caller adoption table is above; this block covers
the e2e/counts detail (the same pin rules apply).

| Old copied workflow/job | Old check context | v1.4.0 reusable contract |
|---|---|---|
| `web-e2e.yml` (job `e2e`) | `e2e` | `e2e / e2e` (via `reusable-e2e.yml`) |
| `counts-docs` job | `counts-docs` | `counts-docs / counts` (via `reusable-counts.yml`) |

Old contexts were caller-defined copies; the table shows the template's v1.3.x defaults. Capture the
adopter's real names before deleting the old workflows (for example CastDeck's inline E2E job was
`web-e2e` and its post-merge job was `post-merge-audit`, not the template's `audit`).

1. Copy the caller you need — `profiles/e2e/` (E2E) and `profiles/counts/counts-docs.yml` (counts)
   — into `.github/workflows/`, and pin the reusable-workflow `uses:` ref to the exact adopted
   release tag (`@v<version>`, v1.4.0+; no SHA pin for a required workflow). The E2E reusable has
   **no `tracker-ref` input** (it consumes `.github/actions/setup-node-cache` from its own workflow
   repo/sha); the counts caller pins `tracker-ref` like the other reusables.
2. No permission increase and no secrets: both callers keep `contents: read`. E2E uploads a
   failure-only artifact (`upload-on-success: false`, default 7-day retention) — keep artifacts free
   of credentials/cookies/personal data; counts uploads no artifacts.
3. Update required checks in the **same PR** as the caller migration: require
   `counts-docs / counts` only when the counts contract is adopted (otherwise the caller is a
   documented no-op); keep `e2e / e2e` advisory unless you deliberately promote it with recorded
   evidence. Capture real names with `gh pr checks <pr>`; renaming required checks is a major change
   per ACTIONS CATALOG §7.9.
4. E2E runtime/cost: the Playwright install downloads roughly 0.5–1 GB of browsers per run (no
   browser cache in v1.4.0); `chromium` is the default `browsers` list, the timeout defaults to 20
   minutes, and the command defaults to `npm run e2e`. Keep it path/label-gated on PRs and stub
   external services in assertions (or declare live suites under `verification.remoteOnly[]`).
5. Live downstream validation of the real suite/baseline wiring is **CastDeck C3 post-tag**: the
   template's own `counts-docs` caller is a no-op (no `docs.counts`) and `e2e-fixture` is a
   dispatch-only plumbing fixture. Both reusables are required callers in the v1.4.0 adoption
   contract (`requiredWorkflows`), but their contexts stay advisory/no-op until the project opts in.

See [profiles/e2e](../profiles/e2e/README.md), [profiles/counts](../profiles/counts/README.md),
and [CI profile](./CI_SECURITY_PROFILE.md) (runner/cost and check-context notes).

### Post-tag downstream migration check (CastDeck C1–C3)

This is a **verification item, not implementation** in the tracker release. After the `v1.4.0` tag
exists, the only known adopter (CastDeck) migrates in Sprint 0.5.8 and the tracker side checks the
result without modifying CastDeck from the release task:

1. **C1 — pin wave + contract:** `.tracker-os` → `v1.4.0`; `automation.templateVersion`,
   `pinnedVersion`, caller `uses:` refs, and `tracker-ref` inputs at `v1.4.0`; the contract
   caller replaces the old `tracker-contract`/`tracker-metadata` copies; inline contract-gate
   removed in favor of `contract-gate: true`; copied script paths under `scripts/adopt/**`.
2. **C2 — audit family:** post-merge audit, PR close guard, and tracker audit become thin callers;
   `guard.requiredChecks[]` and branch-protection contexts updated to
   `post-merge-audit / audit`, `pr-close-guard / guard`, `tracker-audit / audit` in the same PR; the
   advisory audit caller carries the weekly `schedule` + `workflow_dispatch` drift backstop.
   **C2 is deferred until after the v1.4.0 tag** (it cannot run against an untagged contract).
3. **C3 — E2E + counts:** the `web-e2e` job becomes a `reusable-e2e` caller and the `counts-docs`
   job a `reusable-counts` caller; this is the first real Playwright/browser and counts-baseline
   validation. **C3 is deferred until after the v1.4.0 tag**; the template's `e2e-fixture` only
   proved plumbing (`browsers: none`) and its `counts-docs` is a no-op.
4. **Check (read-only):** run `verify:contract` against a scratch copy of the adopter at the
   v1.4.0 pin and confirm all ten `requiredWorkflows` resolve at the pin (the four pre-existing plus
   the six v1.4.0 entries), the old/new contexts above are the ones branch protection records, and
   the adopter's post-merge audit run is non-degraded. Record the run/PR URLs on the tracker release
   task; do not edit CastDeck from the tracker release.

## Before upgrading

- [ ] Read the target changelog/release notes/migration notes.
- [ ] Inventory the six required reusable callers (contract, post-merge audit, PR close guard,
      tracker audit, E2E, counts) and the old→new check-context renames before re-pinning.
- [ ] Confirm your current pin (`automation.templateVersion`).
- [ ] Check copied-file/overrides list in your project docs.
- [ ] Ensure no uncommitted work in copied config/workflows.
- [ ] Know rollback: previous tag/commit + config pin.

## Copy vs reusable

| Mode | Upgrade action | Notes |
|---|---|---|
| Thin callers/reusable workflows | Update pinned ref/version; keep project caller/config | preferred when access validated |
| Copied callers/composite actions | Re-copy template files; re-apply project-specific changes | document diffs/overrides |
| Both (mixed) | Track each file's origin/mode | audit should flag stale pins |

Never edit a reusable workflow in the downstream repo; override via inputs/config. For copied files, record the template version used.

**Self-repo mode:** when the verifier/gate runs in the contract's own repository
(`config.repository === contract.repository`), it prints
`self-repo: downstream contract checks skipped`, skips the downstream-adopter checks (required
profile/docs/workflow pins) and still checks `templateVersion`/required-config alignment. Downstream
behaviour is unchanged, so `release:bump` + `gate:release` work for tracker releases (v1.3.0 and
v1.4.0 evidence) and `stream.mjs close`'s default gate command works for Tracker OS Streams.

## Upgrade procedure

1. **Read** target changelog + diff/overrides.
2. **Dry-run** in a branch:
   ```bash
   git checkout -b chore/upgrade-tracker-1.4.0
   ```
3. Update:
   - `tracker.config.json` (`automation.templateVersion`, new optional fields);
   - caller workflow refs/tags (pin exact release tags for required workflows; the contract verifier rejects SHA pins);
   - copied files (re-copy + re-apply overrides).
4. **Validate config:**
   ```bash
   node scripts/adopt/cli/validate-config.mjs tracker.config.json
   # OK   tracker.config.json
   ```
5. Run local/CI checks; keep audit advisory in the upgrade PR.
6. Update docs/version references and downstream tracking issue.
7. Merge; run audit; record new pin.
8. If broken, roll back per §Rollback.

## Migration notes template

```markdown
## Migration — tracker vOLD → vNEW

- **Breaking changes:** ...
- **Config changes:** ...
- **Copied-file changes:** ...
- **Workflow/token changes:** ...
- **Manual steps:** ...
- **Rollback:** reset pin to vOLD, restore files from tag/commit
- **Verification:** config validate + CI + audit + smoke
```

## Optional: adopt the tooling work profile

v1.3.0 adds an optional `workProfile` (`product` default, or `tooling`) plus an optional
`fields.Stream` declaration. No action is required for existing adopters: absent `workProfile`
keeps the current Release → Sprint behaviour, and a declared `Stream` field is ignored in
`product` mode.

To adopt `tooling`:

1. Set `"workProfile": "tooling"` and declare `"fields": { "Stream": { "options": ["vX.Y.Z"] } }`.
   Tooling-only repos may drop Release/Sprint fields and use `"releases": []` (the tag is the
   version record); mixed repos may keep both declarations.
2. Validate and bootstrap:
   ```bash
   node scripts/adopt/cli/validate-config.mjs tracker.config.json
   node scripts/adopt/cli/bootstrap.mjs --config tracker.config.json --apply
   ```
3. Open deliveries with `node scripts/adopt/cli/stream.mjs open --name vX.Y.Z --delivery "..."` and
   start tasks with `node scripts/adopt/cli/task.mjs start --issue N --stream S`.
4. Historical product records keep working: audit rules follow `workProfile`, so Release/Sprint
   exit-evidence and hierarchy rules do not apply to a tooling profile.
5. Rollback: set `workProfile` back to `product` (or remove it); no data migration is needed.

See [profiles/tooling](../profiles/tooling/README.md) and [REFERENCE §5.3–5.5](./REFERENCE.md#5-tracker-cli).

## Optional: adopt the remote-only verification policy

v1.3.0 adds an optional `verification.remoteOnly[]` block (`id`, `workflow`, `prLabel`,
`localMode: hidden|forbidden`, `overrideEnv`, `docs`). No action is required for existing
adopters: absent or empty block is a no-op and suites keep running as before.

To adopt it:

1. Declare the disruptive suite(s), e.g. desktop GUI smoke:
   ```json
   "verification": {
     "remoteOnly": [
       {
         "id": "desktop-smoke",
         "workflow": ".github/workflows/reusable-desktop-smoke.yml",
         "prLabel": "run-desktop-smoke",
         "localMode": "hidden",
         "overrideEnv": "TRACKER_ALLOW_VISIBLE_GUI",
         "docs": "profiles/desktop/README.md"
       }
     ]
   }
   ```
2. Validate: `node scripts/adopt/cli/validate-config.mjs tracker.config.json` and
   `npm run verify:tooling` (both reject malformed policy entries).
3. Wire the offline guard before the suite spawns (`npm run guard:local-suite -- --suite <id>`)
   and/or the Playwright `globalSetup` from `scripts/adopt/lib/playwright-remote-guard.mjs`.
4. Record the remote-run evidence at check-out; hidden local runs stay non-authoritative and the
   override env is for deliberate human debugging only (agents must not use it).
5. Rollback: remove the `verification` block; absent config restores previous local behaviour.

See [profiles/desktop](../profiles/desktop/README.md) and
[REFERENCE §5.6](./REFERENCE.md#56-guard-local-suite-remote-only-verification-policy).

## Optional: adopt the verified counts contract

v1.3.0 adds an optional `docs.counts` block (baseline, generated doc, marker files,
inventory/update commands). Absent config is a no-op and existing docs/suites are unchanged.

To adopt it:

1. Declare the block (see [profiles/counts](../profiles/counts/README.md)) and validate:
   ```bash
   node scripts/adopt/cli/validate-config.mjs tracker.config.json
   npm run verify:tooling
   ```
2. Create the initial baseline from real output:
   `node scripts/adopt/cli/suite-counts.mjs record --suite <id> --mode <mode> --results <file>`, then
   complete `knownSkips` agreement metadata (`reason`/`coveredBy`/`agreedOn`) and
   `reviewed { on, by, evidence[] }`; `node scripts/adopt/cli/suite-counts.mjs render` regenerates
   `docs/TEST_COUNTS.md` + markers.
3. Add CI gates: suite jobs run `suite-counts check`; docs jobs run `guard:docs:counts`
   (no test execution). Historical docs are exempt by construction — only `docs.counts.markers`
   files are checked.
4. Rollback: remove the `docs.counts` block (and generated/baseline files if desired); absent config
   restores previous behaviour.

See [REFERENCE §5.7](./REFERENCE.md#57-verified-counts-contract-suite-counts-guard-docs-counts).

## Rollback

- Revert the upgrade PR **or** restore the previous tag/commit for copied files.
- Reset `automation.templateVersion` to the previous exact version.
- Re-run config validation/CI.
- If the failure is upstream, open a downstream bug report with the version/error; document the workaround.

Do not force-push over teammates' changes; use a revert PR.

## Changelog requirements

Every template release documents:

- version and date;
- patch/minor/major classification;
- breaking changes + migration;
- config/workflow/token changes;
- docs/reference updates;
- known issues.

## Downstream tracking

For each adopted project, track the upgrade as a task/issue:

- link the upstream release/changelog;
- optionally mark blocked-by the upstream release;
- include migration/evidence;
- update the pin in the same PR;
- close after audit/checks pass.

## Compatibility policy

- Document minimum `gh`/Node/runner versions.
- Private reusable access may change visibility; copy fallback must remain documented.
- Template v1.0.x patches are compatible; v1.1.0 adds features; v2.0.0 may break.
- If a project needs an unsupported change, prefer an upstream issue/contract extension over a local fork.

## Docs versioning

Docs carry `vX.Y.Z-docs.N`; update docs with the template version. T12 validates docs before release; downstream should refresh linked docs on upgrade.


## Lint/format self-check (T18)

Tracker OS now self-applies ESLint and Prettier: `npm ci`, `npm run lint`, and
`npm run format:check`. A missing or broken lint/format command fails CI rather than succeeding
as a no-op. Dev tooling is approved in `tracker.dependencies.json`; see issue #82.
