# ADOPTION — zero to first task

**Docs version:** v1.0.0-docs.1 · Target template: v1.0.0
This guide onboards a **new project** onto the tracker. The CastDeck pilot is only an example; do not copy its product-specific plan.

> **Automation note:** bootstrap/audit/task CLI are available now. This manual path explains the steps; the same config drives `bootstrap.mjs`, and the CLIs automate the lifecycle.

## 0. Choose the adoption shape

| Shape | Use when | Board |
|---|---|---|
| Single project, one repo | one product/service | one project board |
| Program with releases | multiple releases/features over time | one board, release/sprint hierarchy |
| Downstream of this template | another project adopting this tracker | its own board + upstream feedback link |
| Multi-project umbrella | several projects need one overview | optional umbrella board later; keep per-project boards authoritative |

Default: **one board per project**, repo linked. Do not create an umbrella until per-project boards are healthy.

## 1. Preconditions

- GitHub repo(s) with permission to enable Issues/Projects/Actions.
- `gh` authenticated with `project` scope:
  ```bash
  gh auth status
  # Token scopes: 'repo', 'project', ...
  ```
- A release name (e.g. `v0.1.0`) and first sprint key (e.g. `0.1.0.1`).
- Decision on issue types (native or documented fallback).
- A project-scoped token plan for audit (PAT or GitHub App; least privilege).
- Docs/security owner named.

## 2. Create and configure

### 2.1 Repo/project
```bash
gh repo create OWNER/REPO --private --add-readme --clone
cd REPO
gh project create --owner @me --title "Project Tracker"
# https://github.com/users/OWNER/projects/1
gh project link PROJECT_NUMBER --owner @me --repo OWNER/REPO
```

Enable Issues, Projects, Actions. Create `main` protection later (§5).

### 2.2 Milestone/release
```bash
gh api repos/OWNER/REPO/milestones -f title="v0.1.0" -f description="First release"
# {"number":1,"title":"v0.1.0",...}
```

### 2.3 Fields
Create Status (`Todo`, `In Progress`, `In Review`, `Blocked`, `Done`), Release, Sprint, Area, Kind (`feature`, `fix`, `ux`, `spike`, `test`, `infra`), Estimate (`S`,`M`,`L`), Source (`Internal`, Downstream). Avoid reserved field name `Type`; use `Kind`.

### 2.4 Views/workflows
Create In flight, Current sprint, Roadmap, Blocked, Release readiness, Recently done, Downstream. Enable auto-add and close→Done; do not auto-start work.

### 2.5 Types/fallback
Enable native Task/Bug/Feature. If unavailable, document the fallback (Kind) in your adoption notes; do not add type labels.

### 2.6 Labels
Create only `risk:low|medium|high`, `plan-change`, `source:downstream`, `status:needs-triage`. No dimension labels.

## 3. Install template/config

Copy from the tracker template:
- `.github/ISSUE_TEMPLATE/*`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `docs/comment-templates/*` (or link the upstream docs)
- `tracker.config.example.json` → `tracker.config.json`
- `.github/workflows/*` caller workflows (CI/security/audit are shipped; release profile callers are shipped; contract-only workflows are labeled)

Edit config for your repo/project/releases/sprints/commands. Validate:
```bash
node scripts/github/validate-config.mjs tracker.config.json
# OK   tracker.config.json
```

Pin the template version exactly and record the feedback channel:
```json
"automation": { "templateRepo": "presljf/github-project-tracker", "templateVersion": "1.0.0" },
"feedback": { "upstreamRepo": "presljf/github-project-tracker", "issueForm": "downstream-bug.yml", "pinnedVersion": "1.0.0" }
```

## 4. Create the plan skeleton

1. Program roadmap issue (or a `docs/ROADMAP.md` plus roadmap issue) — decisions, releases, operating model.
2. Release tracker per milestone — objective, sprints, gates, artifacts, rollback.
3. Sprint tracker(s) — goal, task list, exit criteria.
4. Task issues — DoR/acceptance/test/evidence; link sub-issues.
5. Set Project fields on every item; add to board (auto-add should do it).

Pilot example (clearly marked): `examples/castdeck.config.json` shows a real project config; do not copy its release content.

## 5. Audit, CI, protection

- Configure the tracker audit token as a secret (project-scoped).
- Add CI/audit caller workflows when delivered (1.0.0.2+); keep audit **advisory** first.
- Configure branch protection/rulesets:
  - required: deterministic Linux CI checks.
  - advisory first: desktop smoke/audit.
  - protect release tags/environments.
- Run manual audit checklist from [HOW TO USE](./HOW_TO_USE.md#13-audit) until `audit.mjs` exists.
- Record accepted exceptions.

## 6. Adoption gate (for programs)

If this project is blocked by an upstream release (e.g., tracker v1.0.0), use an explicit gate:

- Create gate issue: objective, upstream dependency, adoption steps, close criteria.
- Create adoption child tasks (pin/config, project ops/audit, tracker automation, validation).
- Native blocked-by: gate ← upstream release; adoption tasks ← upstream release; program release trackers ← gate.
- Set program-level Status `Blocked` on the roadmap/release trackers, not every task.
- Close the gate only after operational adoption; product implementation starts **after** gate close.
- CI/release template adoption can remain inside the first implementation release to avoid circular dependencies.

**Pilot pattern:** CastDeck gate #77 → tracker release v1.0.0; adoption #78–#81; quality implementation after gate. Do not copy project-specific content, only the pattern.

## 7. First task (prove the loop)

Do one small docs/config task end-to-end:

- [ ] Check-in comment + status In Progress + branch.
- [ ] PR with `Closes #`.
- [ ] In Review + evidence.
- [ ] Merge, Done, check-out comment.
- [ ] Parent sprint progress updates.
- [ ] Audit/WIP check.

Do not start feature work until the first task proves the loop.

## 8. Adoption checklist

- [ ] Repo/project linked; fields/statuses/views/workflows configured.
- [ ] Types or documented fallback; labels minimal.
- [ ] Milestones/releases + hierarchy created.
- [ ] Issue/PR templates + comment templates installed/linked.
- [ ] Config validated and pinned exactly.
- [ ] Audit token scoped/stored; audit advisory; manual checklist run.
- [ ] Branch protection/required checks documented; expensive jobs advisory.
- [ ] First task completed through the full lifecycle.
- [ ] Docs pinned/versioned; downstream feedback channel linked.
- [ ] Program-level gate closed (if applicable); upgrade policy understood.

## 9. After adoption

- Operate per [HOW TO USE](./HOW_TO_USE.md); audit periodically.
- Report bugs/features upstream using [DOWNSTREAM_FEEDBACK](./DOWNSTREAM_FEEDBACK.md).
- Upgrade only through [UPGRADING](./UPGRADING.md); pin exact versions.
- Record local overrides; never fork silently.

**Estimate:** small project first task 1–2h; full adoption 3–6h (excluding project-specific plan/content).
