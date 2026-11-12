# GitHub Project Tracker Playbook

**Docs version:** v1.0.2-docs.1 · **Status:** Project Tracker OS v1.0.0 playbook  
**Audience:** maintainers, contributors, and agents operating a GitHub-based project tracker  
**Scope:** portable, project-agnostic operating procedure. Project-specific commands/artifacts belong in the adopting project's config and docs.

> This playbook is the conceptual/operating model. The exhaustive step-by-step user guide is the separate **HOW TO USE** suite (`docs/HOW_TO_USE.md`, `docs/REFERENCE.md`, `docs/TROUBLESHOOTING.md`, quick starts, reference cards). If a step needs copy-paste detail, the HOW TO USE suite is the authority; this playbook explains the rules and the why.

Related artifacts:

| Artifact | Purpose | Status |
|---|---|---|
| `docs/HOW_TO_USE.md`, `docs/QUICKSTART.md`, `docs/REFERENCE.md`, `docs/TROUBLESHOOTING.md`, `docs/ADOPTION.md`, `docs/UPGRADING.md`, `docs/AGENT_GUIDE.md`, `docs/MULTI_PROJECT.md` | exhaustive task-oriented usage docs/reference/adoption/upgrade/agent/multi-project | existing |
| `docs/DOCS_STYLE_GUIDE.md`, `docs/reference-cards/` | doc standards and seven printable one-page cards | existing (T13) |
| `docs/ACTIONS_CATALOG.md` | Actions catalog + token/runner matrices | existing (T09/T15/T10) |
| `tracker.config.example.json`, `schemas/tracker.config.schema.json`, `scripts/github/validate-config.mjs` | config contract/validation/examples | existing (T02) |
| `tracker.config.json` | adopting project's own pinned config | created per project at adoption |
| `scripts/github/bootstrap.mjs` | idempotent setup from config | existing (T03) |
| `scripts/github/audit.mjs` | invariant audit | existing (T04) |
| `scripts/github/task.mjs` | check-in/update/review/block/done CLI | existing (T05) |
| `.github/ISSUE_TEMPLATE/*`, `PULL_REQUEST_TEMPLATE.md` | issue/PR intake | existing |
| `docs/comment-templates/` | copy-paste lifecycle comments | existing (T02) |
| `profiles/node/` | generic Node lint/format profile (ESLint/Prettier/editorconfig/ignore) | existing (T14) |
| `docs/DOWNSTREAM_FEEDBACK.md`, `SUPPORT.md` | downstream reporting/triage/versioning/support | existing (T16) |
| `.github/ISSUE_TEMPLATE/downstream-{bug,feature}.yml` | downstream feedback forms | existing (T16) |
| `presljf/github-project-tracker` | reusable template repository | existing (private) |

---

## Contents

