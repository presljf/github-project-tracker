# REFERENCE

**Docs version:** v1.3.0-docs.1 · Target template: v1.3.0
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
| `scripts/github/validate-config.mjs` | config validation | now |
| `scripts/github/bootstrap.mjs` | idempotent repo/project setup | now |
| `scripts/github/audit.mjs` | tracker audit (advisory/strict/JSON), mode-aware | now |
| `scripts/github/task.mjs` | start/checkpoint/review/block/done/status | now |
| `scripts/github/stream.mjs` | tooling-profile `[Stream]` open/close lifecycle | now |
| `scripts/github/project-field-option.mjs` | safe single-select option append (preserves ids/item values) | now |
| `scripts/github/guard-local-suite.mjs` | remote-only suite guard (enforce/report, offline) | now |
| `scripts/github/playwright-remote-guard.mjs` | dependency-free Playwright `globalSetup` factory for the remote-only policy | now |
| `scripts/github/lib/work-profile.mjs` | product/tooling enforcement adapters (shared engine) | now |
| `scripts/github/lib/verification-policy.mjs` | remote-only policy resolution/evaluation (shared, offline) | now |
| `scripts/github/suite-counts.mjs` | counted-runner parsers/compare + counts `check\|record\|render` CLI | now |
| `scripts/github/guard-docs-counts.mjs` | counts baseline/agreement + generated-doc/marker guard | now |
| `schemas/test-counts.baseline.schema.json` | counts baseline JSON schema | now |
| `profiles/node/` | generic lint/format profile | now |
| `profiles/desktop/` | desktop smoke caller + remote-only local guard | now |
| `profiles/tooling/` | tooling work-profile selection + example config | now |
| `profiles/counts/` | counts contract wiring + example baseline | now |
| `.github/ISSUE_TEMPLATE/` | task/sprint/release/spike + downstream forms | now |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR checklist | now |
| `.github/workflows/`, `.github/actions/` | reusable CI/release/security/audit workflows + composite actions | now |
| `profiles/release/` | release profile examples/copy callers | now |

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
node scripts/github/bootstrap.mjs --config tracker.config.json --dry-run
node scripts/github/bootstrap.mjs --config tracker.config.json --apply
node scripts/github/bootstrap.mjs --config tracker.config.json --json
```
Default dry-run. Creates/updates project, fields/statuses/options, milestones, labels, roadmap/release/sprint/task skeletons, native types, project items/fields, sub-issues. Never deletes user data; resource matching is by **exact generated title**, so mismatched existing titles create new resources — reuse generated titles or update the config before re-running. Manual checklist for UI-only views/workflows at end.

In the **tooling work profile** (`workProfile: "tooling"`) bootstrap ensures project fields (including `fields.Stream`), status options, labels and milestones only: the product release → sprint → task skeleton is not created, because deliveries are `[Stream]` containers created with `stream.mjs open`.

### 5.2 audit

```bash
node scripts/github/audit.mjs --config tracker.config.json --advisory
node scripts/github/audit.mjs --config tracker.config.json --strict
node scripts/github/audit.mjs --config tracker.config.json --json
```
Advisory default: prints violations, exit 0. `--strict` exits 1 on violations for release gates. Workflow: `.github/workflows/tracker-audit.yml` (scheduled/dispatch), skips safely without `TRACKER_TOKEN`.

### 5.3 task

```bash
node scripts/github/task.mjs start --issue 123 [--owner LOGIN] [--executor TEXT] [--branch NAME] [--dry-run]
node scripts/github/task.mjs start --issue 123 --stream STREAM_ISSUE   # tooling profile only
node scripts/github/task.mjs checkpoint --issue 123 (--message TEXT | --message-file FILE)
node scripts/github/task.mjs review --issue 123 [--pr URL] [--evidence TEXT]
node scripts/github/task.mjs block --issue 123 --reason TEXT [--blocked-by URL]
node scripts/github/task.mjs done --issue 123 (--evidence TEXT | --evidence-file FILE) [--pr URL] [--force]
node scripts/github/task.mjs status --issue 123
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

### 5.4 stream (tooling profile)

```bash
node scripts/github/stream.mjs open --name v1.3.1 --delivery "Documentation & maintenance" [--dry-run]
node scripts/github/stream.mjs close --stream STREAM_ISSUE (--evidence TEXT | --evidence-file FILE) [--tag vX.Y.Z] [--dry-run]
```
`open` creates `[Stream] <name> — <delivery>`, safely appends the per-delivery `Stream` option,
adds the container to the project with Status/Stream/Area/Kind/Estimate, and posts
`### Stream opened`. `close` refuses while child tasks are open, requires the release gate green
(`gate:release`; override with `--gate-command`), validates `--tag` against
`automation.tagPattern`, posts `### Stream close evidence`, sets Status Done, and closes the
container. Tag creation stays with the release flow. Product configs are rejected.

### 5.5 project-field-option

