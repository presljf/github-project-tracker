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
until a human fills `reason/coveredBy/agreedOn`.

Reusable-mode docs caller (a v1.4.0 `requiredWorkflows` entry): copy
[`profiles/counts/counts-docs.yml`](../profiles/counts/counts-docs.yml) into
`.github/workflows/counts-docs.yml` and pin both refs to the adopted tag. Its check context is
**`counts-docs / counts`**; the reusable `reusable-counts.yml` runs `guard-docs-counts.mjs` against
the workspace (self) or the pinned `.tracker` checkout (downstream) — it validates baseline
agreement + generated-doc/marker freshness and does **not** run the suite inventory/tests. When
`docs.counts` is absent the caller is a documented no-op (the template repository's own caller is
in that state); require `counts-docs / counts` only in projects that adopt the counts contract.
Full wiring: [profiles/counts](../profiles/counts/README.md).

## 3. Install template/config

Copy from the tracker template (copy mode requires the full set):
- `scripts/adopt/**` (adopter CLIs + shared libs + docs-QA CLIs); `scripts/internal/` is
  template-maintainer-only and is never copied
- `schemas/tracker.config.schema.json`, `package.json`
- `profiles/node/`, `profiles/desktop/` (if used), `profiles/e2e/` (if E2E is used), `profiles/counts/` (if the counts contract is adopted — its `counts-docs.yml` caller is reusable-mode), `tests/**` (optional but recommended)
- Release caller examples: `profiles/release/reusable/` (reusable-mode callers — copy into
  `.github/workflows/` and pin the adopted tracker tag) or `profiles/release/copy/` (copy-mode templates)
