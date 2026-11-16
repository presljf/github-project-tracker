# ARCHITECTURE — GitHub-native core, custom checks only

**Docs version:** v1.4.0-docs.1 · Target template: v1.4.0

This page is the design boundary for Project Tracker OS. It exists so feature work has a stopping
rule: GitHub owns the mechanics and the enforcement plane, and the tracker only ships the judgment
GitHub cannot express.

## The one rule

> If GitHub can express it declaratively — form field, project automation, ruleset, required check,
> environment, issue template — use that. Write code only for the judgment GitHub cannot express.

Every proposed feature must attach to an existing extension point: a check, a reusable workflow, a
composite action, an issue-form field, a ruleset, a project automation, an environment, or a webhook.
A feature that needs its own event bus, policy engine, control-plane store, or write gateway is
**off-core**; it needs an explicit decision and a reopen trigger, not a default.

## Layer map

```text
5  Agent facade (optional)      DSH skill / thin MCP facade over the same CLI (unchanged checks)
4  Consumer surface             tracker.config.json + one caller workflow (+ issue forms)
3  Custom checks                ONE CLI: audit (drift) + guard (PR/close integrity)
2  Declarative enforcement      rulesets · required checks · environments · org required workflows
1  Input contract               issue forms · PR template · project field schema
0  GitHub primitives            issues · projects · pull requests · checks · actions · releases
```

Each layer uses only the layer below it. No layer reimplements the one below.

## Extension-point map

| Desired behavior | GitHub mechanism | Custom code |
| --- | --- | --- |
| Required fields at creation (DoR) | Issue forms | No |
| Status transitions, auto-add, close→Done | Project built-in workflows | No |
| Board schema (Status/Area/Kind/Estimate) | `gh` bootstrap or manual project setup | Thin |
| PR must reference a board item in the right state | Required check (guard) | **Yes — core** |
| Done requires evidence and green checks | Required check (guard) + ruleset | **Yes — core** |
| Closure integrity (merged PR ↔ issue) | Guard check | **Yes — core** |
| Drift audit across items/projects | Advisory scheduled check | **Yes — core** |
| Branch protection, required checks, no force-push | Rulesets | No |
| Release gating | Environments + required reviewers + tag rules | No |
| CI, lint, tests, security scans | The project's own workflows (optional reusables) | No |
| Cross-repo enforcement | Org ruleset required workflows (pull requests) + org `.github` defaults | No |
| Agent reads/writes | Same CLI via a scoped token; MCP facade only if needed | Thin |
| Untrusted agent writes | Add approval/policy *then*; not before | Deferred |

## The custom layer: what qualifies

Only four judgments justify custom code:

1. **Readiness** — a PR/issue is not ready because a board item lacks required fields or state.
2. **Evidence** — a task cannot close without a linked PR, green checks, and an evidence comment.
3. **Consistency** — the merged PR, the issue, and the board item agree on state and links.
4. **Drift** — scheduled reconciliation across items and projects.

These are read-only by default. Writes stay on GitHub's own APIs through the adopter's existing
`gh`/token path; the tracker prepares and verifies, it does not become the write path.

## Deliberately not built

| Not built | GitHub already provides | Reopen trigger |
| --- | --- | --- |
| Policy engine / write gateway / broker | Rulesets, token scopes, required workflows, environments | Untrusted agents must write unattended |
| Release framework | Tag rules + protected environments + the project's pipeline | Two projects prove a shared need |
| CI/security product | The project's own workflows; ships only as optional reusables | An adopter asks for the exact reusable |
| Docs/version/coverage/count guards for consumers | Project-owned docs; the guards validate **this** repo only | Never (template-internal QA) |
| Dashboard/UI | Projects views | Never |
| macOS/Windows runner platform | GitHub-hosted runners, or the project's own runner choice | Never in this repo |

## Consumer tiers

| Tier | What a project carries | Status |
| --- | --- | --- |
| **Core** | `tracker.config.json`, one `.github/workflows/tracker.yml`, issue forms (2), `docs/TRACKER.md` | Required by the contract |
| **Optional profiles** | CI, security, release, desktop smoke, post-merge audit, contract/metadata, E2E, counts callers | `optionalWorkflows` catalog in the contract |
| **Template-internal** | `scripts/internal/*`, meta workflows, docs/coverage/surface/debt guards, engine tests | Never shipped |

The consumer bundle is defined in [CONSUMING](./CONSUMING.md) and materialized in
[examples/minimal-adopter](../examples/minimal-adopter/README.md). The contract that the verifier
enforces lives in [contract/adoption-contract.json](../contract/adoption-contract.json); its
`requiredWorkflows` are the core guards and its `optionalWorkflows` are the catalog.

## Distribution mechanisms

1. **Reusable workflows pinned by tag** (default for personal repositories): the project calls
   `presljf/github-project-tracker/.github/workflows/reusable-*.yml@v<version>` and passes
   `tracker-ref: v<version>`. Upgrade = bump refs + `automation.templateVersion`; `verify-contract`
   fails stale pins.
2. **Org ruleset required workflows** (when projects live in an organization): one workflow in this
   repository is enforced across all covered repositories on pull requests, with no per-repo caller.
   GitHub only enforces required workflows on pull-request events, so the scheduled audit keeps its
   small caller (or one central scheduled audit job).
3. **Org `.github` defaults**: issue forms/PR template inherited by repos without their own copies.
   Verify visibility behavior for private repositories in your organization before relying on it.
4. **Never copy the engine.** Copying `scripts/internal`, meta workflows, or the tracker's own docs
   is not adoption; it is forking maintenance.

## Consumer budget

A new project must onboard with **at most five files, ten minutes, and one version line to upgrade**
(config, one caller workflow, two issue forms, and the required `docs/TRACKER.md`).
That is enforced by example, not by prose: [examples/minimal-adopter](../examples/minimal-adopter/README.md)
is validated by the test suite (`validate-config` + `verify-contract` run against the example root),
and the consumer guide is [CONSUMING](./CONSUMING.md). If onboarding needs more than the budget, fix the interface —
never add a platform feature.

## What lives where in this repository

- **Core checks:** `scripts/adopt/cli/audit.mjs`, `scripts/adopt/cli/guard-pr-close.mjs`,
  `scripts/adopt/cli/post-merge-audit.mjs`; shipped as `reusable-audit.yml`,
  `reusable-pr-close-guard.yml`, `reusable-post-merge-audit.yml`.
- **Config contract:** `schemas/tracker.config.schema.json`, `tracker.config.example.json`.
- **Optional profiles:** `.github/workflows/reusable-{ci,security,release,desktop-smoke,contract,e2e,counts}.yml`
  with copy-mode callers under `profiles/`.
- **Template-internal QA:** `.github/workflows/` meta runners, `scripts/internal/`, `tests/`,
  `contract/repo-surface.json`, `docs/SURFACE.md`, `docs/TECH_DEBT.md`.
- **Frozen pending evidence:** MCP broker/write gateway/policy engine, and the guard-proposal
  backlog. Reopen only with a consumer (CastDeck or another project) hitting the gap and a written
  reopen trigger.

Related: [CONSUMING](./CONSUMING.md) · [ADOPTION](./ADOPTION.md) ·
[ACTIONS CATALOG](./ACTIONS_CATALOG.md) · [UPGRADING](./UPGRADING.md) · [REFERENCE](./REFERENCE.md).