```bash
node scripts/github/project-field-option.mjs --config tracker.config.json --field Stream --option v1.3.2 \
  [--color BLUE] [--description TEXT] [--dry-run] [--json]
```
Reads the current options first, preserves every existing id/colour/description (so item values
that reference those ids are unchanged), appends only a new name, and is idempotent on re-run.
Used by `stream.mjs open` and handy when creating per-delivery options by hand. Accepts both the `ProjectV2SingleSelectField` type reported by `gh project field-list` and the `SINGLE_SELECT` shape used by the test fakes; non-single-select fields are rejected.

### 5.6 guard-local-suite (remote-only verification policy)

```bash
node scripts/github/guard-local-suite.mjs --suite desktop-smoke [--mode enforce|report] [--hidden] [--json]
node scripts/github/guard-local-suite.mjs --root . --config tracker.config.json --suite <id> --mode enforce
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
node scripts/github/suite-counts.mjs check --suite unit --mode full --results test-results/unit.tap

# record new counts + skip identities into the baseline and regenerate docs/markers
node scripts/github/suite-counts.mjs record --suite unit --mode full --results test-results/unit.tap

# regenerate canonical doc + inline markers from the baseline (--check fails when stale)
node scripts/github/suite-counts.mjs render [--check]

# docs guard: baseline schema/agreement + generated doc + marker freshness (no test execution)
node scripts/github/guard-docs-counts.mjs [--root DIR] [--config FILE] [--json]
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
`docs.counts.markers` files are checked). Full adoption wiring:
[profiles/counts](../profiles/counts/README.md).

## 6. Config reference

Validate:
```bash
node scripts/github/validate-config.mjs tracker.config.json
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
| `guard` | no | `transportOnly`, `allow[]`, `requiredChecks[]` (post-merge audit check-run names; absent = default `ci / ci-gate`, `docs-guard`, `pr-close-guard`) |
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

**Tracker OS itself** flips to `tooling` from v1.3.0 onward via a post-tag config PR: the v1.3.0 tag
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

Enforcement: advisory CI first; required at release gates once stable. Audit token project-scoped; never in config.

## 13. Workflow catalog

**Availability:** CI, release, tracker audit, security, and desktop smoke are shipped. Web/E2E, docs, and reusable audit are **contract-only** (not yet implemented).

| Workflow | Trigger | Required | Runner | Permissions | Secrets/token | Failure |
|---|---|---|---|---|---|---|
| CI (lint/format/unit) | push/PR | required | Linux | contents:read | none | block merge |
| Web/E2E | push/PR/nightly | required/advisory | Linux | contents:read | none | required on main/release |
| Desktop smoke | main/tags/path/label PR | advisory PR; required release | macOS | contents:read | none | release gate |
| Tracker audit | schedule/dispatch/advisory PR | advisory first; release gate later | Linux | contents:read + project token | `TRACKER_TOKEN`/App | advisory/release fail |
| Release | tag `v*`/dispatch | release gate | OS-specific | contents:write | environment/OIDC | block publish |
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

### Required-check contract
- Required: deterministic Linux lint/format/unit/e2e/verify jobs.
- Desktop smoke: path/label on PR; required on main/tags/release.
- Audit: advisory initially; required only after stable release-gate policy.
- Do not require expensive/advisory jobs until proven; document job names; update protection when names change.

## 14. Token and secret matrix

| Need | Source | Scope | Rules |
|---|---|---|---|
| Repo CI | `GITHUB_TOKEN` | contents:read | default; least privilege |
| Tracker audit | PAT or GitHub App installation token | project read/write (or read advisory) | store as secret; never print; project-scoped |
| Post-merge audit | `GITHUB_TOKEN` | contents:read, issues:write, pull-requests:read, checks:read, statuses:read, actions:read | least privilege; the copied caller must carry the same block; private repos need `checks:read`/`statuses:read`/`actions:read` for `statusCheckRollup` (GraphQL resolves `checkSuite.workflowRun`) |
| Release publish | `GITHUB_TOKEN`/environment secrets | contents:write | protected tag/environment |
| Package/cloud publish | OIDC or environment secrets | least privilege | prefer short-lived |
| Signing/notarization/container | project secrets/OIDC | minimal | skip cleanly if absent |

Never store tokens/cookies/private keys in repo, config, issue, comment, artifact, or log. No `pull_request_target` with untrusted code + secrets.

### Shared rate-limit state and cost report

Bootstrap/audit/task share a local budget/cost state at `TRACKER_RATE_STATE` (default `~/.cache/tracker-os/rate-limit.json`) so separate processes do not each rediscover the same exhausted budget. `npm run rate-limit` refreshes headers and prints the shared state plus top estimated command costs. The state stores only rate/cost metadata, never tokens or issue content.

Task context uses a targeted `issue.projectItems` lookup (and batched WIP item lookup) instead of full `project item-list`; audit dependencies are batched via `blockedBy` aliases. `setProjectItemFieldValues` aliases multiple field mutations into one GraphQL request.

### Qualified version bump

Use `npm run release:bump -- --from 1.3.0 --to 1.3.0` (dry-run) or add `--apply`.
It uses an explicit allowlist, excludes lockfiles/history/tests/submodules/binaries, reports exact
line diffs, and preserves dotted keys such as sprint `1.2.0.1`. Regenerate cards and run guards after applying.

### Release gate

