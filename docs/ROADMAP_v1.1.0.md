# v1.1.0 execution plan — tracker hardening before CastDeck adoption

**Status:** Active plan of record · **Created:** 2026-11-11 · **Tracker template:** v1.0.1
**Rule:** This plan changes only through dated plan-change comments on the release/sprint tracker + this file.

## 1. Purpose

Close the remaining tracker OS gaps **with automated enforcement** before resuming CastDeck. Key principle: no process that depends on memory, good intentions, or “remember to do it.” Every requirement is enforced by a script, audit rule, CI job, or gate.

## 2. Current state

### Released tracker
- Template tags: **v1.0.0**, **v1.0.1** (validated patch includes bootstrap GraphQL field-options fix).
- Tracker audit: 30 issues / 30 project items clean at last run.
- Scratch validation: archived `presljf/tracker-smoke-20261111-123300`, project #3; bootstrap 51 actions, idempotent re-run 1 no-op, task lifecycle complete, strict audit 0 violations.
- Tests: 37/37. Docs checker: 47 files clean. Cards: 7/7 one-page, 14 PDFs.
- Known platform limits: branch protection/rulesets 403 on private personal repo; live release publish/signing not exercised; template private.

### v1.1.0 backlog structure
- Roadmap: [#44](https://github.com/presljf/github-project-tracker/issues/44)
- Release tracker: [#45](https://github.com/presljf/github-project-tracker/issues/45)
- Sprint tracker: [#46](https://github.com/presljf/github-project-tracker/issues/46)
- Tasks: T01 #39, T02 #40, T03 #41, T04 #42, T05 #43, T06 #47

### Current blockers
1. **GraphQL primary budget exhausted:** 5,000 points/hour; reset `21:30:10Z` (13:30 PT). `/rate_limit` endpoint is not reliable for this; use response headers. T06 check-in is paused until reset.
2. **Actions queue:** CI/Security/Release runs queued with zero jobs assigned. Separate from GraphQL. Billing/minutes/runner cause not proven. Release-tag workflow was **disabled manually** to prevent a queued run from creating/publishing a release.
3. **Manual backlog normalization:** v1.1.0 issues now have full template sections and hierarchy, but that was manual; T06 automates enforcement.

## 3. Execution rules

- Every task uses the task CLI/process: DoR → check-in → branch → PR → review → checkout.
- WIP=1 per owner; one task → one branch → one PR; no direct implementation without check-in.
- Required automated gates:
  - `npm test`
  - `npm run docs:check`
  - `node scripts/github/validate-config.mjs`
  - `node scripts/github/audit.mjs --config tracker.config.json --strict`
  - CI where available.
- No bulk API mutation bursts. Honor rate-limit headers; pause between mutations; batch/cache before issuing more.
- No CastDeck product work until adoption gate #77 closes.
- No public release or release-workflow enablement without explicit approval.

## 4. P0 track — rate-limit hardening (must precede adoption)

### T07 — Rate-limit-aware GitHub transport
**Goal:** make every GitHub call budget-aware and safe under primary/secondary limits.

**Scope**
- Central transport in `scripts/github/lib/github.mjs`:
  - capture response headers (`x-ratelimit-*`, `retry-after`);
  - track remaining/reset/used per resource;
  - preflight estimated cost; wait until reset or fail closed with actionable error;
  - one mutative request at a time; ≥1s spacing; exponential backoff with jitter;
  - honor `retry-after` and reset timestamps; never blindly retry non-idempotent mutations;
  - secondary-limit detection and cooldown.
- `rate-limit` diagnostic command/JSON: resource, remaining, reset, suggested wait.
- Tests using a fake transport/clock: no real sleeps; simulate 0 remaining, secondary 403, retry-after, mutation spacing.
- Docs: `REFERENCE` rate-limit section; `TROUBLESHOOTING`; no-Pro caveat.

**Acceptance**
- [ ] All GitHub traffic goes through the transport; no raw `gh` calls in bootstrap/audit/task.
- [ ] Primary exhaustion waits/fails with reset guidance; secondary 403 honors retry-after.
- [ ] Mutation spacing and non-idempotent retry rules tested.
- [ ] Diagnostics command/JSON; tests deterministic.
- [ ] Docs updated; strict audit still passes.

### T08 — Cache and batch call shapes
**Goal:** reduce calls per command and remove repetitive project reads.

**Scope**
- Per-run cache: project IDs, fields/options, project item map, issue metadata; refresh only when stale/after write.
- Bootstrap: one project/field/item read; reuse to create/set fields; no re-list per issue.
- Audit: batch comments/sub-issue/dependency reads (GraphQL aliases or REST chunks) instead of 3 calls × N issues; cap pages; cache.
- Task CLI: reuse project/field/item context; no redundant list calls per transition.
- Acceptance metrics: compare API calls before/after on 30-issue fixture; no per-issue re-listing; seeded budget test.
- Tests: fake transport counts calls/cache hits; 30-issue audit; bootstrap/task call counts below target.
- Docs: rate-limit/budget guidance; token/GitHub App options.

**Acceptance**
- [ ] Audit call count materially reduced with same violations.
- [ ] Bootstrap/task commands use cached project/field/item IDs.
- [ ] Tests assert call/cache counts; no behavior regressions.
- [ ] Rate-limit docs include budgets and no-Pro limitation.
- [ ] Strict audit clean.

**Dependency:** T08 blocked by T07. T06 blocked by T07.

## 5. P1 — automated audit enforcement (T06 #47)

Extend `audit.mjs` so manual normalization cannot silently pass again:
- Required issue-template/DoR sections on open tasks:
  Why/context, Current behavior, Goal, Non-goals, Acceptance criteria, Test plan, Verification evidence, Dependencies/blockers, Risks/rollback.
- Required release tracker + sprint tracker ancestry for every open task; documented exceptions only.
- Seeded fixture tests for every missing section and missing hierarchy.
- `--strict` fails; advisory stays advisory.
- Update REFERENCE/HOW TO USE audit invariants.
- Use T07/T08 transport/caching; do not add N+1 calls.

**Dependency:** blocked by T07 (ideally T08).

## 6. P2 — v1.1.0 follow-ups (existing)

| Task | Issue | Priority | Dependency/notes |
|---|---|---|---|
| T01 cross-repo reusable/composite access + public-template decision | #39 | P2 | temporary downstream repo; archive after |
| T02 live release-profile validation + actionlint + CI queue | #40 | P2 | release workflow disabled; re-enable only here, dry-run first |
| T03 audit-in-CI token + branch protection | #41 | P2 | needs public/Pro for protection; token scoped |
| T04 downstream feedback/security/publication | #42 | P2 | private reporting requires public/org setting |
| T05 pin examples/docs to v1.0.1 + docs:check/actionlint CI | #43 | P2 | do before adoption if pin still v1.0.0 |

T01/T04/T05 are docs/repo-scoped and can run in parallel worktrees; T02/T03 share CI workflow files and must be serialized. T06/T07/T08 stay with the Lead/integrator.

## 7. Actions / CI queue recovery

- Check GitHub **Settings → Billing → Actions** (minutes/spending limit); current token lacks `user` scope for billing API.
- Cancel stale queued CI/Security runs; do not re-enable Release (generic) until T02.
- Rerun a workflow after billing/queue fix; capture real check contexts.
- Branch protection/rulesets: 403 on private personal repo; enable when public/Pro. Required check target: `ci / ci-gate`; keep CodeQL opt-in; desktop/audit advisory initially.
- Pro does **not** raise API primary limits (REST 5,000/hr, GraphQL 5,000 points/hr). Pro may add Actions minutes and private-repo protection; GitHub App installation tokens can scale API budget.

## 8. CastDeck adoption handoff (after P0/P1 + T05 pin)

Gate https://github.com/presljf/castdeck/issues/77 remains open. Adoption tasks #78–#81 are still project-Blocked; update them to Todo when adoption starts.

Sequence:
1. Pin CastDeck tracker config to the validated template version (v1.0.1 now; update if T05 lands).
2. Adopt tracker audit/token + project operations; run baseline audit.
3. Adopt issue/PR templates and tracker docs.
4. Validate adoption (dry-run/read-only where possible); close gate #77.
5. Start CastDeck v0.4.6 implementation-only sprint (tracker policies/profiles), then features.

Do not start CastDeck quality/product work before gate #77 closes.

## 9. Immediate next actions

1. **Wait for GraphQL reset** `21:30:10Z`; no project mutations.
2. Create T07/T08 with full template bodies, hierarchy under sprint #46, fields, types; block T06 by T07.
3. Check-in T07 via task CLI; implement transport + tests + docs.
4. T07 → T08 → T06 (strict audit must fail seeded missing-section/hierarchy fixtures).
5. Re-run strict audit on all backlog issues; any violations are fixed, not waived.
6. Recover Actions queue/billing; rerun CI; keep Release disabled until T02.
7. T05 pin update; adoption #78–#81; close gate #77; start CastDeck v0.4.6.

## 10. Definition of done for this plan

- [ ] T07/T08 merged; rate-limit tests pass; no unbounded request loops.
- [ ] T06 merged; strict audit enforces sections + hierarchy; seeded violations demonstrated.
- [ ] Backlog audit clean; all issues have full template sections/hierarchy.
- [ ] CI queue resolved or documented; at least one green CI run with exact checks.
- [ ] T05 pin/docs CI done or explicitly deferred with plan-change.
- [ ] Tracker v1.1.0 closed and tagged.
- [ ] CastDeck adoption gate #77 closed; CastDeck next sprint started.
- [ ] All deviations/follow-ups recorded in issues, not chat.

## 11. Deferred/known follow-ups

- Live release publish/signing/container/package execution: T02.
- Branch protection/rulesets: T03 when public/Pro.
- Private vulnerability reporting/publication: T04.
- GitHub App bot issue assignment: NO-GO (Option A retained); app token only for automation if needed.
- actionlint unavailable in current environment; run in CI/T02.
- Cross-repo private reusable access unverified: T01.
- Scratch repo archived; delete later by owner if desired.
- Unreleased GitHub Release: none published; release workflow disabled.
