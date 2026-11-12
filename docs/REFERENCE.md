# REFERENCE

**Docs version:** v1.0.1-docs.1 · Target template: v1.0.1
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
| `scripts/github/audit.mjs` | tracker audit (advisory/strict/JSON) | now |
| `scripts/github/task.mjs` | start/checkpoint/review/block/done/status | now |
| `profiles/node/` | generic lint/format profile | now |
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
node scripts/github/task.mjs checkpoint --issue 123 (--message TEXT | --message-file FILE)
node scripts/github/task.mjs review --issue 123 [--pr URL] [--evidence TEXT]
node scripts/github/task.mjs block --issue 123 --reason TEXT [--blocked-by URL]
node scripts/github/task.mjs done --issue 123 (--evidence TEXT | --evidence-file FILE) [--pr URL] [--force]
node scripts/github/task.mjs status --issue 123
```
Enforces DoR/WIP on start and evidence/acceptance on done; `--dry-run` makes no mutations. Full behavior: [TASK CLI](./TASK_CLI.md).

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
| `repository` | yes | `owner/repo` |
| `project` | yes | `owner`, `title`, `number` (required by audit/task CLI) |
| `statuses` | yes | 5+ unique, standard set recommended |
| `fields` | yes | Release/Sprint/Area/Kind/Estimate required; Source recommended |
| `issueTypes` | no | task/bug/feature + fallback notes |
| `labels` | no | risk/process only; no dimension labels |
| `releases` | yes | key, milestone, sprints (key/title/estimate/tasks) |
| `automation` | no | defaultAssignee, branchPrefix, tagPattern, templateRepo/version, inReviewMode, autoAddIssues, closeToDone, bot |
| `profiles.node.commands` | no | lint/format/test/e2e/verify/build mappings |
| `workflows` | no | ci mode/ref/requiredChecks/commands; audit mode (secret name fixed `TRACKER_TOKEN`); release profile/ref/dryRun |
| `feedback` | no | upstreamRepo/issueForm/pinnedVersion/securityContact |
| `governance` | no | versioning, publication status/license, security contact/private reporting |

Validation behaviors: required/missing keys, type mismatches, disallowed extra keys, duplicate options/release/sprint keys, missing standard statuses, secret-looking values, templateRepo without version. Exit 1 with `$path: message`.

## 7. Fields, statuses, transitions

### Fields
| Field | Values | Applies to |
|---|---|---|
| Status | Todo/In Progress/In Review/Blocked/Done | all work items |
| Release | version keys (+ pre-release if documented) | release work |
| Sprint | sprint keys | release work |
| Area | stable areas | all |
| Kind | feature/fix/ux/spike/test/infra | all |
| Estimate | S/M/L or numeric | all |
| Source | Internal/downstream/Other | all; downstream required during triage |

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

Run `audit.mjs` advisory first; `--strict` for release gates. Invariants:

1. Open release work has milestone + native type.
2. Project fields complete (Release/Sprint for release work; Area/Kind/Estimate; Source downstream).
3. No Done parent with open children unless deferral.
4. No In Progress without assignee + check-in.
5. WIP ≤ 1 In Progress per owner (or documented exception).
6. Blocked has reason + dependency.
7. No duplicate dimension labels (retired-label cleanup is manual).
8. Sprint/release Done has exit evidence.
9. Pinned `automation.templateVersion`; downstream context complete.
10. No secrets in config/artifacts — **manual review; the audit does not scan issue bodies/comments for secrets**.
11. Open tasks contain required issue-template/DoR sections.
12. Open tasks have both a release tracker and sprint tracker ancestor.

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
| Release publish | `GITHUB_TOKEN`/environment secrets | contents:write | protected tag/environment |
| Package/cloud publish | OIDC or environment secrets | least privilege | prefer short-lived |
| Signing/notarization/container | project secrets/OIDC | minimal | skip cleanly if absent |

Never store tokens/cookies/private keys in repo, config, issue, comment, artifact, or log. No `pull_request_target` with untrusted code + secrets.

### Shared rate-limit state and cost report

Bootstrap/audit/task share a local budget/cost state at `TRACKER_RATE_STATE` (default `~/.cache/tracker-os/rate-limit.json`) so separate processes do not each rediscover the same exhausted budget. `npm run rate-limit` refreshes headers and prints the shared state plus top estimated command costs. The state stores only rate/cost metadata, never tokens or issue content.

Task context uses a targeted `issue.projectItems` lookup (and batched WIP item lookup) instead of full `project item-list`; audit dependencies are batched via `blockedBy` aliases. `setProjectItemFieldValues` aliases multiple field mutations into one GraphQL request.

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

- Docs version: `v1.0.1-docs.1` for this target; update with each template release.
- Template/config: exact `vX.Y.Z`; patch/minor/major meanings in [UPGRADING](./UPGRADING.md).
- Reference is normative for commands; handbook is task-oriented; playbook is conceptual; T12 validates the docs set before release.