- `.github/ISSUE_TEMPLATE/*`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/workflows/*` caller workflows (CI/security/audit/guard runners are shipped; the `reusable-*`
  contracts are called by pinned template ref, not copied)
- `docs/comment-templates/*` (or link the upstream docs)
- `tracker.config.example.json` → `tracker.config.json`

Edit config for your repo/project/releases/sprints/commands. Validate:
```bash
node scripts/adopt/cli/validate-config.mjs tracker.config.json
# OK   tracker.config.json
```

Pin the template version exactly and record the feedback channel:
```json
"automation": { "templateRepo": "presljf/github-project-tracker", "templateVersion": "1.0.0" },
"feedback": { "upstreamRepo": "presljf/github-project-tracker", "issueForm": "downstream-bug.yml", "pinnedVersion": "1.0.0" }
```

## 3.5 No-copy guard installation

Add the thin guard caller described in [GUARD_DISTRIBUTION](./GUARD_DISTRIBUTION.md); do not copy the guard implementation. Add `guard.allow` only for explicit migration exceptions. If the project carries `scripts/adopt/**` in copy mode, wire `npm run guard:gh` into its test/CI task.

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
- Add CI/audit caller workflows (CI/security/audit runner callers are shipped; release caller
  `release.yml` plus reusable-mode examples under `profiles/release/reusable/`); keep audit
  **advisory** first. Also add the reusable contract/metadata caller
  (`profiles/contract/tracker-contract.yml`): `contract` is a required check, `metadata` is
  project-defined (see [Adoption contract verify](#adoption-contract-verify)).
- Install the audit-family callers you need from [`profiles/audit/`](../profiles/audit/README.md)
  (copy-mode, 1–3 callers: `pr-close-guard.yml`, `post-merge-audit.yml`, `tracker-audit.yml`), pin
  the adopted release tag (the contract verifier requires the `@v<version>` tag form and a matching `tracker-ref`), grant the documented caller permissions, and update required checks
  (see [Closing-keyword guard](#closing-keyword-guard) and
  [Post-merge bypass audit](#post-merge-bypass-audit)).
- Install the E2E and counts callers: copy
  [`profiles/e2e/`](../profiles/e2e/README.md) (`e2e.yml` → `reusable-e2e.yml`) and
  [`profiles/counts/counts-docs.yml`](../profiles/counts/counts-docs.yml) into `.github/workflows/`,
  pin both refs to the adopted tag, and keep `contents: read` with no secrets (E2E may upload a
  failure-only artifact; counts uploads none). `e2e / e2e` stays advisory by default; require
  `counts-docs / counts` only when the counts contract is adopted (otherwise it is a no-op). Both
  are **required callers** in the v1.4.0 adoption contract — a project that does not run E2E still
  keeps the caller file (dispatch-only or path/label-gated), but the check stays advisory.
- **Required caller set (v1.4.0):** `contract/adoption-contract.json` marks
  `reusable-contract`, `reusable-post-merge-audit`, `reusable-pr-close-guard`, `reusable-audit`,
  `reusable-e2e`, and `reusable-counts` as `requiredWorkflows`; `verify-contract` fails when one is
  missing or not pinned to the exact adopted tag. See
  [UPGRADING § Required adoption contract](./UPGRADING.md#required-adoption-contract-six-reusable-callers).
- Configure branch protection/rulesets:
  - required: deterministic Linux CI checks, `tracker-contract / contract`, and
    `pr-close-guard / guard` (audit-family migration; the old inline `pr-close-guard` context is
    retired); add `counts-docs / counts` only once the counts contract is adopted.
  - advisory first: desktop smoke, tracker audit (`tracker-audit / audit`), and E2E (`e2e / e2e`);
    the post-merge audit runs after merge and reports through an OI/job summary, so it is not a merge
    check; `tracker-contract / metadata` is project-defined (it is skipped on pull requests by the
    bundled caller).
  - protect release tags/environments.
- Run `node scripts/adopt/cli/audit.mjs --config tracker.config.json --advisory` (use `--strict` at release gates).
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
- [ ] All six v1.4.0 required callers present and pinned (contract, post-merge audit, PR close guard, tracker audit, E2E, counts); `npm run verify:contract` passes. Caller presence is required by the contract, while each check context stays project-defined.
- [ ] Counts contract declared in `docs.counts`, suite workflow runs `suite-counts check`, docs workflow runs `guard:docs:counts` via the reusable `counts-docs / counts` caller (the caller is required; without `docs.counts` it is a documented no-op).
- [ ] E2E caller adopted from `profiles/e2e/` with browsers/command configured (the caller is required; `e2e / e2e` stays advisory unless deliberately promoted, and a project without E2E may make the caller dispatch-only).
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

Contract + metadata verification is reusable-mode (no copied verifier workflows): copy
[`profiles/contract/tracker-contract.yml`](../profiles/contract/tracker-contract.yml) into
`.github/workflows/`, then pin **both** refs — the reusable-workflow `uses:` ref and the
`tracker-ref` input — to the exact tracker tag you adopted. v1.4.0 is the first release that ships
`reusable-contract.yml`; replace the example's `@v1.3.2` placeholders. The caller job
`tracker-contract` exposes two check contexts:

- `tracker-contract / contract` — offline `verify-tooling` + `verify-contract`; make this a
  **required** check.
- `tracker-contract / metadata` — live project metadata (`verify-metadata`); **project-defined**.
  It needs the `TRACKER_TOKEN` secret (Projects read + Metadata read). The bundled caller disables
  it on pull requests (`metadata: ${{ github.event_name != 'pull_request' }}`) because fork PRs
  never receive secrets, so it runs on push/`workflow_dispatch` only — do not require this context
  on PRs unless the project deliberately runs metadata on every PR.

Set `TRACKER_TOKEN` as a repository secret (project-scoped PAT with Projects + Metadata read,
≤90 days, or a GitHub App installation token), pass it explicitly by name (never `secrets:
inherit`), and rotate it on the tracker's token schedule; never put it in config, comments, or
artifacts. The `metadata` job requires `project.number` in `tracker.config.json`. `config-path`
feeds `verify-tooling` only; `verify-contract` and the metadata job read `tracker.config.json`
from the repository root / `working-directory`. Full input/contract table:
[ACTIONS CATALOG §7.10](./ACTIONS_CATALOG.md#710-reusable-contractyml-contract-metadata-verification-contract)
and [profiles/contract](../profiles/contract/README.md).

Migrate in the **same PR** as the pin upgrade: update branch protection/rulesets to the new
contexts, keep the old copied `tracker-contract` / `tracker-metadata` workflow checks running until
the upgrade merges, then delete the old copied workflows. Old→new mapping, fork-PR behavior, and
`submodule-path`/`project.number` caveats: [UPGRADING](./UPGRADING.md).

Local parity (no GitHub writes): `npm run verify:tooling -- --root . --contract
contract/adoption-contract.json --tracker-config tracker.config.json`,
`npm run verify:contract -- --root . --contract contract/adoption-contract.json`, and, where a
project token is available,
`GH_TOKEN=$(gh auth token) npm run verify:metadata -- --repo OWNER/REPO --contract contract/adoption-contract.json`.
Required workflows must be pinned to the exact tracker tag; a bespoke workflow or missing
capability requires an OI-linked `tracker.overrides.json` entry with reason and expiry. v1.4.0
requires the six callers listed under [Required caller set](#5-audit-ci-protection) — contract,
post-merge audit, PR close guard, tracker audit, E2E, and counts — in addition to the pre-existing
CI/security/release/desktop-smoke entries. The verifier checks presence and the exact
`@v<automation.templateVersion>` pin; it does not enforce caller job names (check contexts remain
project-owned). The template repository's own `verify-contract` run skips these downstream checks in
self mode by design.

## Closing-keyword guard

Completion PRs use `Closes #<task>`; partial PRs use `Refs/Part of #<parent>` with the `partial` label and must not close. The tracker PR close guard rejects incorrect closing targets (including sprint/release trackers) and keeps the project linked-PR field consistent.

Install the reusable-mode caller (`profiles/audit/pr-close-guard.yml` → `.github/workflows/`,
pinned to the adopted tag): its check context is **`pr-close-guard / guard`**, and the caller grants
only `contents: read`, `issues: read`, `pull-requests: read` (the guard script is read-only). Add
`pr-close-guard / guard` to branch protection/rulesets in the same PR as the caller migration — the
old inline `pr-close-guard` context disappears with the old workflow.

## Post-merge bypass audit

Merged PRs with failed/missing required checks or invalid closure open a `tracker-contract-exception` OI. The next release must block until resolved.

Install the reusable-mode caller (`profiles/audit/post-merge-audit.yml` → `.github/workflows/`,
pinned to the adopted tag): its check context is **`post-merge-audit / audit`**. It triggers on
`pull_request` closed (merged only) and on manual dispatch with a `pr-number`; the audit script
(`scripts/adopt/cli/post-merge-audit.mjs`, via the repo transport — no raw `gh` in workflows)
revalidates `state == MERGED` and re-fetches the PR before auditing. The caller must grant
`contents: read`, `issues: write`, `pull-requests: read`, `checks: read`, `statuses: read`,
`actions: read`: `issues: write` opens the OI/label and the three read scopes are needed for
`statusCheckRollup` (its GraphQL query resolves `checkSuite.workflowRun`). Without `checks: read`/`statuses: read`/`actions: read` on a private repo
the audit degrades to a loud warning + closure-only audit (no false check OI) instead of failing red.

Set your **real check names** (not the tracker's own) so the audit does not open false bypass OIs:

```json
"guard": { "requiredChecks": ["ci / ci-gate", "tracker-guard / guard", "tracker-contract / contract", "pr-close-guard / guard"] }
```

The template's audited config sets `["ci / ci-gate", "docs-guard", "pr-close-guard / guard"]`; the
retired inline `pr-close-guard` context must be replaced by `pr-close-guard / guard` when you
migrate. If `guard.requiredChecks` is absent, the audit falls back to the legacy default list
(`ci / ci-gate`, `docs-guard`, `pr-close-guard`) — which no longer matches the reusable context, so
every merge would be flagged as a bypass; set the list explicitly.
`tracker-contract / metadata` is only added if the project requires live metadata checks (the
bundled caller skips it on pull requests); `post-merge-audit / audit` is not a merge check and is
not listed.

Tracker audit runs are advisory by design: the `tracker-audit.yml` caller dispatches
schedule/`workflow_dispatch`/PR runs in `mode: advisory`; without a `TRACKER_TOKEN` secret the
advisory run logs a notice and skips with exit 0, while `mode: strict` (release-gate opt-in) fails
actionably without the token. Token scope for the audit is project read **and** repo/issues read on
private repositories: a project-scoped PAT with `project` + `repo` scopes (≤90 days) or a GitHub App
installation token with Projects + Metadata + Issues read; store it as a repository secret. No
artifacts are uploaded — the JSON result goes to the job log/summary.

**Contract status / rollback:** the three audit reusables are shipped, documented in
[ACTIONS CATALOG §7.6/§7.11/§7.12](./ACTIONS_CATALOG.md), and **required** by the v1.4.0 adoption
contract (`requiredWorkflows`), so `verify:contract` fails a missing or non-pinned caller. Roll back
by restoring the v1.3.2 inline copies (`post-merge-audit.yml`, `pr-close-guard.yml`,
`tracker-audit.yml`) and the old protection contexts — the v1.3.2 tag keeps the inline workflows.
After the tag exists, a deliberate exception needs an OI-linked `tracker.overrides.json` entry with
a reason and non-expired expiry instead of silently dropping a caller.
Fork-merged PRs may lack `issues: write`, so OI creation can return 403 (documented pre-existing
limitation: the bypass is reported in the job log and the run fails loudly instead of recording the
OI — open the follow-up manually).

## Release gate

Before releasing, run `npm run gate:release -- --root . --repo owner/repo`; it verifies the pinned
contract (including the six required callers) and fails on any open `tracker-contract-exception` OI.
Release workflows may opt into the reusable equivalent **before build** with
`contract-gate: true` + `tracker-ref: <adopted tag>` on `reusable-release.yml`; the gate's offline
half runs verify-tooling + verify-contract + release-gate-without-`--repo`, while the open-OI half
stays this explicit procedure step because it needs `issues: read` (see
[UPGRADING § Opt-in release contract gate](./UPGRADING.md#opt-in-release-contract-gate-contract-gate)).

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
