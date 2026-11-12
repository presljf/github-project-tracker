# ADOPTION — zero to first task

**Docs version:** v1.3.2-docs.1 · Target template: v1.3.2
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

### 0.1 Choose the work profile

`tracker.config.json` selects the enforced lifecycle. The choice is per repo and optional:

| `workProfile` | Lifecycle | Use when |
|---|---|---|
| `product` (default; absent) | `[Release]` → `[Sprint]` → tasks with Release/Sprint fields | versioned product work planned as releases/sprints |
| `tooling` | `[Stream]` → tasks with a `Stream` field; tag (if any) is the version record | tooling/pipeline work that has no versioned release until the tag is cut |

`tooling` is not a weaker path: DoR, WIP = 1, assignee/check-in, PR + evidence on `done`, and the
stream close gate are enforced by the same engine. See
[profiles/tooling](../profiles/tooling/README.md) for the config shape and lifecycle commands.
Existing `product` configs are unchanged; a declared `Stream` field in product mode is ignored.

This template repository itself runs the `tooling` profile from v1.3.0 onward as the live pilot
(flip lands post-tag; the tag is the v1.3.0 historical version record). New adopters default to `product` and
opt in per repo when tooling-style deliveries fit.

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

For the tooling profile, declare `Stream` instead of Release/Sprint: `"fields": { "Stream": { "options": ["v1.3.1"] } }`.
`bootstrap.mjs` creates it from config; `stream.mjs open` / `project-field-option.mjs --field Stream --option <delivery>`
append new per-delivery options safely (existing option ids, colours, and item values are preserved). `releases` may
be `[]` in tooling configs because the tag is the version record.

### 2.4 Views/workflows
Create In flight, Current sprint, Roadmap, Blocked, Release readiness, Recently done, Downstream. Enable auto-add and close→Done; do not auto-start work.

### 2.5 Types/fallback
Enable native Task/Bug/Feature. If unavailable, document the fallback (Kind) in your adoption notes; do not add type labels.

### 2.6 Labels
Create only `risk:low|medium|high`, `plan-change`, `source:downstream`, `status:needs-triage`. No dimension labels.

### 2.7 Remote-only verification suites (optional)

Disruptive GUI suites (desktop smoke/native windows) should be declared remote-only so local runs
cannot spawn visible windows without evidence. Add to config — absent/empty block is a no-op:

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