- [1. Principles](#1-principles)
- [2. Prerequisites and capability matrix](#2-prerequisites-and-capability-matrix)
- [3. Repository and project setup checklist](#3-repository-and-project-setup-checklist)
- [4. Data model and single-source rules](#4-data-model-and-single-source-rules)
- [5. Statuses, ownership, WIP](#5-statuses-ownership-wip)
- [6. Definition of Ready / Definition of Done](#6-definition-of-ready-definition-of-done)
- [7. Lifecycles](#7-lifecycles)
- [8. Change protocol](#8-change-protocol)
- [9. Audit invariants](#9-audit-invariants)
- [10. Actions and CI-CD contract](#10-actions-and-ci-cd-contract)
- [11. Documentation and gates](#11-documentation-and-gates)
- [12. Downstream projects, versioning, support, security](#12-downstream-projects-versioning-support-security)
- [13. Minimum viable tracker vs full automation](#13-minimum-viable-tracker-vs-full-automation)
- [14. Porting checklist for a new project](#14-porting-checklist-for-a-new-project)
- [15. Copy-paste templates](#15-copy-paste-templates)
- [16. Glossary](#16-glossary)
- [References and companion docs](#references-and-companion-docs)

## 1. Principles

1. **GitHub is the plan of record.** Issues, sprints, releases, and the project board are authoritative. Chat transcripts are context, not state.
2. **One task, one branch, one PR.** Each task issue maps to one branch and one pull request (`Closes #issue`). Small, independently verifiable units.
3. **Work is checked in and checked out.** No silent WIP. Every task has an explicit owner, status, and evidence of completion.
4. **Statuses are explicit and few.** `Todo → In Progress → In Review → Blocked → Done`; blockers and plan changes are visible.
5. **WIP = 1 per owner.** Finish or explicitly block/defer before starting another In Progress task.
6. **Single source per dimension.** Release = milestone; Sprint/Area/Kind/Estimate/Source = project fields; type = native issue type; hierarchy = sub-issues. Do not duplicate dimensions as labels.
7. **Everything is auditable.** Acceptance criteria, tests, evidence, and deviations live on the issue/PR.
8. **No gates by vibes.** Required checks, audit invariants, and release gates are explicit and reproducible.
9. **Portable over clever.** The procedure must work for a private personal repo and an org repo, with documented fallbacks.
10. **No secrets in the repo.** Tokens live in secrets/Keychain/GitHub App; never in config, comments, logs, or artifacts.

---

## 2. Prerequisites and capability matrix

| Capability | Requirement | Fallback |
|---|---|---|
| GitHub repo with Issues | required | none |
| Projects v2 | strongly recommended; requires `project` OAuth scope (`gh auth refresh -s project`) | milestone/issue-only tracker; no board automation |
| Native issue types (Task/Bug/Feature) | preferred | classify via native labels if issue types unavailable; document the fallback |
| Sub-issues | strongly recommended | parent/child link in issue bodies + labels; document missing native nesting |
| Actions | recommended | local commands + documented manual gates |
| Private reusable workflows | may be restricted | copy thin caller workflows/composite actions; or make template public |
| Branch protection/rulesets | recommended | manual review checklist; document exceptions |
| Project-scoped token for audit | required for CI audit | PAT or GitHub App installation token; advisory first |

### Personal vs organization repos

- **Personal repo:** Projects v2 is user-owned; the OAuth token needs `project` scope. Private reusable workflows/composite actions may not be callable across repos; validate access and use copy fallback or publish the template.
- **Organization repo:** Projects v2 may be org-owned; issue types may be org-defined; reusable workflows can be shared under org/enterprise policy; rulesets/branch protection may be centrally managed.
- **Never assume** field names, option IDs, app installation, or reusable-workflow access. Discover them through the API/config; fail with actionable errors.

---

## 3. Repository and project setup checklist

Do this once per adopting repository.

### 3.1 Repo features
- [ ] Issues enabled; Discussions optional/decided.
- [ ] Projects enabled.
- [ ] Actions enabled; decide who can approve workflows.
- [ ] Default branch `main`; branch protection/ruleset enabled when public/Pro (private personal repo returns 403).
- [ ] Templates/issue forms installed (from tracker template or copied).
- [ ] Security policy placeholder (`SECURITY.md`) with private reporting channel.
- [ ] License decided (MIT recommended at/public transition).

### 3.2 Issue types
- [ ] Enable/confirm native types: **Task**, **Bug**, **Feature**.
- [ ] If native types are unavailable, document a label fallback and exclude it from the single-source rule (it replaces issue type).
- [ ] Do not create per-project labels for type when native issue types exist.

### 3.3 Milestones = releases
- [ ] One milestone per released version (e.g. `v1.0.0`) and, if needed, pre-release/adoption milestones that are explicitly non-versioned.
- [ ] Release tracker issue per milestone; parent link to program roadmap.
- [ ] Release tracker body: objective, sprint scope, gates, risks/rollback, artifacts/versioning, decisions/changes.
- [ ] Do not use milestones as sprints; sprints are issues/fields.

### 3.4 Project fields and statuses
Create a single project per program (or a clearly linked umbrella, if chosen).

- **Status** (single select): `Todo`, `In Progress`, `In Review`, `Blocked`, `Done`.
- **Release** (single select): release versions and explicit pre-release options if used.
- **Sprint** (single select): sprint keys.
- **Area** (single select): stable code/skill areas.
- **Kind** (single select): `feature`, `fix`, `ux`, `spike`, `test`, `infra`.
- **Estimate** (single select): `S`, `M`, `L` (or numeric hours; pick one and document).
- **Source** (single select): `Internal`, `<pilot project>`, `Other` — used for downstream feedback and origin.

Views:
- **In flight:** Status is In Progress, In Review, or Blocked.
- **Current sprint:** Sprint = current sprint, hide Done.
- **Roadmap:** grouped by Release; ordered by Sprint.
- **Blocked:** Status Blocked; show blocked-by relationships.
- **Release readiness:** grouped by Release with progress/estimate.
- **Recently done:** Done, sorted by closed date.
- **Downstream:** Source is a downstream project or label `source:downstream`.

Workflows:
- Auto-add repo issues to the project.
- Issue closed → Status Done.
- Do **not** auto-set In Progress/In Review on events initially; those transitions are explicit check-in/out actions.

### 3.5 Labels (minimal)
Only process/risk labels, never dimensions already represented by fields/types:

- `risk:low`, `risk:medium`, `risk:high`
- `plan-change`
- `source:downstream`, `status:needs-triage` (downstream intake; Status field remains authoritative for work state)
- Optional transitional `status:blocked` only if the project cannot use the Status field; remove after adoption.

### 3.6 Hierarchy
```
Program roadmap
└── Release tracker (milestone)
    └── Sprint tracker
        └── Task issue
```
Plus:
- Gate/adoption issues may parent pre-release work.
- Gate issues and adoption tasks are blocked by external releases via native "blocked by" links where supported.
- Do not close a parent with open children unless deferral is explicitly recorded.

### 3.7 Branch protection / required checks
- Require PR review/checks for `main` (solo maintainers may use admin bypass only for documented emergencies).
- Required checks: deterministic Linux CI jobs.
- Advisory initially: expensive desktop/macOS jobs, tracker audit (until stable).
- Protect release tags/environments.
- Document exact job names; do not rename required jobs without updating protection.

### 3.8 Release/tag conventions
- Tags: annotated `vX.Y.Z`.
- Release workflow: validate tag == package version(s), run gates, build artifacts, sha256, publish GitHub Release.
- Dry-run first; publishing is explicit.
- Unsigned/notarization/signing policies are project-specific and documented.

---

## 4. Data model and single-source rules

| Dimension | Canonical location | Do not duplicate as |
|---|---|---|
| Release | Milestone | release label |
| Sprint | Project `Sprint` field | sprint label |
| Area | Project `Area` field | area label |
| Kind | Project `Kind` field | kind label |
| Estimate | Project `Estimate` field | estimate label |
| Coarse type | Native issue type | `type:*` label |
| Hierarchy | Native sub-issues | only textual links/checklists |
| Work state | Project `Status` field | status label |
| Origin | Project `Source` field + `source:downstream` intake label | per-project label explosion |
| Risk | `risk:*` label | project field (currently) |
| Process | `plan-change`, `status:needs-triage`, security reporting docs | free-form only |

Rules:
- A dimension may have a fallback when the canonical surface is unavailable; document the fallback as authoritative for that project.
- If labels and fields disagree, **fields/types/milestones win**; fix the label/comment and note it in the issue.
- Never reintroduce duplicate labels for convenience.

---

## 5. Statuses, ownership, WIP

### Status definitions
| Status | Meaning | Required next evidence |
|---|---|---|
| Todo | ready/eligible, not started | DoR passes |
| In Progress | actively worked | assignee + check-in comment + branch |
| In Review | implementation ready; PR/verification underway | PR/evidence + review checklist |
| Blocked | cannot proceed | blocker reason + dependency link/comment |
| Done | acceptance met, evidence attached, issue closed | check-out comment + green gates |

### Ownership
- Every check-in assigns **one owner** (human or bot identity).
- The check-in comment records `Owner:` and `Executor:` (human/agent identity).
- WIP = 1 In Progress task per owner. A second In Progress task is a violation unless explicitly documented with plan-change and a timebox.
- If the owner cannot continue, post a checkpoint and either hand off (new owner) or set Blocked.

### Blockers
- Use native "blocked by" issue relationships where available; otherwise link the blocking issue/PR in a comment.
- Status Blocked requires a concrete reason and the unblock condition.
- Do not mark a parent Done while a blocker is unresolved.

---

## 6. Definition of Ready / Definition of Done

### Definition of Ready (task)
- [ ] Problem/context, current behavior, goal, non-goals.
- [ ] Acceptance criteria testable; test plan and evidence requirements named.
- [ ] Dependencies/blockers known and linked.
- [ ] Estimate and release/sprint fields set.
- [ ] Native type and area/kind fields set; Source set if downstream.
- [ ] No unresolved blocker; owner can start.

### Definition of Done (task)
- [ ] Acceptance criteria checked.
- [ ] Required tests/gates pass; evidence attached.
- [ ] Docs/config updated; no secrets/live third-party calls.
- [ ] PR merged or issue closed with rationale; `Closes` linkage.
- [ ] Project Status Done; check-out comment posted.
- [ ] Deviations/follow-ups recorded; parent sprint/release updated if relevant.

### Definition of Done (sprint)
- [ ] All child tasks Done or explicitly deferred with plan-change.
- [ ] Exit criteria/demo evidence posted.
- [ ] Parent release tracker updated.
- [ ] Sprint status Done and issue closed.

### Definition of Done (release)
- [ ] Every release gate checked.
- [ ] Artifacts built/checksummed/published; tag matches versions.
- [ ] Release notes/docs/acceptance evidence updated.
- [ ] Release tracker + milestone closed; final summary posted.
- [ ] No open child sprints unless explicitly deferred.

---

## 7. Lifecycles

### 7.1 Task check-in

Entry: DoR passes and sprint is active.

Steps:
1. Assign owner.
2. Set Project Status **In Progress**.
3. Post check-in comment (template §15.1).
4. Create branch `task/<issue>-<slug>` from the release/integration branch.
5. Open a draft PR referencing the issue (`Refs #<issue>`; use `Closes` only when it is the completing PR).
6. Keep WIP = 1.

Abort/rollback: if the task cannot start, set Blocked or return to Todo with a comment; do not leave an orphan branch with no issue link.

### 7.2 During work

- Commit with a reference to the issue (e.g. `task(#123): ...`).
- Post update comments at meaningful boundaries (§15.2): done/next/blockers/scope changes/evidence.
- Set Status **In Review** only when implementation is ready for PR review/verification; attach PR/evidence.
- If blocked: Status **Blocked**, dependency link, reason, unblock condition.
- If scope changes: `plan-change` label + dated comment + sprint/release tracker/project updates (see §8).
- If session ends without completion: post a checkpoint (current state, next step, branch/PR). No silent WIP.

### 7.3 Task check-out

1. Ensure acceptance criteria checked and gates green.
2. Attach evidence (test output, screenshots, API samples, artifact checksums).
3. Merge the PR with `Closes #<issue>` (or close manually with a reason if no code).
4. Set Status **Done**; confirm issue is closed.
5. Post check-out comment (§15.3) with evidence, deviations, follow-ups.
6. Update parent sprint/release tracker if this task affects exit/gates.

### 7.4 Sprint lifecycle

**Kickoff**
- Confirm all tasks pass DoR; dependencies linked.
- Set sprint tracker Status In Progress; announce goal/tasks/risks.
- Verify parent release tracker links/scope.

**During**
- Tasks move through statuses; sprint progress comes from sub-issues, not duplicate checklists.
- Update sprint tracker only for meaningful changes/blockers/deferrals.

**Close-out**
- Every child Done or deferred with plan-change.
- Post sprint demo/exit comment (§15.4) with evidence.
- Close sprint issue; Status Done.
- Update parent release tracker.

### 7.5 Release/milestone lifecycle

**Kickoff**
- Release tracker Status In Progress; scope/sprints/gates/risks confirmed.
- Confirm required checks and release profile/token setup.

**During**
- Update release tracker at each sprint close: completed scope, risks, decisions, estimates.
- Do not duplicate sprint-level status into the release tracker beyond summaries.

**Close-out**
- All activation gates checked.
- Tag from green main; build/publish artifacts; verify checksums.
- Close release tracker + milestone; post final summary.
- Update program roadmap/decision log.

---

## 8. Change protocol

Any scope, acceptance, estimate, gate, or policy change requires:

1. A dated **plan-change** comment on the affected task/sprint/release, with old → new and rationale.
2. Add/retain the `plan-change` label until reviewed.
3. Update the sprint tracker and release tracker "Decisions & changes".
4. Update Project fields (estimate/status/sprint/release) and the Project board.
5. If future sprint assumptions change, update those sprint bodies immediately.
6. If scope is added mid-sprint, explicitly defer/remove equivalent scope or create a follow-up issue; no silent expansion.
7. Never rewrite history; supersede with dated comments/links.

**Template:** §15.5.

---

## 9. Audit invariants

Run the tracker audit regularly (`node scripts/github/audit.mjs --config tracker.config.json --advisory`; `--strict` for release gates).

Invariants:
- Every open issue has a native type (or documented fallback) and a milestone when it belongs to a release.
- Project items have required fields: Release/Sprint for release work, Area/Kind/Estimate always, Source for downstream.
- No parent issue is Done while it has open children unless a deferral is recorded.
- No task In Progress without assignee + check-in comment.
- WIP ≤ 1 In Progress task per owner (or documented exception).
- Blocked items have a reason + dependency link/comment.
- No duplicate/retired labels or dimensions.
- Sprint/release trackers have exit evidence when Done.
- Template version (`automation.templateVersion`) is recorded; stale versions flagged.
- Downstream issues have origin/version/context; `Source` set during triage.
- No secrets in issues/comments/artifacts.

Enforcement:
- **Advisory** audit in CI initially (job summary/artifact).
- **Required at release gates** once stable.
- Audit must never make live third-party calls or expose secrets.
- Tokens: project-scoped PAT or GitHub App installation token; least privilege; never in config.

---

## 10. Actions and CI-CD contract

### 10.1 Workflow catalog

| Workflow | Trigger | Required? | Runner | Purpose | Permissions | Secrets/token | Artifacts | Failure mode |
|---|---|---|---|---|---|---|---|---|
| CI (lint/format/unit) | push/PR | required | Linux | fast correctness gates | contents: read | none | logs/traces on failure | block merge |
| E2E/integration | push/PR/nightly | required or advisory per project | Linux/macOS | end-to-end validation | contents: read | none | traces/screenshots | block required job |
| Desktop/app smoke | main/tags + path/label PRs | advisory on PR, required for release | macOS | native shell smoke | contents: read | none | traces/logs | required on release |
| Tracker audit | schedule/dispatch + advisory PR | advisory first; release gate later | Linux | tracker invariants | contents: read; project read/write via scoped token | `TRACKER_TOKEN`/GitHub App | job summary/JSON artifact | advisory or release failure |
| Release | tag `v*` + dispatch | release gate | macOS/OS-specific | build/checksum/publish | contents: write; environment as needed | publish secrets/OIDC as needed | dmg/zip/container/package + sha256 | block publish |
| Security | PR/schedule | default Dependabot/dependency review; CodeQL opt-in | Linux | dependency/security checks | security-events: write for CodeQL | none | reports/SARIF | advisory/required per project |

### 10.2 Trigger matrix
- `push` main: CI, advisory audit.
- `pull_request`: CI; desktop smoke if path/label; audit advisory.
- tags `v*`: CI gates + release workflow; required desktop/release jobs.
- `schedule`: audit/security as configured.
- `workflow_dispatch`: dry-run release, audit rerun, manual verification.

### 10.3 Token/secret matrix
| Need | Source | Scope | Notes |
|---|---|---|---|
| Repo CI | `GITHUB_TOKEN` | contents: read | default; least privilege |
| Tracker audit | project-scoped PAT or GitHub App installation token | project read/write (or read for advisory) | store as secret; never print |
| Release publish | `GITHUB_TOKEN` / environment secrets | contents: write | protect tag/environment |
| Package/cloud publish | OIDC/short-lived or environment secrets | least privilege | no long-lived secrets if avoidable |
| Signing/notarization/container | project-specific secrets/OIDC | minimal | skip cleanly when absent; document |

### 10.4 Runner/cost matrix
- Linux default; macOS ~10× minutes; Windows/self-hosted profiles optional.
- Path/label-gate expensive jobs.
- Use concurrency cancellation and caching (npm/Playwright/build).
- Store artifacts with short retention; don't upload secrets.

### 10.5 Security rules
- Pin third-party actions by commit SHA.
- Minimal `permissions` per workflow; avoid `pull_request_target` with untrusted code/secrets.
- Protected tags/environments for publishing.
- Dry-run defaults for manual release dispatch.
- No live third-party calls in CI.
- Audit/security findings may contain sensitive data; store as job summaries/artifacts, not public comments.

### 10.6 Local parity
Every workflow must have a documented local equivalent (`npm test`, `npm run lint`, etc.) so projects can verify without Actions. `docs/ACTIONS_CATALOG.md` records these.

### 10.7 Hybrid D reuse model
- Tracker owns reusable workflow/composite-action contracts and templates.
- Adopting projects keep **thin caller workflows** plus project-specific config/commands; publish/build/sign steps stay project-local.
- Pin `automation.templateVersion`; validate private cross-repo access.
- If private reusable workflows are blocked, copy thin callers/composite actions or make the template public.
- No automated template-sync PRs initially; projects follow the upgrade guide and pin exact versions.

### 10.8 Release profiles
All profiles are implemented as examples/dry-run-gated in the template:
- generic GitHub Release (files/artifacts/checksums);
- macOS signed/notarized app (skip when secrets absent; ad-hoc fallback);
- container/GHCR (build/push guarded);
- package registry (npm/PyPI, provenance/OIDC guarded).

Projects adopt only the profiles they need; do not validate unused profiles in their release scope.

---

## 11. Documentation and gates

- **HOW TO USE suite** is the task-oriented authority; this playbook is the model.
- **Documentation style guide** (`docs/DOCS_STYLE_GUIDE.md`) governs voice/structure, commands with expected output, screenshots, terminology, and maintenance.
- **Printable one-page reference cards** cover task lifecycle, statuses/WIP, commands, tokens, troubleshooting/audit, sprint/release, and reporting upstream.
- **Fresh-eyes validation:** a fresh uninvolved agent session attempts setup/lifecycle using only docs, fixes gaps, then a human performs final review. Both rounds are recorded before a template release.
- Documentation changes to behavior ship in the same PR; stale commands/screenshots are defects.
- CastDeck/pilot examples are clearly marked; generic docs contain no project-specific dependencies.

---

## 12. Downstream projects, versioning, support, security

### 12.1 Downstream feedback
Projects that adopt the template are **downstream**. They must:
- report bugs/features **upstream** via the tracker repository issue forms;
- include origin project, pinned `automation.templateVersion`, environment, reproduction, expected/actual, impact, workaround, and links;
- not fork silently; temporary local workarounds must be documented with an upstream issue link.

Tracker triage:
- label `source:downstream`, Status `Todo`/In Progress; set `Source` field;
- native type Bug/Feature; Area/Kind/Estimate; decide accept/defer/needs-info with rationale;
- link upstream→downstream issue; schedule in a tracker sprint when accepted;
- best-effort, **no SLA**; `status:needs-triage` until triaged.

Downstream PRs: small, well-scoped fixes/features are welcome with issue/PR templates and CI; discuss larger changes upstream first.

### 12.2 Versioning and upgrades
- **Patch** (`v1.0.x`): compatible fixes.
- **Minor** (`v1.1.0`): compatible features.
- **Major** (`v2.0.0`): breaking changes, documented migration.
- Downstream pins an **exact** version; upgrades are explicit with changelog + upgrade guide.
- No forks; local overrides must be documented and portable.
- Template changes that affect adopters require release notes + migration notes.

### 12.3 Publication
- Template repo stays private through its own v1.0.0 validation.
- Make public at/after v1.0.0 if private reusable-workflow access is blocked or docs/template validation is complete.
- Enable **MIT license** at the public transition (or earlier if approved).
- Repo should be marked as a template repository; README explains “Use this template” and downstream reporting.
- Private vulnerability reporting is enabled where available; for private personal repos use a private maintainer channel in `SECURITY.md`. Never request vulnerability details in public forms.

### 12.4 Support
Best-effort/no SLA. Triage labels and Source field make ownership visible. Security reports go through the private channel.

---

## 13. Minimum viable tracker vs full automation

### Minimum viable tracker (manual, no Actions/scripts)
- Repo with Issues + Project, types/fields/statuses/views.
- Milestones=releases; roadmap/release/sprint/task hierarchy.
- Manual check-in/out comments + status updates.
- Branch/PR/Closes conventions.
- Manual audit checklist.
- This is acceptable for initial adoption; document missing automation and schedule it.

### Full automation (template v1.0.0)
- Config-driven bootstrap/audit/task CLI.
- Reusable workflows/composite actions + thin callers.
- Automated required checks; advisory audit; release automation.
- Downstream feedback forms/Source/triage.
- Docs/style guide/cards/fresh-eyes validation.
- Add automation incrementally; each step must preserve the manual fallback.

---

## 14. Porting checklist for a new project

1. Create/clone repo; enable Issues/Projects/Actions; default branch main.
2. Authenticate `gh`; ensure `project` scope; decide PAT/GitHub App for audit.
3. Create native issue types if needed; document fallback.
4. Create Project; fields/statuses/views/workflows; link repo.
5. Create milestones/release trackers from the program plan.
6. Create program roadmap → releases → sprints → tasks; wire sub-issues.
7. Set minimal labels + Source field; remove duplicates.
8. Install issue/PR templates and the tracker audit caller (copy or reusable).
9. Configure branch protection/required checks; keep expensive jobs advisory initially.
10. Create `tracker.config.json`; pin `automation.templateVersion`; record feedback channel.
11. Write/link project-specific docs; link the HOW TO USE suite and cards.
12. Run the audit; fix drift; record accepted exceptions.
13. Dry-run the process on a small task: check-in → update → review → done.
14. Close adoption gate; document the starting version and upgrade path.
15. Schedule periodic audits; update pin only through documented upgrades.

---

## 15. Copy-paste templates

### 15.1 Task check-in
```markdown
### Check-in

- **Owner:** <name/bot>
- **Executor:** human:<name> | agent:<run/session>
- **Branch:** `task/<issue>-<slug>`
- **Starting HEAD:** `<sha>`
- **Scope confirmed:** <one or two sentences; confirm the issue acceptance criteria>
- **DoR:** acceptance/test plan/dependencies/estimate fields are ready
- **Evidence planned:** <tests/screenshots/artifacts>
- **Risks/blockers:** <none or describe>

Status → In Progress.
```

### 15.2 During-work update
```markdown
### Update

- **Done:** <what is now true>
- **Next:** <next concrete step>
- **Blockers:** <none or reason + dependency link>
- **Scope change:** <none or `plan-change` link/summary>
- **Evidence:** <links/commands/results>
```

### 15.3 Task check-out
```markdown
### Check-out

- **Acceptance criteria:** all checked
- **Commits/PR:** <links>
- **Tests/gates:** <commands + results>
- **Evidence:** <screenshots/logs/artifact checksums>
- **Deviations:** <none or explain>
- **Follow-ups:** <links/none>
- **Parent sprint/release updated:** yes/no

Status → Done; issue closed.
```

### 15.4 Sprint close
```markdown
### Sprint demo / exit

- **Goal:** <sprint goal>
- **Outcome:** <completed scope>
- **Tasks:** all Done unless deferred (list deferrals + plan-change links)
- **Evidence:** <demo/test/artifact links>
- **Carried over:** <issues/none>
- **Risks/retro:** <learnings>
- **Parent release tracker updated:** yes

Status → Done; sprint closed.
```

### 15.5 Blocker note
```markdown
### Blocker

- **Reason:** <concrete blocker>
- **Blocked by:** <issue/PR/decision link>
- **Impact:** <scope/time/risk>
- **Unblock condition:** <what must happen>
- **Owner action:** waiting on <owner>

Status → Blocked.
```

### 15.6 Plan change
```markdown
### Plan change — YYYY-MM-DD

- **Old:** <scope/estimate/gate>
- **New:** <scope/estimate/gate>
- **Why:** <reason>
- **Affected:** <task/sprint/release links>
- **Estimate impact:** <old → new>
- **Tracker updates:** sprint/release/project fields updated: yes/no
- **Follow-ups:** <links/none>

Label: `plan-change`.
```

### 15.7 Release close
```markdown
### Release close — vX.Y.Z

- **Gates:** all checked (attach evidence links)
- **Tag/version:** tag == package/desktop versions
- **Artifacts:** <dmg/zip/image/package + sha256>
- **Docs:** release notes + acceptance/status updated
- **Known issues:** <none or list>
- **Rollback:** <how>
- **Milestone/release tracker closed:** yes

Status → Done; milestone closed.
```

### 15.8 Downstream bug/feature report (upstream issue)
```markdown
### Downstream report

- **Originating project:** <name/repo>
- **Pinned tracker version:** <vX.Y.Z>
- **Environment:** <OS/runtime/tool versions>
- **Type:** bug | feature
- **Description:** <what happens / requested>
- **Reproduction:** <steps>
- **Expected:** <...>
- **Actual:** <...>
- **Impact:** <who/how severe>
- **Workaround:** <none or link>
- **Downstream issue/PR:** <link>

Source = <project>; label `source:downstream`; no secrets/vulnerability details.
```

---

## 16. Glossary

- **Program:** a long-lived stream (e.g. product, platform) with its own repo/roadmap/versioning.
- **Release:** a versioned milestone with a release tracker and artifacts.
- **Sprint:** a scoped build unit inside a release; issue-backed, not a calendar box.
- **Task:** a single verifiable unit with acceptance criteria.
- **DoR/DoD:** Definition of Ready/Done.
- **Check-in/check-out:** explicit start/finish record with owner/evidence.
- **WIP:** work in progress; one In Progress task per owner.
- **Plan of record:** GitHub milestones/issues/project fields; chat is context.
- **Downstream:** a project that adopted the template and reports feedback upstream.
- **Tracker template version:** exact pinned `vX.Y.Z` recorded in the adopting project's config.

---

## References and companion docs

- `docs/HOW_TO_USE.md` — step-by-step operating guide
- `docs/REFERENCE.md` — commands/config/API/field reference
- `docs/TROUBLESHOOTING.md` — failure modes and fixes
- `docs/ADOPTION.md` — new-project walkthrough
- `docs/UPGRADING.md` — version pinning/upgrades
- `docs/DOWNSTREAM_FEEDBACK.md` — reporting/triage/versioning policy
- `docs/DOCS_STYLE_GUIDE.md` + `docs/reference-cards/` — documentation standards and printable cards
- `docs/ACTIONS_CATALOG.md` — workflow catalog and token/runner matrices
- `tracker.config.example.json` — config schema/examples
- `scripts/github/bootstrap.mjs`, `audit.mjs`, `task.mjs` — automation