`npm run gate:release -- --root <project> --repo owner/repo` verifies the adoption contract and
refuses release when any open `tracker-contract-exception` OI exists. Downstream release workflows
must run this gate before a dispatch/tag publish. In the contract's own repository the gate prints
`self-repo: downstream contract checks skipped` (see the adoption contract verifier above) and is
used for the v1.3.0 release evidence.

### Post-merge bypass audit

`.github/workflows/post-merge-audit.yml` runs when a PR is merged. It checks required checks and
closing-keyword/partial-PR rules. Required check-run names resolve from
`guard.requiredChecks[]` in `tracker.config.json` (default when absent:
`ci / ci-gate`, `docs-guard`, `pr-close-guard` — adopters must set their real names, e.g. CastDeck:
`ci / ci-gate`, `tracker-guard / guard`, `pr-close-guard`). The workflow token needs
`contents: read`, `issues: write`, `pull-requests: read`, and (on private repos)
`checks: read` + `statuses: read` + **`actions: read`** to read `statusCheckRollup` — its GraphQL
query also resolves `checkSuite.workflowRun`, which needs Actions read (checks+statuses alone still
degrade; observed on CastDeck run 43276236147). The copied caller must carry the same permissions
block. The v1.3.0 tag predates this correction; it ships post-tag in the tooling stream
(`[Stream] v1.3.1-maintenance`), and adopters add `actions: read` to their copied caller.

A merged PR with a failed/missing required check or invalid closure opens an OI labeled
`tracker-contract-exception` and must be resolved before release. If `statusCheckRollup` is
unreadable because of a permission/API error, the audit degrades loudly (warning + job summary +
`actions: read` + `checks: read` + `statuses: read` guidance), retries a metadata-only PR fetch, evaluates the
closing-keyword/partial-PR rules only, and exits 0 in advisory mode — no false check-related OI.
Real closing violations still open an OI; non-permission errors still fail.

### PR closing-keyword guard

`.github/workflows/pr-close-guard.yml` enforces:

- a task PR completes via exactly a closing keyword (`Closes/Fixes/Resolves #N`) targeting a task issue;
- a PR labeled `partial` must use `Refs #N` / `Part of #N` and must not close the task;
- closing a sprint/release tracker issue is rejected.

GitHub's project linked-PR field follows closing keywords, so this guard keeps task completion and
the board's linked PRs consistent.

### Adoption contract verifier

`npm run verify:contract -- --root <downstream> --contract contract/adoption-contract.json`
checks the pinned template version, required config paths/profiles/docs, exact reusable workflow
refs, and OI-linked overrides (`tracker.overrides.json`). Missing/expired overrides or stale refs fail.

When the repo under inspection **is the contract's own repository**
(`config.repository === contract.repository`), the verifier prints an explicit
`self-repo: downstream contract checks skipped` result, skips the downstream-adopter checks
(required profile/docs/workflow pins) and still enforces `templateVersion`/`requiredConfig`
alignment. Downstream repositories keep the full check set; `release-gate` passes the self-repo
result through with the same note. This is what lets `release:bump` + `gate:release` (and
`stream.mjs close`'s default gate command) run inside the tracker repo (T06 prerequisite).

### No-admin merge wrapper

Use `npm run merge-pr -- --pr N --repo owner/repo --delete-branch` (or `node scripts/github/merge-pr.mjs`).
It refuses `--admin`, refuses drafts/non-mergeable PRs, and requires `ci / ci-gate` + `docs-guard`
to be SUCCESS. Repo branch protection also has `enforce_admins=true`; the wrapper is defense in depth,
not a substitute for branch protection.

### Docs coverage guard

`npm run guard:docs -- --base origin/main` fails when a changed source area mapped in `docs/DOCS_COVERAGE.json` has no mapped docs change. `docs-guard` CI includes it; branch protection requires the check. See [DOCS COVERAGE](./DOCS_COVERAGE.md).

### Rate-limit behavior

`scripts/github/lib/github.mjs` is the transport for tracker automation. It:
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
| `TRACKER_TOKEN` | advisory tracker-audit workflow secret name |
| `NO_COLOR` | plain output |
| `GH_REPO` | default repo for some `gh` commands (optional) |

## 19. Expected outputs and diagrams

Canonical expected outputs:

```
$ node scripts/github/validate-config.mjs tracker.config.json
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

- Docs version: `v1.3.0-docs.1` for this target; update with each template release.
- Template/config: exact `vX.Y.Z`; patch/minor/major meanings in [UPGRADING](./UPGRADING.md).
- Reference is normative for commands; handbook is task-oriented; playbook is conceptual; T12 validates the docs set before release.


### Preflight and dependency approval

`task.mjs start` rejects a dirty worktree unless `--allow-dirty --dirty-reason "..."` is supplied. `npm run guard:deps` requires dependency/lockfile changes to be listed in `tracker.dependencies.json` with an issue, reason, and expiry; script-only `package.json` edits are allowed.


### Manual release checksum gate

`npm run verify:checksums -- --dir <artifact-dir>` verifies `SHA256SUMS` before a manual draft release; asset/checksum mismatch fails closed.


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