`localMode: hidden` allows a hidden local run only when explicitly requested (`--hidden`); the
default `forbidden` allows no local run. Wire the offline guard into the suite script
(`guard:local-suite`) and/or Playwright `globalSetup` (`playwright-remote-guard.mjs`); the remote
visible run is the evidence, hidden local is non-authoritative. Agents must never set the override
env. See [profiles/desktop](../profiles/desktop/README.md) and
[REFERENCE §5.6](./REFERENCE.md#56-guard-local-suite-remote-only-verification-policy).

### 2.8 Verified counts contract (optional)

Declare the pass/fail/skip contract in config (absent = no-op):

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

Wire the suite job to run the counted inventory + `suite-counts check --suite ... --mode ...` (fails
on drift/flaky/malformed output) and the docs job to run `guard:docs:counts` (baseline schema +
named-skip/reviewed agreement + generated doc/marker freshness; no test execution). Counts change ⇒
baseline + `docs/TEST_COUNTS.md` + markers change in the same PR; new skips start as placeholders
until a human fills `reason/coveredBy/agreedOn`. Full wiring:
[profiles/counts](../profiles/counts/README.md).

## 3. Install template/config

Copy from the tracker template (copy mode requires the full set):
- `scripts/github/**`, `schemas/tracker.config.schema.json`, `package.json`
- `profiles/node/`, `profiles/release/**` (if used), `profiles/counts/` (if the counts contract is adopted), `tests/**` (optional but recommended)
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

## 3.5 No-copy guard installation

Add the thin guard caller described in [GUARD_DISTRIBUTION](./GUARD_DISTRIBUTION.md); do not copy the guard implementation. Add `guard.allow` only for explicit migration exceptions. If the project carries `scripts/github/**` in copy mode, wire `npm run guard:gh` into its test/CI task.

## 4. Create the plan skeleton

1. Program roadmap issue (or a `docs/ROADMAP.md` plus roadmap issue) — decisions, releases, operating model.
2. Release tracker per milestone — objective, sprints, gates, artifacts, rollback.
3. Sprint tracker(s) — goal, task list, exit criteria.
4. Task issues — DoR/acceptance/test/evidence; link sub-issues.
5. Set Project fields on every item: Status=Todo, Release, Sprint, Area, Kind, Estimate, Source; add to board (auto-add should do it). `bootstrap.mjs` seeds valid defaults for Area/Kind/Estimate; manually created issues need explicit values or `task.mjs start` fails DoR and audit flags empty fields.

Pilot example (clearly marked): `examples/castdeck.config.json` shows a real project config; do not copy its release content.

**Tooling profile alternative:** instead of release/sprint trackers, open one `[Stream] <name> — <delivery>`
container per delivery (`stream.mjs open`) and add tasks as sub-issues carrying the same `Stream` field
option. The tag records the version; stream close requires every child task done and the release gate green.

## 5. Audit, CI, protection

- Configure the tracker audit token as a secret (project-scoped).
- Add CI/audit caller workflows (shipped CI/security/audit; release profiles shipped); keep audit **advisory** first.
- Configure branch protection/rulesets:
  - required: deterministic Linux CI checks.
  - advisory first: desktop smoke/audit.
  - protect release tags/environments.
- Run `node scripts/github/audit.mjs --config tracker.config.json --advisory` (use `--strict` at release gates).
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

Tooling profile variant: open a `[Stream]` container, add the task as its sub-issue with the `Stream`
field, start with `task.mjs start --stream`, finish with `done --pr ... --evidence ...`, then close the
stream after the release gate passes. Do not start feature work until the first task proves the loop.

## 8. Adoption checklist

- [ ] Repo/project linked; fields/statuses/views/workflows configured.
- [ ] Types or documented fallback; labels minimal.
- [ ] Milestones/releases + hierarchy created.
- [ ] Issue/PR templates + comment templates installed/linked.
- [ ] Config validated and pinned exactly.
- [ ] Audit token scoped/stored; audit advisory; manual checklist run.
- [ ] Branch protection/required checks documented; expensive jobs advisory.
- [ ] Remote-only GUI suites declared in `verification.remoteOnly` and wired to the local guard/Playwright globalSetup (optional; absent = no-op).
- [ ] Counts contract declared in `docs.counts`, suite workflow runs `suite-counts check`, docs workflow runs `guard:docs:counts` (optional; absent = no-op).
- [ ] First task completed through the full lifecycle.
- [ ] Docs pinned/versioned; downstream feedback channel linked.
- [ ] Program-level gate closed (if applicable); upgrade policy understood.

## 9. After adoption

- Operate per [HOW TO USE](./HOW_TO_USE.md); audit periodically.
- Report bugs/features upstream using [DOWNSTREAM_FEEDBACK](./DOWNSTREAM_FEEDBACK.md).
- Upgrade only through [UPGRADING](./UPGRADING.md); pin exact versions.
- Record local overrides; never fork silently.

**Estimate:** small project first task 1–2h; full adoption 3–6h (excluding project-specific plan/content).

## No-admin merges

Use `npm run merge-pr -- --pr N --repo owner/repo --delete-branch`; it refuses `--admin` and requires `ci / ci-gate` + `docs-guard` SUCCESS. Downstream private repos without branch protection must rely on contract/release gates instead.

## Adoption contract verify

Run `npm run verify:contract` against `contract/adoption-contract.json`. Required workflows must be pinned to the exact tracker tag; a bespoke workflow or missing capability requires an OI-linked `tracker.overrides.json` entry with reason and expiry.

## Closing-keyword guard

Completion PRs use `Closes #<task>`; partial PRs use `Refs/Part of #<parent>` with the `partial` label and must not close. The tracker PR close guard rejects incorrect closing targets (including sprint/release trackers) and keeps the project linked-PR field consistent.

## Post-merge bypass audit

Merged PRs with failed/missing required checks or invalid closure open a `tracker-contract-exception` OI. The next release must block until resolved.

Set your **real check names** (not the tracker's own) so the audit does not open false bypass OIs:

```json
"guard": { "requiredChecks": ["ci / ci-gate", "tracker-guard / guard", "pr-close-guard"] }
```

Absent config keeps the default (`ci / ci-gate`, `docs-guard`, `pr-close-guard`). The copied caller
workflow must grant `contents: read`, `issues: write`, `pull-requests: read`, `checks: read`,
`statuses: read`; without `checks: read`/`statuses: read` on a private repo the audit degrades to a
warning + closure-only audit (no false check OI) instead of failing red.

## Release gate

Before releasing, run `npm run gate:release -- --root . --repo owner/repo`; it verifies the pinned contract and fails on any open `tracker-contract-exception` OI.

## Preflight and dependency approval

Start tasks only on a clean worktree. Dependency changes require an approved `tracker.dependencies.json` entry (issue/reason/expiry); CI runs `guard:deps`. Local installs should still pause for explicit human approval.

## Manual release fallback

When a protected environment is unsupported, use hosted macOS dry-run → download artifacts → `verify:checksums` → draft release → second-reviewer checksum comparison → publish, retaining run/checksum evidence. The fallback is manual approval, not platform-enforced protection.


## Lint/format self-check (T18)

Tracker OS now self-applies ESLint and Prettier: `npm ci`, `npm run lint`, and
`npm run format:check`. A missing or broken lint/format command fails CI rather than succeeding
as a no-op. Dev tooling is approved in `tracker.dependencies.json`; see issue #82.

## Project metadata verification

Run `verify:metadata` against the live project. Required fields must exist; Priority is an
optional standard field; project-specific forbidden fields are rejected. Open/current work is strict with canonical `[Release]` / `[Sprint]` titles; legacy title formats fail. Historical audits use `--include-closed`; migration uses `--warn-only` until T20 reconciliation is approved.


## Metadata reconciliation

Run report-first (`--repair=none`), review the plan, then apply open-only or selected repairs. Closed history is report-only by default; exceptions/OIs are recorded for issues not safely changed.

Historical metadata exceptions are explicit, OI-linked, and expiring. They are reserved for artifacts that cannot be safely repaired, such as duplicate closed issues; open/current issues are always strict.

## Branch hygiene

Install `.githooks` with `npm run hooks:install`; do not require unconditional branch switching in
automation. Use `git switch -c task/...`, assert the branch before commits, and rely on
main-history detection plus the release gate where branch protection is unavailable.
