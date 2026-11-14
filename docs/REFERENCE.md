# REFERENCE

**Docs version:** v1.4.0-docs.1 · Target template: v1.4.0
**Scope:** commands, config, fields/statuses, labels, templates, audit rules, workflows, tokens, runners, release profiles, and expected outputs.

> **Availability key:** **now** = shipped and validated in this template; **planned** = contract/example only, not claimed as implemented. Manual fallbacks remain in [HOW TO USE](./HOW_TO_USE.md).

---

## Contents

- [1. Repository map](#1-repository-map)
- [2. Command conventions](#2-command-conventions)
- [3. Discover project IDs](#3-discover-project-ids)
- [4. `gh` commands used in this tracker](#4-gh-commands-used-in-this-tracker)
- [5. Tracker CLI](#5-tracker-cli)
- [6. Config reference](#6-config-reference)
- [7. Fields, statuses, transitions](#7-fields-statuses-transitions)
- [8. Labels](#8-labels)
- [9. Issue types and fallback](#9-issue-types-and-fallback)
- [10. Issue/PR templates](#10-issuepr-templates)
- [11. Comment templates](#11-comment-templates)
- [12. Audit invariants](#12-audit-invariants)
- [13. Workflow catalog](#13-workflow-catalog)
- [14. Token and secret matrix](#14-token-and-secret-matrix)
- [15. Runner / cost guidance](#15-runner-cost-guidance)
- [16. Release profiles](#16-release-profiles)
- [17. Shell notes](#17-shell-notes)
- [18. Environment variables](#18-environment-variables)
- [19. Expected outputs and diagrams](#19-expected-outputs-and-diagrams)
- [20. Versioning](#20-versioning)
- [21. Local-first verification and batching](#21-local-first-verification-and-batching)

## 1. Repository map

| Path | Purpose | Availability |
|---|---|---|
| `docs/GITHUB_PROJECT_TRACKER_PLAYBOOK.md` | conceptual/operating model | now |
| `docs/HOW_TO_USE.md` | full handbook | now |
| `docs/QUICKSTART.md` | first tracker | now |
| `docs/REFERENCE.md` | this reference | now |
| `docs/TROUBLESHOOTING.md` | symptom → cause → fix | now |
| `docs/ADOPTION.md` | zero→first task adoption | now |
| `docs/UPGRADING.md` | pin/upgrade/rollback | now |
| `docs/AGENT_GUIDE.md` | agent operating protocol | now |
| `docs/MULTI_PROJECT.md` | program/multi-project model | now |
| `docs/DOWNSTREAM_FEEDBACK.md` | upstream reporting/triage | now |
| `docs/comment-templates/` | check-in/update/out/blocker/plan-change/sprint/release | now |
| `docs/reference-cards/` | seven printable one-page cards + A4/Letter PDFs | now |
| `docs/DOCS_STYLE_GUIDE.md` | documentation standards/review checklist | now |
| `docs/ACTIONS_CATALOG.md` | Actions catalog/contracts | now |
| `docs/CI_SECURITY_PROFILE.md` | CI/security runbook | now |
| `docs/RELEASE_PROFILES.md` | release profiles/callers | now |
| `docs/GITHUB_APP_SPIKE.md` | bot-identity spike (NO-GO) | now |
| `docs/TEMPLATE_REPO.md` | template structure/versioning/tag policy | now |
| `tracker.config.example.json` | generic config | now |
| `schemas/tracker.config.schema.json` | config contract | now |
| `contract/adoption-contract.json` | downstream adoption contract (pinned refs, required workflows/profiles) consumed by `verify-contract`/`release-gate` | now |
| `contract/repo-surface.json` | repo-surface manifest: class/status/docs source of truth for scripts/workflows/release examples | now |
| `scripts/adopt/cli/` | adopter CLIs — lifecycle, reconciliation, guards, verification (individual CLIs below) | now |
| `scripts/adopt/lib/` | shared libraries imported by the CLIs (GitHub transport, guards, work profiles, Playwright guard) | now |
| `scripts/adopt/docs/` | docs-QA CLIs: `check-docs.mjs`, `check-versions.mjs`, `guard-docs.mjs` | now |
| `scripts/internal/` | template-maintainer-only tools (never copied): `build-cards.mjs`, `bump-version.mjs`, `verify-surface.mjs` | now |
| `scripts/internal/verify-surface.mjs` | repo-surface manifest ↔ shipped-surface verifier (`npm run verify:surface`) | now |
| `scripts/adopt/cli/validate-config.mjs` | config validation | now |
| `scripts/adopt/cli/bootstrap.mjs` | idempotent repo/project setup | now |
| `scripts/adopt/cli/audit.mjs` | tracker audit (advisory/strict/JSON), mode-aware | now |
| `scripts/adopt/cli/reconcile-status.mjs` | close-out Project-status reconciliation (report/apply) | now |
| `scripts/adopt/cli/task.mjs` | start/checkpoint/review/block/done/status | now |
| `scripts/adopt/cli/stream.mjs` | tooling-profile `[Stream]` open/close lifecycle | now |
| `scripts/adopt/cli/project-field-option.mjs` | safe single-select option append (preserves ids/item values) | now |
| `scripts/adopt/cli/guard-local-suite.mjs` | remote-only suite guard (enforce/report, offline) | now |
| `scripts/adopt/lib/playwright-remote-guard.mjs` | dependency-free Playwright `globalSetup` factory for the remote-only policy | now |
| `scripts/adopt/lib/work-profile.mjs` | product/tooling enforcement adapters (shared engine) | now |
| `scripts/adopt/lib/verification-policy.mjs` | remote-only policy resolution/evaluation (shared, offline) | now |
| `scripts/adopt/cli/suite-counts.mjs` | counted-runner parsers/compare + counts `check\|record\|render` CLI | now |
| `scripts/adopt/cli/guard-docs-counts.mjs` | counts baseline/agreement + generated-doc/marker guard | now |
| `schemas/test-counts.baseline.schema.json` | counts baseline JSON schema | now |
| `profiles/node/` | generic lint/format profile | now |
| `profiles/desktop/` | desktop smoke caller + remote-only local guard | now |
| `profiles/tooling/` | tooling work-profile selection + example config | now |
| `profiles/counts/` | counts contract wiring, example baseline, and the reusable `counts-docs.yml` caller example | now |
| `profiles/contract/` | contract + metadata reusable caller example (`tracker-contract.yml`) and token/check-name guidance | now |
| `profiles/audit/` | audit-family reusable caller examples (`tracker-audit.yml`, `post-merge-audit.yml`, `pr-close-guard.yml`) + permissions/check-name/rollback guidance | now |
| `profiles/e2e/` | reusable Playwright E2E caller example (`e2e.yml`) + browser/network/artifact guidance | now |
| `.github/ISSUE_TEMPLATE/` | task/sprint/release/spike + downstream forms | now |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR checklist | now |
| `.github/workflows/`, `.github/actions/` | internal runner callers + `reusable-*` workflow contracts + composite actions (`release.yml` is the only runnable release caller here) | now |
| `profiles/release/` | release profile examples: reusable-mode callers in `reusable/` (copy into `.github/workflows/` + pin the adopted tag) and copy-mode templates in `copy/` | now |

## 2. Command conventions

- `OWNER/REPO`, `PROJECT_NUMBER`, `ITEM_ID`, `FIELD_ID`, `OPTION_ID` are placeholders; discover IDs in §3.
- Every CLI command is shown with expected success output or no output (exit 0).
- Failure exit codes are typically 1; GraphQL/auth failures print the API message and exit 1.
- Never paste tokens into commands; use `GH_TOKEN`/secrets.

## 3. Discover project IDs

```bash
gh project list --owner @me --format json
# {"projects":[{"number":1,"title":"Project Tracker","id":"PVT_..."}]}

gh project field-list PROJECT_NUMBER --owner @me --format json
# {"fields":[{"id":"PVTSSF_...","name":"Status","options":[{"id":"...","name":"Todo"}]}]}

gh project item-list PROJECT_NUMBER --owner @me --format json --limit 100
# {"items":[{"id":"PVTI_...","content":{"number":123,"title":"..."},...}]}
```

Extract with `jq` if installed:

```bash
gh project field-list "$PROJECT_NUMBER" --owner @me --format json \
  | jq -r '.fields[] | [.name,.id] | @tsv'
# Status  PVTSSF_...
# Release PVTSSF_...
```

## 4. `gh` commands used in this tracker

### Auth
```bash
gh auth status
# ✓ Logged in to github.com account <you> (...)
# - Token scopes: 'repo', 'project', ...

gh auth refresh -s project,repo
# opens browser; required when scope is missing
```

### Issues
```bash
gh issue create --repo OWNER/REPO --title "[Task] ..." --body-file task.md
# https://github.com/OWNER/REPO/issues/123

gh issue list --repo OWNER/REPO --state open --limit 50
# shows number/title/labels

gh issue view 123 --repo OWNER/REPO --json number,title,state,body
gh issue edit 123 --repo OWNER/REPO --add-assignee @me
gh issue comment 123 --repo OWNER/REPO --body-file comment.md
gh issue close 123 --repo OWNER/REPO --reason completed
```

### PRs
```bash
gh pr create --fill --body "Closes #123"
# https://github.com/OWNER/REPO/pull/45

gh pr view 45 --json state,mergeable,checks
gh pr checks 45
gh pr merge 45 --squash --delete-branch
# ✓ Merged pull request #45
```

### Milestones
```bash
gh api repos/OWNER/REPO/milestones -f title="v1.0.0" -f description="Target"
# {"number":1,...}
gh api repos/OWNER/REPO/milestones/1 -X PATCH -f state=closed
```

### Project fields/items
```bash
gh project field-create PROJECT_NUMBER --owner @me --name "Status" \
  --data-type SINGLE_SELECT --single-select-options "Todo,In Progress,In Review,Blocked,Done"
# creates field/options (verify with field-list)

gh project item-add PROJECT_NUMBER --owner @me \
  --url https://github.com/OWNER/REPO/issues/123
# item JSON

gh project item-edit --id ITEM_ID --project-id PROJECT_ID \
  --field-id FIELD_ID --single-select-option-id OPTION_ID
# no output on success
```

Notes:
- Field option IDs must be discovered; `gh project field-create` may return them only via `--format json`.
- Changing a single-select field value requires option IDs, not labels.
- Field names must not collide with reserved names (`Type` is reserved; use `Kind`).

### Sub-issues / dependencies
```bash
CHILD_ID=$(gh api repos/OWNER/REPO/issues/123 --jq .id)
gh api repos/OWNER/REPO/issues/100/sub_issues -X POST -F sub_issue_id="$CHILD_ID"
# no body; parent progress updates

gh issue edit 123 --repo OWNER/REPO \
  --add-blocked-by https://github.com/OWNER/REPO/issues/99
# blocked-by relationship (GitHub native dependencies)
```

If native sub-issues/dependencies are unavailable: use body links + labels; document fallback.

Create trackers and tasks through `bootstrap.mjs` (it creates and links the tree); `task.mjs` and
`stream.mjs` operate on that tree, and `task.mjs start` enforces the existing parent link. If board
creation used raw `gh`/UI instead, assert the intended tree and run the advisory audit before
starting work (§5.9).

### Views
```bash
gh api graphql --input view-query.json
# project views/filter; UI is authoritative for filters
```
UI: Project → view tabs → New view → set layout/filter/group.

## 5. Tracker CLI

All three CLIs are available now. They read `tracker.config.json`; `--help` describes current flags.

### 5.1 bootstrap

```bash
node scripts/adopt/cli/bootstrap.mjs --config tracker.config.json --dry-run
node scripts/adopt/cli/bootstrap.mjs --config tracker.config.json --apply
node scripts/adopt/cli/bootstrap.mjs --config tracker.config.json --json
```
Default dry-run. Creates/updates project, fields/statuses/options, milestones, labels, roadmap/release/sprint/task skeletons, native types, project items/fields, sub-issues. Never deletes user data; resource matching is by **exact generated title**, so mismatched existing titles create new resources — reuse generated titles or update the config before re-running. Manual checklist for UI-only views/workflows at end.

In the **tooling work profile** (`workProfile: "tooling"`) bootstrap ensures project fields (including `fields.Stream`), status options, labels and milestones only: the product release → sprint → task skeleton is not created, because deliveries are `[Stream]` containers created with `stream.mjs open`.

### 5.2 audit

```bash
node scripts/adopt/cli/audit.mjs --config tracker.config.json --advisory
node scripts/adopt/cli/audit.mjs --config tracker.config.json --strict
node scripts/adopt/cli/audit.mjs --config tracker.config.json --json
```
Advisory default: prints violations, exit 0. `--strict` exits 1 on violations for release gates.
Workflow: reusable `reusable-audit.yml`, consumed by the thin self caller `tracker-audit.yml`
(weekly schedule, `workflow_dispatch`, and an advisory run on pull requests); check context
`tracker-audit / audit`. Advisory mode without `TRACKER_TOKEN` prints a `::notice::` and skips
cleanly (exit 0); strict mode requires the token and fails actionably without it. Local parity:
`npm run audit -- --config tracker.config.json --advisory` (or `--strict`).

Warnings (for example `PROJECT_STATUS_STALE`, §5.8) are advisory by design and never change the
exit code, including under `--strict`. Close-out and hierarchy verification commands are in
§5.8–5.9.

Example warning output:

```text
warning: [PROJECT_STATUS_STALE] #116 closed issue has Project status In Review (expected Done) — fix: npm run reconcile:status -- --config tracker.config.json --apply
```

### 5.3 task

```bash
node scripts/adopt/cli/task.mjs start --issue 123 [--owner LOGIN] [--executor TEXT] [--branch NAME] [--dry-run]
node scripts/adopt/cli/task.mjs start --issue 123 --stream STREAM_ISSUE   # tooling profile only
node scripts/adopt/cli/task.mjs checkpoint --issue 123 (--message TEXT | --message-file FILE)
node scripts/adopt/cli/task.mjs review --issue 123 [--pr URL] [--evidence TEXT]
node scripts/adopt/cli/task.mjs block --issue 123 --reason TEXT [--blocked-by URL]
node scripts/adopt/cli/task.mjs done --issue 123 (--evidence TEXT | --evidence-file FILE) [--pr URL] [--force]
node scripts/adopt/cli/task.mjs status --issue 123
```
Enforces DoR/WIP on start and evidence/acceptance on done; `--dry-run` makes no mutations. The
enforcement matrix follows `config.workProfile`:

| Check | `product` (default) | `tooling` |
|---|---|---|
| Start container | Release/Sprint fields | `--stream` required; task must be a sub-issue with a matching `Stream` field |
| Required item fields | Area/Kind/Estimate/Release/Sprint | Area/Kind/Estimate/Stream |
| Milestone | required | optional (tag is the version record) |
| WIP/assignee/check-in | WIP = 1, assignee + `### Check-in` | identical |
| Done | evidence + checked acceptance | **PR required** + evidence + checked acceptance; posts `### Check-out` |

Full behavior: [TASK CLI](./TASK_CLI.md). Tooling-profile checks are rejected for product configs
and product mode ignores every tooling flag.

**Auto-close caveat:** a PR body with `Closes #<issue>` makes GitHub close the issue at merge,
before `task.mjs done` runs; `done` then refuses the closed issue (`#<issue> is not open`) and the
Project Status stays wherever it was. Reconcile it with `reconcile-status.mjs` after every merge
(§5.8).

### 5.4 stream (tooling profile)

```bash
node scripts/adopt/cli/stream.mjs open --name v1.3.1 --delivery "Documentation & maintenance" [--dry-run]
node scripts/adopt/cli/stream.mjs close --stream STREAM_ISSUE (--evidence TEXT | --evidence-file FILE) [--tag vX.Y.Z] [--dry-run]
```
`open` creates `[Stream] <name> — <delivery>`, safely appends the per-delivery `Stream` option,
adds the container to the project with Status/Stream/Area/Kind/Estimate, and posts
`### Stream opened`. `close` refuses while child tasks are open, requires the release gate green
(`gate:release`; override with `--gate-command`), validates `--tag` against
`automation.tagPattern`, posts `### Stream close evidence`, sets Status Done, and closes the
container. Tag creation stays with the release flow. Product configs are rejected.

`close` checks the child issue states, not their Project Status: run the close-out reconciliation
(§5.8) before closing so every merge-keyword auto-closed child task is `Done` on the board.

### 5.5 project-field-option

```bash
node scripts/adopt/cli/project-field-option.mjs --config tracker.config.json --field Stream --option v1.3.2 \
  [--color BLUE] [--description TEXT] [--dry-run] [--json]
```
Reads the current options first, preserves every existing id/colour/description (so item values
that reference those ids are unchanged), appends only a new name, and is idempotent on re-run.
Used by `stream.mjs open` and handy when creating per-delivery options by hand. Accepts both the `ProjectV2SingleSelectField` type reported by `gh project field-list` and the `SINGLE_SELECT` shape used by the test fakes; non-single-select fields are rejected.

### 5.6 guard-local-suite (remote-only verification policy)

```bash
node scripts/adopt/cli/guard-local-suite.mjs --suite desktop-smoke [--mode enforce|report] [--hidden] [--json]
node scripts/adopt/cli/guard-local-suite.mjs --root . --config tracker.config.json --suite <id> --mode enforce
```
Enforces `verification.remoteOnly[]` from `tracker.config.json` before a disruptive suite spawns.
Remote detection is **`GITHUB_ACTIONS === 'true'`** only (a local `CI=true` is not remote):

| Situation | `--mode enforce` (default) | `--mode report` |
|---|---|---|
| Remote runner (`GITHUB_ACTIONS=true`) | allowed (`REMOTE_ALLOWED`) | allowed (`REMOTE_ALLOWED`) |
| Local + override env set | allowed with a loud warning (`LOCAL_OVERRIDE_ALLOWED`) | allowed with a loud warning |
| Local + `--hidden` and suite `localMode: hidden` | allowed, non-authoritative (`LOCAL_HIDDEN_ALLOWED`) | allowed |
| Local + `localMode: forbidden` (or hidden not requested) | **exit 1** (`BLOCKED_LOCAL_VISIBLE`) with workflow/label/hidden/override/docs instructions | `DEFERRED_REMOTE` line, exit 0 |
| Unknown suite id | exit 1 with known suite ids | exit 1 |
| No `verification.remoteOnly` | no-op (`NO_POLICY`, exit 0) | no-op |

`--json` prints a machine-readable result; `--mode report` prints a single machine-readable
`DEFERRED_REMOTE suite=<id> workflow=<...> prLabel=<...> overrideEnv=<...> docs=<...>` line for
verify aggregators. Hidden local mode is non-authoritative; the remote visible run is the evidence.
The override env is for deliberate human debugging only — **agents must never set it**.

`playwright-remote-guard.mjs` exposes `createPlaywrightRemoteGuard({ suite, hidden, config, configPath, env })`,
which returns a Playwright `globalSetup` function; it throws with the same instructions before any
window is created. It imports no `@playwright/test` so adopters wire it from their own config (see
[profiles/desktop](../profiles/desktop/README.md)).

### 5.7 Verified counts contract (suite-counts + guard-docs-counts)

```bash
# compare real runner output with the committed baseline (exit 1 on drift/flaky/malformed output)
node scripts/adopt/cli/suite-counts.mjs check --suite unit --mode full --results test-results/unit.tap

# record new counts + skip identities into the baseline and regenerate docs/markers
node scripts/adopt/cli/suite-counts.mjs record --suite unit --mode full --results test-results/unit.tap

# regenerate canonical doc + inline markers from the baseline (--check fails when stale)
node scripts/adopt/cli/suite-counts.mjs render [--check]

# docs guard: baseline schema/agreement + generated doc + marker freshness (no test execution)
node scripts/adopt/cli/guard-docs-counts.mjs [--root DIR] [--config FILE] [--json]
```

The contract is enabled by `docs.counts` in `tracker.config.json` (`baseline`, `generated`,
`markers`, `inventoryCommand`, `updateCommand`); absent config is a no-op. Baseline JSON holds one
entry per suite id + mode (`remote-visible`, `local-hidden`, `offline`, `full`, or repo-specific)
with `{ collected, passed, failed, skipped, flaky }`, `knownSkips[{ test, reason, coveredBy,
agreedOn }]`, and `reviewed { on, by, evidence[] }`
([schema](../schemas/test-counts.baseline.schema.json), [example](../profiles/counts/test-counts.baseline.example.json)).

Parsers (`--runner auto|playwright|node-test|verify`) support Playwright JSON (`stats` + skipped
titles + flaky; interrupted runs fail), node-test summary/TAP (`skipped`+`todo` -> skipped,
`cancelled` -> failed; TAP gives skip titles), and verify `--json` statuses
(`PASS`/`FAIL`/`WARN`/`SKIP`/`DEFERRED_REMOTE` -> counts). `check` is quiet on zero drift
(`COUNTS_OK suite=... mode=... ...`) and fails on any count drift, added/removed/renamed skip,
flaky > 0, or unknown/malformed output with exact diff + inventory/update guidance. `record`
writes counts, adds placeholder `knownSkips` for new skips, and regenerates `docs/TEST_COUNTS.md` +
every `<!-- counts:<suite>/<mode>[/<metric>] -->...<!-- /counts:... -->` marker; humans fill in
agreement metadata in the same PR. The guard validates schema/agreement, regenerates the canonical
doc, and fails stale/missing docs/markers; historical docs are exempt by construction (only
`docs.counts.markers` files are checked).

Reusable-mode docs caller: `counts-docs.yml` → `reusable-counts.yml` (copy example:
`profiles/counts/counts-docs.yml`) emits check context **`counts-docs / counts`**; the reusable job
runs `guard-docs-counts.mjs --root "$GITHUB_WORKSPACE" --config "$CONFIG"` against the workspace
(self) or the pinned `.tracker` checkout (downstream). It uploads no artifacts, needs no secrets
(`contents: read`), and does **not** run the suite inventory/tests. When `docs.counts` is absent the
caller is a documented no-op — require `counts-docs / counts` only in projects that adopt the
contract; live baseline validation is downstream/C3. Full adoption wiring:
[profiles/counts](../profiles/counts/README.md).

### 5.8 reconcile-status (close-out Project status)

Project **Status** is per-item metadata: a PR merged with `Closes #<issue>` closes the issue, but
the field is not updated, and `task.mjs done` refuses closed issues. Reconcile after every merge and
before closing a sprint, release, or stream.

```bash
node scripts/adopt/cli/reconcile-status.mjs --config tracker.config.json           # report-only (default)
node scripts/adopt/cli/reconcile-status.mjs --config tracker.config.json --apply   # set flagged items to Done
node scripts/adopt/cli/reconcile-status.mjs --config tracker.config.json --json    # machine-readable plan/result
npm run reconcile:status                                                       # report-only, default config
```

A repository that pins the tracker as a submodule runs the pinned copy with its project token:

```bash
GH_TOKEN=$(gh auth token) node .tracker-os/scripts/adopt/cli/reconcile-status.mjs --config tracker.config.json
```

Report-only on a clean board (exit 0, no mutations):

```text
$ node scripts/adopt/cli/reconcile-status.mjs --config tracker.config.json
Project-status reconciliation — OWNER/REPO (project #PROJECT_NUMBER)
No stale Project statuses; every closed item is Done.
```

With drift, the report lists one line per item and `--apply` fixes each with one field mutation:

```text
$ node scripts/adopt/cli/reconcile-status.mjs --config tracker.config.json
Project-status reconciliation — OWNER/REPO (project #PROJECT_NUMBER)
Stale closed item(s) (1) — status should be Done:
- #116 status=In Review — [1.3.0.1-T05] Release v1.3.0 metadata, docs and tag
Run with --apply to set these items to Done.

$ node scripts/adopt/cli/reconcile-status.mjs --config tracker.config.json --apply
Project-status reconciliation — OWNER/REPO (project #PROJECT_NUMBER)
Stale closed item(s) (1) — status should be Done:
- #116 status=In Review — [1.3.0.1-T05] Release v1.3.0 metadata, docs and tag
Applied 1 status update(s).
```

`--json` prints `{ ok, repository, project, apply, count, plan[], applied[], skipped[] }` for
evidence; plan entries carry `code`, `issue`, `title`, `status`, `itemId`, `fix`, `message`.
Items missing a project-item id are skipped with `warning: #N skipped (project item id missing)`.

Scope: closed issues **on the configured project** whose Project Status is not `Done` — including
an item with **no status value at all** (`closed issue has no Project status (expected Done)`).
Items from another repository on a shared project are ignored; closed issues never added to the
project are out of scope. There is no work-profile gate and no historical-record exemption here:
unlike delivery evidence (the T06 `requiresStreamAncestry` precedent), Project Status is
current-state board metadata, not a historical record. The audit reports the same drift as the
`PROJECT_STATUS_STALE` warning (§12); the audit never repairs it, this command does. Re-running is
safe and idempotent; `--apply` requires a project token plus the `Status`/`Done` field option and
fails loudly when the project, field, or option is missing.

Manual fallback for a project still pinned to an older tracker version (`jq` required):

```bash
# list: join closed issues with non-Done project items
gh project item-list PROJECT_NUMBER --owner PROJECT_OWNER --format json --limit 200 > /tmp/items.json
gh issue list --repo OWNER/REPO --state closed --limit 200 --json number,state,title > /tmp/closed.json
jq -r --slurpfile closed /tmp/closed.json \
  '.items[] | select(.content.type == "Issue" and .status != "Done") | .content.number as $n
   | $closed[0][] | select(.number == $n) | "#\(.number) \(.state) \(.title)"' /tmp/items.json

# fix one item (no node IDs needed; no output on success)
gh project item-edit PROJECT_NUMBER --owner PROJECT_OWNER \
  --url https://github.com/OWNER/REPO/issues/116 --field Status --value Done
```

### 5.9 Expected-tree assertion and advisory audits

Run after a completion merge that auto-closed issues, and after any board creation that bypassed
`bootstrap.mjs`, `task.mjs`, or `stream.mjs`; record the output as close-out evidence.

**1. Assert the intended tree.** Native sub-issues are the hierarchy source; the parent endpoint is
the inverse link.

```bash
# product: sprints under a release; tasks under a sprint
gh api repos/OWNER/REPO/issues/RELEASE_ISSUE/sub_issues \
  --jq '.[] | "\(.number)\t\(.state)\t\(.title)"'
gh api repos/OWNER/REPO/issues/SPRINT_ISSUE/sub_issues \
  --jq '.[] | "\(.number)\t\(.state)\t\(.title)"'
# inverse link: a sprint/task parent is its tracker; 404 = no parent (e.g. a top-level [Stream])
gh api repos/OWNER/REPO/issues/SPRINT_ISSUE/parent --jq '.number'

# tooling: tasks under a stream
gh api repos/OWNER/REPO/issues/STREAM_ISSUE/sub_issues \
  --jq '.[] | "\(.number)\t\(.state)\t\(.title)"'
```

A missing sprint→release, task→sprint, or task→stream link means the tree was not created: fix it
with `gh api repos/OWNER/REPO/issues/<parent>/sub_issues -X POST -F sub_issue_id=...` (§4) or rerun
`bootstrap.mjs --apply`, then re-assert. The audit reports the same evidence:
`SPRINT_HIERARCHY_MISSING_RELEASE` (open product sprint) and `TASK_HIERARCHY_MISSING_RELEASE` /
`_SPRINT` / `_STREAM` (open task), §12.

**2. Reconcile Project statuses** with §5.8.

**3. Run the advisory audit** for the repository you are in:

```bash
# tracker repo (self): advisory, exit 0
node scripts/adopt/cli/audit.mjs --config tracker.config.json --advisory

# downstream adopter: run the pinned copy (e.g. the .tracker-os submodule) with a project-scoped token
GH_TOKEN=$(gh auth token) node .tracker-os/scripts/adopt/cli/audit.mjs --config tracker.config.json --advisory
```

Findings are advisory: fix them before closing the sprint/release/stream or before a `--strict`
release gate; never make the advisory run a merge blocker. Record the command + result (`--json` for
machine-readable evidence, `warnings[]`/`violations[]` carry the codes) with the close-out comment.

## 6. Config reference

Validate:
```bash
node scripts/adopt/cli/validate-config.mjs tracker.config.json
# OK   tracker.config.json
```

| Key | Required | Notes |
|---|---|---|
| `$schema` | no | path/URL to schema |
| `trackerVersion` | yes | `1`; bump only with migration |
| `workProfile` | no | `product` (default) or `tooling`; selects the enforced lifecycle; absent means `product` |
| `repository` | yes | `owner/repo` |
| `project` | yes | `owner`, `title`, `number` (required by audit/task CLI) |
| `statuses` | yes | 5+ unique, standard set recommended |
| `fields` | yes | Release/Sprint (product profile), Stream (tooling profile), Area/Kind/Estimate required; Source recommended |
| `issueTypes` | no | task/bug/feature + fallback notes |
| `labels` | no | risk/process only; no dimension labels |
| `releases` | yes | key, milestone, sprints (key/title/estimate/tasks); may be empty only for tooling configs |
| `automation` | no | defaultAssignee, branchPrefix, tagPattern, templateRepo/version, inReviewMode, autoAddIssues, closeToDone, bot |
| `profiles.node.commands` | no | lint/format/test/e2e/verify/build mappings |
| `workflows` | no | ci mode/ref/requiredChecks/commands; audit mode (secret name fixed `TRACKER_TOKEN`); release profile/ref/dryRun |
| `verification` | no | optional `remoteOnly[]` suite policy: `id`, `workflow`, `prLabel`, `localMode` (`hidden`/`forbidden`, default forbidden), `overrideEnv`, `docs`; absent or empty = no-op |
| `docs.counts` | no | optional verified PASS/FAIL/SKIP contract: `baseline`, `generated`, `markers[]`, `inventoryCommand`, `updateCommand`; absent = no-op |
| `feedback` | no | upstreamRepo/issueForm/pinnedVersion/securityContact |
| `guard` | no | `transportOnly`, `allow[]`, `requiredChecks[]` (post-merge audit check-run names; absent = backwards-compatible legacy default `ci / ci-gate`, `docs-guard`, `pr-close-guard` — v1.4.0 reusable callers publish `post-merge-audit / audit`, `pr-close-guard / guard`, `tracker-audit / audit`, so set your real contexts) |
| `governance` | no | versioning, publication status/license, security contact/private reporting |

Validation behaviors: required/missing keys, type mismatches, disallowed extra keys, duplicate options/release/sprint keys, missing standard statuses, secret-looking values, templateRepo without version, and profile-aware field rules: the `product` profile (default) requires `fields.Release`/`fields.Sprint` and at least one release; the `tooling` profile requires a `fields.Stream` declaration and allows `releases: []`. `verification.remoteOnly[]` entries require `id`/`workflow`, reject unknown keys, enforce the `localMode` enum and env-var-name shape for `overrideEnv`, and require unique suite ids. Exit 1 with `$path: message`.

## 7. Fields, statuses, transitions

### Fields
| Field | Values | Applies to |
|---|---|---|
| Status | Todo/In Progress/In Review/Blocked/Done | all work items |
| Release | version keys (+ pre-release if documented) | release work (product profile) |
| Sprint | sprint keys | release work (product profile) |
| Stream | per-delivery options (e.g. `v1.3.1`) | `[Stream]` containers + tasks (tooling profile) |
| Area | stable areas | all |
| Kind | feature/fix/ux/spike/test/infra | all |
| Estimate | S/M/L or numeric | all |
| Source | Internal/downstream/Other | all; downstream required during triage |

Work profiles: `product` (default) uses `[Release]` → `[Sprint]` → Task with Release/Sprint fields;
`tooling` uses `[Stream]` → Task with the Stream field and the tag as version record. Absent
`workProfile` means `product`; a declared `Stream` field in product mode is ignored.

**Tracker OS itself** flips to `tooling` from v1.3.0 onward via a historical post-tag config PR: the v1.3.0 tag
records the contract and release history, and deliveries after the tag are `[Stream]` → Task (the
tag remains the version record). Adopters keep `product` as the default unless they opt in per repo.

### Transition table
| From | To | Entry condition | Exit evidence |
|---|---|---|---|
| Todo | In Progress | DoR passes, owner/branch | check-in comment |
| In Progress | In Review | implementation ready | PR/evidence |
| In Review | In Progress | changes requested | review comment |
| In Progress | Blocked | concrete blocker | blocker comment/dependency |
| Blocked | In Progress | unblocked | unblock note |
| In Review | Done | accepted + evidence | check-out comment |
| In Progress | Done | small/docs-only + evidence | check-out comment |
| Done | (reopen) | regression/follow-up | plan-change/comment |

Rules: one In Progress per owner; Blocked requires reason + dependency; Done requires acceptance/evidence; no silent WIP.

## 8. Labels

| Label | Meaning |
|---|---|
| `risk:low|medium|high` | risk/impact |
| `plan-change` | dated scope/estimate/gate change |
| `source:downstream` | downstream-origin issue |
| `status:needs-triage` | downstream intake not triaged (Status field is authoritative for work state) |

Do not add `area:*`, `release:*`, `sprint:*`, `type:*` labels when the field/type/milestone exists. If a canonical surface is unavailable, document the fallback; it becomes authoritative for that project.

## 9. Issue types and fallback

- Native types: Task, Bug, Feature.
- Fallback if unavailable: use project Kind + documented note; avoid type labels if native types exist.
- Audit exempts only documented fallbacks.

## 10. Issue/PR templates

| File | Use |
|---|---|
| `.github/ISSUE_TEMPLATE/task.yml` | task DoR/acceptance/test/evidence/estimate |
| `.github/ISSUE_TEMPLATE/sprint.yml` | goal/scope/exit criteria |
| `.github/ISSUE_TEMPLATE/release.yml` | objective/sprints/gates/risks/artifacts |
| `.github/ISSUE_TEMPLATE/spike.yml` | timeboxed question/decision |
| `.github/ISSUE_TEMPLATE/downstream-{bug,feature}.yml` | downstream reports; auto labels |
| `.github/ISSUE_TEMPLATE/config.yml` | chooser/contact links |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR checklist/evidence |

## 11. Comment templates

`docs/comment-templates/`: check-in, update, check-out, blocker, plan-change, sprint-close, release-close. One check-in and one check-out per task; dated plan changes; evidence links, not claims.

Sprint-close and release-close record a **Project statuses reconciled** line so merge-keyword
auto-closes are fixed before a tracker closes; the check-out comment itself is generated by
`task.mjs done` and is unchanged — reconcile the field separately when the issue was already closed
(§5.8).

## 12. Audit invariants

Run `audit.mjs` advisory first; `--strict` for release gates. Invariants follow
`config.workProfile` (`product` default; `tooling` uses Stream rules; historical records stay
valid). The invariant list (`--json` reports `workProfile`):

1. Open release work has milestone + native type (milestone optional in the tooling profile).
2. Project fields complete: Area/Kind/Estimate always; Release/Sprint in the product profile;
   Stream in the tooling profile; Source for downstream items.
3. No Done parent with open children unless deferral (also enforces the stream close gate).
4. No In Progress without assignee + check-in.
5. WIP ≤ 1 In Progress per owner (or documented exception).
6. Blocked has reason + dependency.
7. No duplicate dimension labels (retired-label cleanup is manual).
8. Sprint/release Done has exit evidence (product profile); closed stream has
   `### Stream close evidence` and closed tooling tasks under a `[Stream]` have `### Check-out`
   evidence (tooling profile). Historical product-tracked tasks keep their product rules — the
   profile flip does not retroactively invalidate old records.
9. Pinned `automation.templateVersion`; downstream context complete.
10. No secrets in config/artifacts — **manual review; the audit does not scan issue bodies/comments for secrets**.
11. Open tasks contain required issue-template/DoR sections.
12. Open tasks have both a release tracker and sprint tracker ancestor (product profile) or a
    `[Stream]` ancestor (tooling profile).
13. Open product sprints have a release tracker ancestor (`SPRINT_HIERARCHY_MISSING_RELEASE`);
    closed/historical sprints are exempt and the tooling profile has no release ancestor to check.
14. Closed items on the configured project are `Done` (`PROJECT_STATUS_STALE`, warning): issue
    closure does not update the field, so merges that auto-close issues leave drift until §5.8
    runs. Warnings never change the exit code (including `--strict`); items from other
    repositories on a shared project are ignored and closed issues never added to the project are
    out of scope. There is no profile/historical exemption for this warning.

Enforcement: advisory CI first; required at release gates once stable. Audit token project-scoped; never in config.

Rule codes appear as `[CODE]` in output and as `violations[].code` / `warnings[].code` in
`--json`; use §5.8–5.9 to repair close-out findings. `PROJECT_STATUS_STALE` is a warning and never
affects the exit code; `SPRINT_HIERARCHY_MISSING_RELEASE` follows the normal advisory/strict rule
(advisory run exits 0, `--strict` exits 1 — adopters running strict audits may only now be able to
see pre-existing unlinked open sprints; the v1.3.2 release task owns the CHANGELOG entry and the
version/pin/cards refresh).

## 13. Workflow catalog

**Availability:** CI, security, release, the audit family (tracker audit, post-merge audit, PR close
guard), contract/metadata verification, desktop smoke, E2E, and counts all ship as reusable
workflows with thin callers. The reusable-docs workflow remains **contract-only** (not implemented);
E2E and counts shipped in T05 (v1.4.0). Callers are the only runnable entry points; reusable-mode
caller examples live under `profiles/` and are never executed in place.

| Workflow | Trigger | Required | Runner | Permissions | Secrets/token | Failure |
|---|---|---|---|---|---|---|
| CI (lint/format/unit) | push/PR | required | Linux | contents:read | none | block merge |
| Web/E2E — `e2e.yml` → `reusable-e2e.yml` | push/PR/nightly (caller-owned) | advisory by default; opt-in required with recorded evidence | Linux | contents:read | none | context `e2e / e2e`; failure-only artifact upload; browser install ~0.5–1 GB/run |
| Counts docs — `counts-docs.yml` → `reusable-counts.yml` | PR/push/dispatch | required only when the counts contract is adopted (otherwise documented no-op) | Linux | contents:read | none | context `counts-docs / counts`; guard-docs-counts only (no suite inventory); no artifacts |
| Desktop smoke | main/tags/path/label PR | advisory PR; required release | macOS | contents:read | none | release gate |
| Tracker audit — `tracker-audit.yml` → `reusable-audit.yml` | schedule/dispatch + advisory PR | advisory by default; strict opt-in for release gates | Linux | contents:read; project read (+ repo/issues read on private repos) via token | optional `TRACKER_TOKEN` (project + repo/issues read; advisory skips cleanly when absent; strict requires it) | context `tracker-audit / audit`; advisory never blocks, strict exits 1 on violations |
| Post-merge audit — `post-merge-audit.yml` → `reusable-post-merge-audit.yml` | `pull_request` closed (merged only); dispatch revalidation with `pr-number` | advisory (opens an OI on a real bypass) | Linux | contents:read, issues:write, pull-requests:read, checks:read, statuses:read, actions:read (caller-granted) | `GITHUB_TOKEN` automatic | context `post-merge-audit / audit`; opens `tracker-contract-exception` OI; unreadable rollup degrades loudly |
| PR close guard — `pr-close-guard.yml` → `reusable-pr-close-guard.yml` | PR opened/edited/synchronize/reopened/labeled/unlabeled | required for task PRs | Linux | contents:read, issues:read, pull-requests:read | none | context `pr-close-guard / guard`; rejects wrong closing targets |
| E2E plumbing fixture — `e2e-fixture.yml` → `reusable-e2e.yml` | `workflow_dispatch` only | template-only (never required) | Linux | contents:read | none | context `e2e-fixture / e2e`; browsers `none` + trivial command |
| Contract verification (`reusable-contract.yml`) | `workflow_call` (consumed by `tracker-contract` callers) | contract required; metadata project-defined | Linux | contents:read | optional `TRACKER_TOKEN` (metadata; Projects + Metadata read) | contract fails merge; metadata advisory |
| Release | tag `v*`/dispatch | release gate; opt-in `contract-gate` before build | OS-specific | contents:write; contract gate contents:read only | environment/OIDC; no secret for the contract gate | block publish; enabled gate fails on required-caller/tooling/contract violations |
| Security | PR/schedule | Dependabot/dependency review default; CodeQL opt-in | Linux | security-events:write for CodeQL | none | advisory/required per project |

**Tag-only contract releases (this template repository):** the generic tag-triggered Release
workflow (`.github/workflows/release.yml`) is intentionally `disabled_manually` here — earlier
`v1.0.x` tag runs queued on the protected `release` environment. Contract releases such as
**v1.3.0** are therefore tag-only: the annotated tag, `CHANGELOG.md`, and the recorded `gate:release`
output are the release record (no GitHub Release/assets are published from this repo). Adopters own
their publishing profiles/callers and enable them deliberately for artifact releases.

### Trigger matrix
| Trigger | CI | Audit | Desktop | Release |
|---|---|---|---|---|
| push main | ✓ | advisory | — | — |
| pull_request | ✓ | advisory | path/label | — |
| tag `v*` | required | advisory | required | required |
| schedule | — | ✓ | optional | — |
| workflow_dispatch | optional | ✓ | optional | dry-run |

Audit-family details: the tracker audit also runs advisory on `pull_request`; the PR close guard
runs on PR `opened`/`edited`/`synchronize`/`reopened`/`labeled`/`unlabeled`; the post-merge audit
runs on `pull_request` **closed** (merged only) and can be re-run with `workflow_dispatch` +
`pr-number` to revalidate an earlier merge. The tracker-audit caller also supports
`workflow_dispatch`; those dispatches are the recovery path after a check-context/config change —
see [TROUBLESHOOTING](./TROUBLESHOOTING.md).

### Required-check contract
- Required: deterministic Linux lint/format/unit/e2e/verify jobs.
- Contract verification: `tracker-contract / contract` is required (offline, no secrets);
  `tracker-contract / metadata` is project-defined (needs `TRACKER_TOKEN`, skipped on PRs by the
  bundled caller).
- E2E: `e2e / e2e` is advisory by default — no required-check recommendation until an adopter opts
  in with recorded evidence. Counts: `counts-docs / counts` is required only when the counts
  contract is adopted (otherwise the caller is a no-op); `e2e-fixture / e2e` is template-only.
- Desktop smoke: path/label on PR; required on main/tags/release.
- PR close guard: `pr-close-guard / guard` is required for task PRs. The pre-v1.4.0
  `pr-close-guard` context no longer exists, so update branch protection/rulesets in the same
  upgrade PR that adopts the reusable caller.
- Audit family: `post-merge-audit / audit` is advisory (it opens an OI instead of a red check);
  `tracker-audit / audit` is advisory on PRs/schedule and may be promoted to release-gate strict
  mode only after the board is stable.
- Required callers (v1.4.0): the adoption contract's `requiredWorkflows` names six reusables
  (contract, post-merge audit, PR close guard, tracker audit, E2E, counts) that must be present and
  pinned; `verify-contract` enforces presence + exact pin. Presence is not a required check — use
  the contexts above for merge gating. See [ACTIONS CATALOG §7.14](./ACTIONS_CATALOG.md#714-required-adoption-contract-v140).
- Do not require expensive/advisory jobs until proven; document job names; update protection when names change.

## 14. Token and secret matrix

| Need | Source | Scope | Rules |
|---|---|---|---|
| Repo CI | `GITHUB_TOKEN` | contents:read | default; least privilege |
| Tracker audit (`reusable-audit.yml`) | PAT or GitHub App installation token | project read **+ repo/issues read on private repos** (PAT `project`+`repo` scopes; App Projects+Metadata+Issues read) | optional `TRACKER_TOKEN` repository secret; advisory mode skips cleanly when absent, strict mode fails with an actionable message; pass by explicit name (never `secrets: inherit`); never print; ≤90-day PAT |
| Contract metadata | PAT or GitHub App installation token | Projects + Metadata read | `TRACKER_TOKEN` repository secret; optional (only when the reusable-contract `metadata` job runs); pass by explicit name (never `secrets: inherit`); rotate; PAT ≤90 days |
| Post-merge audit (`reusable-post-merge-audit.yml`) | `GITHUB_TOKEN` | contents:read, issues:write, pull-requests:read, checks:read, statuses:read, actions:read | least privilege; the caller job must grant at least the same block; private repos need `checks:read`/`statuses:read`/`actions:read` for `statusCheckRollup` (GraphQL resolves `checkSuite.workflowRun`) |
| PR close guard (`reusable-pr-close-guard.yml`) | `GITHUB_TOKEN` | contents:read, issues:read, pull-requests:read | read-only: the guard fetches the live PR and referenced issues; no write scopes, no secrets |
| Release publish | `GITHUB_TOKEN`/environment secrets | contents:write | protected tag/environment |
| Package/cloud publish | OIDC or environment secrets | least privilege | prefer short-lived |
| Signing/notarization/container | project secrets/OIDC | minimal | skip cleanly if absent |

Never store tokens/cookies/private keys in repo, config, issue, comment, artifact, or log. No `pull_request_target` with untrusted code + secrets.

### Shared rate-limit state and cost report

Bootstrap/audit/task share a local budget/cost state at `TRACKER_RATE_STATE` (default `~/.cache/tracker-os/rate-limit.json`) so separate processes do not each rediscover the same exhausted budget. `npm run rate-limit` refreshes headers and prints the shared state plus top estimated command costs. The state stores only rate/cost metadata, never tokens or issue content.

Task context uses a targeted `issue.projectItems` lookup (and batched WIP item lookup) instead of full `project item-list`; audit dependencies are batched via `blockedBy` aliases. `setProjectItemFieldValues` aliases multiple field mutations into one GraphQL request.

### Qualified version bump

Use `npm run release:bump -- --from 1.4.0 --to 1.4.1` (dry-run) or add `--apply`.
It uses an explicit allowlist, excludes lockfiles/history/tests/submodules/binaries, reports exact
line diffs, and preserves dotted keys such as sprint `1.2.0.1`. Regenerate cards and run guards after applying.

### Release gate

`npm run gate:release -- --root <project> --repo owner/repo` verifies the adoption contract
(including the six required callers) and refuses release when any open
`tracker-contract-exception` OI exists. Downstream release workflows must run this gate before a
dispatch/tag publish, or opt into the reusable offline half with `contract-gate: true` +
`tracker-ref: <adopted tag>` on `reusable-release.yml` (no new permission/secret; build waits for
the gate). The open-OI half still needs the `--repo` procedure step because it requires
`issues: read`. In the contract's own repository the gate prints
`self-repo: downstream contract checks skipped` (see the adoption contract verifier above) and is
used for the v1.3.0/v1.4.0 release evidence.

### Post-merge bypass audit

`post-merge-audit.yml` is a thin self caller of `reusable-post-merge-audit.yml` (caller job
`post-merge-audit`, check context `post-merge-audit / audit`). It runs when a PR is merged, and on
`workflow_dispatch` with a `pr-number` input to revalidate a past merge — the audit script
(`scripts/adopt/cli/post-merge-audit.mjs`, via the repo transport with no raw `gh` in workflows)
re-fetches the PR and verifies it is `MERGED` before auditing, which is the recovery path after a
stale-config false OI. It checks required checks and closing-keyword/task-link rules.

Required check-run names resolve from `guard.requiredChecks[]` in `tracker.config.json` (absent =
backwards-compatible default `ci / ci-gate`, `docs-guard`, `pr-close-guard`). Adopting the v1.4.0
reusable callers changes the check contexts, so set the new names in the same PR — this repository
uses `["ci / ci-gate", "docs-guard", "pr-close-guard / guard"]`; adopters set their real names (e.g.
CastDeck: `ci / ci-gate`, `tracker-guard / guard`, `pr-close-guard / guard`). A stale list still
naming the removed `pr-close-guard` context makes the audit treat the missing required check as a
bypass and open a false OI — see [TROUBLESHOOTING](./TROUBLESHOOTING.md).

The caller job must grant at least `contents: read`, `issues: write` (opens the
`tracker-contract-exception` OI/label), `pull-requests: read`, `checks: read`, `statuses: read`, and
**`actions: read`**: `statusCheckRollup` also resolves `checkSuite.workflowRun`, which needs Actions
read (checks+statuses alone still degrade; observed on CastDeck run 43276236147). Historical note:
the permission correction shipped in v1.3.2; v1.3.0 copied callers predate it and must add
`actions: read`.

A merged PR with a failed/missing required check or invalid closure opens an OI labeled
`tracker-contract-exception` and must be resolved before release. Output semantics: the reusable
job's `ok` output means the job completed (a detected bypass still completes by opening the OI) —
`ok=true` does not mean the PR passed the audit; the OI is the durable record. If
`statusCheckRollup` is unreadable because of a permission/API error, the audit degrades loudly
(warning + job summary +
`actions: read` + `checks: read` + `statuses: read` guidance), retries a metadata-only PR fetch, evaluates the
closing-keyword/task-link rules only, and exits 0 in advisory mode — no false check-related OI.
Real closing violations still open an OI; non-permission errors still fail. Local parity:
`GH_TOKEN=... GITHUB_REPOSITORY=owner/repo PR_NUMBER=<merged-pr> npm run audit:post-merge --
--config tracker.config.json` (the script reads the repo/PR from the environment; it opens an OI on
a real bypass).

### PR closing-keyword guard

`pr-close-guard.yml` is a thin self caller of `reusable-pr-close-guard.yml` (caller job
`pr-close-guard`, check context `pr-close-guard / guard`). It enforces:

- a task PR completes via exactly a closing keyword (`Closes/Fixes/Resolves #N`) targeting a task issue;
- a task PR must not use the `partial` label; split the task or use a non-task branch instead;
- closing a sprint/release tracker issue is rejected.

The caller grants read-only permissions (`contents: read`, `issues: read`,
`pull-requests: read`) — the guard fetches the live PR and referenced issues and writes nothing, so
no `issues: write` is required. The pre-v1.4.0 `pr-close-guard` check context no longer exists;
branch protection/rulesets must require `pr-close-guard / guard` in the same upgrade PR. GitHub's
project linked-PR field follows closing keywords, so this guard keeps task completion and the
board's linked PRs consistent. Local parity:
`GITHUB_REPOSITORY=owner/repo PR_NUMBER=<pr> npm run guard:pr-close` (the script reads the live PR;
`PR_BODY`/`PR_BRANCH`/`PR_LABELS` env are optional overrides).

### Adoption contract verifier

`npm run verify:contract -- --root <downstream> --contract contract/adoption-contract.json`
checks the pinned template version, required config paths/profiles/docs, exact reusable workflow
refs, and OI-linked overrides (`tracker.overrides.json`). Missing/expired overrides or stale refs fail.
v1.4.0 adds six `requiredWorkflows` entries (contract, post-merge audit, PR close guard, tracker
audit, E2E, counts); each must be present and pinned to `@v<trackerVersion>` (the contract version,
which `release:bump` updates with `automation.templateVersion`). The checks are presence + pin only;
caller job names/triggers stay adopter-owned.

When the repo under inspection **is the contract's own repository**
(`config.repository === contract.repository`), the verifier prints an explicit
`self-repo: downstream contract checks skipped` result, skips the downstream-adopter checks
(required profile/docs/workflow pins) and still enforces `templateVersion`/`requiredConfig`
alignment. Downstream repositories keep the full check set; `release-gate` passes the self-repo
result through with the same note. This is what lets `release:bump` + `gate:release` (and
`stream.mjs close`'s default gate command) run inside the tracker repo for the v1.4.0 release.

### Repo-surface verifier

`npm run verify:surface` (`node scripts/internal/verify-surface.mjs --root . --manifest
contract/repo-surface.json`) keeps the shipped surface mechanically consistent with
`contract/repo-surface.json`, the class/status/docs/audience source of truth for scripts, workflows,
actions, profiles, docs, and contract files. Entries carry a class (`adopter-cli`, `adopter-lib`,
`reusable-workflow`, `reusable-action`, `copy-mode`, `internal`, `generated`) and a status
(`shipped` or `contract-only`). It fails on:

- a missing manifest when `--require-manifest` is set (CI runs it with that flag);
- manifest ↔ filesystem drift: a `shipped` entry whose file is absent, a `contract-only` entry that
  exists, or a path inside the classified scope that is unclassified or classified twice;
- a `reusable-*` workflow that is not a `workflow_call` contract, or a non-`reusable-*` workflow that
  uses `workflow_call`; `.github/workflows/` keeps only internal runners + `reusable-*`, with
  `release.yml` as the only runnable release caller;
- a copy-mode entry outside `profiles/` or a YAML example without its `COPY-MODE EXAMPLE` header;
- catalog claims that disagree with the manifest (reusable-workflow/action documentation and
  `docs/ACTIONS_CATALOG.md` shipped vs contract-only claims);
- manifest-referenced docs anchors that do not resolve, or a generated entry outside
  `generatedRoots`/without an existing `generatedBy` script.

Warnings (unclassified docs, npm-alias drift, adopter code importing internal code, stale catalog
section docs) fail only under `--strict`. CI runs it in the `docs-guard` job:
`node scripts/internal/verify-surface.mjs --root . --manifest contract/repo-surface.json --require-manifest`.
T02 generates `docs/SURFACE.md` from the manifest — treat that page as generated, not hand-edited.

### No-admin merge wrapper

Use `npm run merge-pr -- --pr N --repo owner/repo --delete-branch` (or `node scripts/adopt/cli/merge-pr.mjs`).
It refuses `--admin`, refuses drafts/non-mergeable PRs, and requires `ci / ci-gate` + `docs-guard`
to be SUCCESS. Repo branch protection also has `enforce_admins=true`; the wrapper is defense in depth,
not a substitute for branch protection.

### Docs coverage guard

`npm run guard:docs -- --base origin/main` fails when a changed source area mapped in `docs/DOCS_COVERAGE.json` has no mapped docs change. `docs-guard` CI includes it; branch protection requires the check. See [DOCS COVERAGE](./DOCS_COVERAGE.md).

### Rate-limit behavior

`scripts/adopt/lib/github.mjs` is the transport for tracker automation. It:
- reads `x-ratelimit-*` / `retry-after` where available and tracks remaining/reset;
- preflights mutations against a budget floor;
- serializes mutations with ≥1s spacing;
- fails with reset guidance instead of blindly retrying primary/secondary limits.

Check the budget:
```bash
npm run rate-limit
# GitHub graphql budget: N/5000 remaining, M used; resets <ISO>
```

Per-process caches hold project/field/item/milestone/label lists; they are invalidated after relevant writes and are never persisted across runs. Audit activity (comments/sub-issues) is batched in chunks to avoid per-issue calls.

GraphQL is 5,000 points/hour per user; REST is 5,000 requests/hour. **GitHub Pro does not raise either.** Secondary limits include 2,000 GraphQL points/minute, 900 REST points/minute per endpoint, and content-generation limits. The `/rate_limit` endpoint can misreport the burst position; prefer response headers.

## 15. Runner / cost guidance

| Runner | Cost | Use |
|---|---|---|
| Linux | baseline | lint/unit/e2e/audit |
| macOS | ~10× | desktop smoke/release only |
| Windows/self-hosted | variable | only when required; document |

- Path/label gate expensive jobs.
- Concurrency cancellation; cache deps; short artifact retention.
- Local parity command for every workflow (`npm run lint`, `npm test`, etc.); see config `profiles.node.commands`.

## 16. Release profiles

| Profile | Artifacts | Default gating |
|---|---|---|
| generic GitHub Release | files/archives + sha256 | dry-run; publish on tag/dispatch |
| macOS signed/notarized | dmg/zip + signatures | skip signing when secrets absent; ad-hoc documented |
| container/GHCR | image digest | build/push guarded by auth/dry-run |
| package registry | npm/PyPI package | OIDC/provenance guarded |

Projects adopt only needed profiles; see [RELEASE_PROFILES](./RELEASE_PROFILES.md) for the implemented reusable workflow/callers and guards. All profiles are implemented in the template; not every adopting project validates every profile.

## 17. Shell notes

**macOS/Linux**
```bash
PROJECT_NUMBER=1
gh project item-list "$PROJECT_NUMBER" --owner @me --format json | jq .
```

**Windows PowerShell**
```powershell
$PROJECT_NUMBER = 1
gh project item-list $PROJECT_NUMBER --owner @me --format json
# pipe to ConvertFrom-Json instead of jq if jq is absent
```

**Windows Git Bash/WSL:** macOS/Linux snippets work. Avoid backtick line continuations in PowerShell; use backticks only in PowerShell.

## 18. Environment variables

| Variable | Use |
|---|---|
| `GH_TOKEN` / `GITHUB_TOKEN` | auth in CI; never commit |
| `TRACKER_TOKEN` | optional tracker-audit (`reusable-audit.yml`) token: project read + repo/issues read on private repos; advisory skips cleanly when unset, strict requires it; also the contract metadata job (`reusable-contract.yml`) secret name |
| `NO_COLOR` | plain output |
| `GH_REPO` | default repo for some `gh` commands (optional) |

## 19. Expected outputs and diagrams

Canonical expected outputs:

```
$ node scripts/adopt/cli/validate-config.mjs tracker.config.json
OK   tracker.config.json

$ gh auth status
✓ Logged in to github.com account <you>
- Token scopes: 'repo', 'project', ...

$ gh pr merge 45 --squash --delete-branch
✓ Merged pull request #45
```

Board text snapshot:

```
Status      Release  Sprint   Title
In Progress v1.0.0   1.0.0.2  [Task] Implement audit
Blocked     v1.0.0   1.0.0.2  [Task] Token setup
Done        v1.0.0   1.0.0.1  [Task] Add playbook
```

Sanitized diagrams are Mermaid in [HOW_TO_USE](./HOW_TO_USE.md) (hierarchy/status) and are reproducible from source. No real-user screenshots/secrets are committed. When real screenshots are added, redact org/user/token data.

## 20. Versioning

- Docs version: `v1.4.0-docs.1` for this target; update with each template release.
- Template/config: exact `vX.Y.Z`; patch/minor/major meanings in [UPGRADING](./UPGRADING.md).
- Reference is normative for commands; handbook is task-oriented; playbook is conceptual; T12 validates the docs set before release.


### Preflight and dependency approval

`task.mjs start` rejects a dirty worktree unless `--allow-dirty --dirty-reason "..."` is supplied. `npm run guard:deps` requires dependency/lockfile changes to be listed in `tracker.dependencies.json` with an issue, reason, and expiry; script-only `package.json` edits are allowed.


### Manual release checksum gate

`npm run verify:checksums -- --dir <artifact-dir>` verifies `SHA256SUMS` before a manual draft release; asset/checksum mismatch fails closed.


## 21. Local-first verification and batching

`npm run gate:local` (`node scripts/internal/gate-local.mjs`) is the one-command local checkpoint:
it runs the ordered stack below, fails fast at the first failing step by default (`--continue` keeps
going), captures per-step output tails, and prints `GATE_LOCAL_OK n/n` on success or
`GATE_LOCAL_FAIL n/n` plus the failing steps' tails. It is offline: no network or live-GitHub steps
(`gate:release` runs without `--repo`, and the contract/tooling verifiers take the self-repo path).

| # | Step | Command | Notes |
|---|---|---|---|
| 1 | unit tests | `npm test` | |
| 2 | lint | `npm run lint` | |
| 3 | format | `npm run format:check` | |
| 4 | docs links/anchors | `npm run docs:check` | |
| 5 | version consistency | `npm run guard:versions` | |
| 6 | config validation | `npm run validate:config` | |
| 7 | tooling verification | `npm run verify:tooling` | self-repo safe |
| 8 | adoption contract | `npm run verify:contract` | self-repo safe |
| 9 | release gate | `npm run gate:release` | no `--repo`; bypass check skipped |
| 10 | GitHub transport guard | `npm run guard:gh` | |
| 11 | dependency guard | `npm run guard:deps` | skipped with notice when `origin/main` is unavailable |
| 12 | repo-surface guard | `npm run verify:surface -- --root . --require-manifest` | |
| 13 | repo surface check | `npm run surface:check` | skipped with notice when the alias is not defined |
| 14 | tracked-file hygiene | `npm run guard:hygiene` | fails on tracked symlinks or tracked paths matched by `.gitignore` (the T05 `node_modules`-symlink class) |
| 15 | debt guard | `npm run guard:debt` | skipped with notice when the alias is not defined |
| 16 | docs coverage | `node scripts/adopt/docs/guard-docs.mjs --base ${GATE_LOCAL_BASE:-origin/main}` | skipped with notice when the base ref is unresolved |
| 17 | counts guard | `npm run guard:docs:counts` | no-op expected when `docs.counts` is absent |

Options/env:

- `--json` prints the machine-readable result (`ok`, `counts`, `results[]` with status/duration/
  exit code/tails); `--list` prints the ordered step table (`--list --json` for JSON).
- `GATE_LOCAL_BASE` sets the docs-coverage base (default `origin/main`); `GATE_LOCAL_TIMEOUT_MS`
  sets the per-step timeout (default 10 minutes).
- A skipped step is never a pass: `GATE_LOCAL_OK` reports attempted passes only and lists the skip
  count; resolve prerequisites or record the skips in the check-out rather than assuming green.

Policy:

- **Batch:** run one `gate:local` per reviewable checkpoint, not per file and not only at PR time.
- **Evidence:** attach the `GATE_LOCAL_OK n/n` line (or JSON result) at check-out using the
  template's `Local iterations: N · Full local suites: N · Remote runs: <urls/none>` line.
- **Remote-only caveat:** local runs are not remote evidence. CI/release runs happen at PR head/
  final evidence, and suites declared under `verification.remoteOnly[]` still require their remote
  visible run (§5.6); hidden local runs stay non-authoritative.
- **Session resume:** hand-off/checkpoint fields and the resume checklist are in
  [AGENT GUIDE](./AGENT_GUIDE.md#session-resume) (`### Session resume` under Review/check-out).
- `gate:local` duplicates the `docs-guard` CI job as a subset (parity enforced by
  `tests/gate-local.test.mjs`), so remote CI remains the independent check.

## Lint/format self-check (T18)

Tracker OS now self-applies ESLint and Prettier: `npm ci`, `npm run lint`, and
`npm run format:check`. A missing or broken lint/format command fails CI rather than succeeding
as a no-op. Dev tooling is approved in `tracker.dependencies.json`; see issue #82.

### Project metadata verifier

`npm run verify:metadata -- --repo owner/repo --project <number>` checks native issue types,
required/optional/forbidden project fields, options, release → sprint → task hierarchy, unique
keys, and type mapping. Default is open/current strict; `--include-closed` audits history;
`--warn-only` reports without failing during migration. Canonical title format is `[Release] <version> — ...`, `[Sprint] <key> — ...`, and `[<sprint>-T<nn>] ...`. Legacy formats fail verification and require T20 migration or an approved exception.

**Standard fields:** required Status/Release/Sprint/Area/Kind/Estimate/Source; optional
Priority (P0–P3 when present); forbidden fields are project-specific only.


### Metadata reconciliation

`npm run reconcile:metadata -- --repo owner/repo --repair=none` is report-only. `--repair=open-only`, `--repair=selected --issues N,N`, or `--repair=all-safe` mutate only selected scope; `--include-closed` extends the report/selection. Legacy `[vX] Release` and `[key] Sprint` titles are renamed to canonical `[Release]` / `[Sprint]`; implementation tasks normalize to native Feature.

Inline repair examples: `--repair=open-only`, `--repair=selected --issues 3,4`, `--repair=all-safe`.

Metadata reconciliation uses `updateIssueTitle` and `setIssueType` transport methods; each mutation is explicit and dry-run/report-first by default.

### Metadata exceptions

`contract/exceptions/metadata-exceptions.json` records historical anomalies with repo, issue numbers, reason, upstream issue, and expiry. `verify:metadata --exceptions <file>` excludes only those recorded issues; exceptions are visible in the contract and cannot hide open/current drift. CastDeck #61–#68 are closed duplicate tracker-authoring artifacts; #69–#76 parent links were backfilled to their real sprints.

### Branch hygiene and hooks

Run `npm run hooks:install` to set `core.hooksPath=.githooks`. The hooks block commits on main/master,
block direct pushes to main/master, and warn on checkout to main. `main-history-guard` opens a
`tracker-contract-exception` OI when a main commit has no merged PR. Explicit env overrides are
warned and must be recorded; they do not bypass remote protection.


### Proposal lifecycle

`scripts/adopt/cli/proposal.mjs` manages intake that is not yet delivery work. It validates the
`[Proposal]` title/body contract, imports proposals onto the board with `Status = Proposed`, and
supports `accept` (in-place conversion to a task), `defer`, and `reject`. See
[PROPOSALS.md](./PROPOSALS.md) and the task conversion path in [TASK_CLI.md](./TASK_CLI.md).

### Closed-task PR-link audit

`audit` parses the `- **PR:**` line from a closed task's check-out comment, fetches the PR, and
requires it to be merged and to close the task. It accepts GitHub's `closingIssuesReferences` or an
explicit `Closes/Fixes/Resolves #N` in the PR body. Historical task PRs reviewed before this guard
may be listed in `guard.taskPrLinkExceptions` with an issue number and reason; exceptions are
auditable and should not be added for current work.

The `merge-pr.mjs` wrapper verifies required checks before merging. If GitHub's GraphQL secondary
limit rejects `gh pr merge`, it falls back to the REST merge endpoint and deletes the branch through
the same TrackerOS transport, so a rate-limited GraphQL path does not force an ad-hoc raw merge.

### TrackerOS MCP facade

`scripts/adopt/mcp/server.mjs` exposes narrow proposal/context/task-status/audit tools over stdio.
It exposes proposal accept/defer/reject in addition to intake/read tools, and does not expose generic GitHub or project-item mutation tools. See [MCP.md](./MCP.md).
