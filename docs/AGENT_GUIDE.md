# AGENT GUIDE

**Docs version:** v1.3.0-docs.1 · Target template: v1.3.0
Operating protocol for agents (and humans delegating to agents) using the tracker.

## Non-negotiables

1. **One task in progress.** WIP = 1; finish/block/defer before starting another.
2. **Check in and out.** Assign owner, set In Progress, post check-in with branch/HEAD/scope; post check-out with evidence.
3. **One task → one branch → one PR.** `Closes #issue`; no drive-by changes.
4. **No secrets.** Never print/store tokens, cookies, passwords, private keys, or vulnerability details.
5. **Evidence over claims.** Attach command output/links/screenshots/checksums; say what you verified and what you didn't.
6. **Status is authoritative.** Todo → In Progress → In Review → Blocked → Done; update the Project field, not just comments.
7. **Plan changes are explicit.** Dated `plan-change` comment + label + tracker/field updates; no silent scope changes.
8. **No silent WIP.** If a session ends, post a checkpoint and hand off.
9. **No visible local GUI suites.** Suites declared under `verification.remoteOnly[]` run visibly only on a remote runner (`GITHUB_ACTIONS=true`) or in the documented hidden local mode; agents must never set the override env (human debugging only) and never claim local hidden runs as evidence.
10. **Counts are verified, not remembered.** Cite test counts only from counted-runner output + `suite-counts check`; counts change ⇒ baseline, generated `docs/TEST_COUNTS.md`, and markers change in the same PR. Never hand-edit generated counts/markers and never leave a non-zero skip unnamed.

## Work profiles

The repo config selects the enforced lifecycle (`workProfile`; absent means `product`):

- **`product` (default)** — `[Release]` → `[Sprint]` → tasks with Release/Sprint fields. Start with
  `task.mjs start --issue N`; close via the sprint/release lifecycle.
- **`tooling`** — `[Stream]` → tasks with a `Stream` field; the tag (if any) is the version record.
  Start with `task.mjs start --issue N --stream S`; `done` also requires `--pr`; close the delivery
  with `stream.mjs close` (refuses while child tasks are open and requires the release gate green).

Confirm the profile in the task issue/config before checking in; a product config rejects
`--stream` and a tooling config rejects a start without it. Do not mix lifecycles in one delivery.

## Remote-only suites

When `verification.remoteOnly[]` is configured, a disruptive suite (desktop GUI smoke, native
window tests) cannot run visibly locally:

```bash
# local visible attempt: blocked with remote workflow/label/override instructions
npm run guard:local-suite -- --suite desktop-smoke

# hidden local mode (non-authoritative; only if the suite declares localMode: hidden)
npm run guard:local-suite -- --suite desktop-smoke --hidden

# verify aggregator: record the deferral instead of blocking (exit 0, DEFERRED_REMOTE)
npm run guard:local-suite -- --suite desktop-smoke --mode report --json
```

- **Remote visible = evidence.** Attach the remote run URL/artifact at check-out; `GITHUB_ACTIONS`
  is the only remote signal (a local `CI=true` is not remote).
- **Hidden local = non-authoritative feedback.** It is allowed only when the suite declares
  `localMode: hidden`; never cite it as release evidence.
- **Override env = human debugging only.** It prints a loud warning; agents must not set it.
- Playwright suites wire `scripts/github/playwright-remote-guard.mjs` as `globalSetup` so the run
  fails before any window is created. Full reference: [REFERENCE §5.6](./REFERENCE.md#56-guard-local-suite-remote-only-verification-policy).

## Verified counts (aware and agree)

- Cite `collected / passed / failed / skipped / flaky` only from the counted inventory output plus
  `suite-counts check` (`COUNTS_OK ...`), never from memory or a previous release.
- Counts change ⇒ the same PR updates the baseline, generated `docs/TEST_COUNTS.md`, and inline
  markers: run the update command (`record`), then complete `knownSkips` agreement
  (`reason`/`coveredBy`/`agreedOn`) and `reviewed { on, by, evidence[] }`.
- `npm run guard:docs:counts` enforces schema/agreement + generated-doc/marker freshness (it does
  not run tests). Historical docs are exempt by construction; never rewrite past records.
- Non-zero skips must be named and agreed; flaky > 0 fails — fix flakiness instead of recording it.
- Full reference: [REFERENCE §5.7](./REFERENCE.md#57-verified-counts-contract-suite-counts-guard-docs-counts).

## Session start

- [ ] Read the task issue (Why, goal, non-goals, acceptance, test/evidence, deps).
- [ ] Confirm DoR; if missing, do not start — comment what is missing.
- [ ] Check WIP: no other In Progress task for this owner.
- [ ] Confirm branch/base and repo state (`git status`, pull main).
- [ ] Check task type/fields/blockers; no unresolved dependency.
- [ ] For tooling work, confirm the open `[Stream]` container and that the task is its sub-issue with
      a matching `Stream` field option.
- [ ] Check remote-only suites: do not plan visible local runs; use the guard/hidden mode and plan
      the remote evidence run.
- [ ] Check docs/related issues for context.

## Check-in

- Assign owner identity (human or bot); add `Executor:` line for the agent.
- Set Status In Progress.
- Post the [check-in template](./comment-templates/check-in.md): owner, executor, branch, HEAD, scope, DoR, evidence plan, risks.
- Create branch `task/<issue>-<slug>`; open a draft/early PR with `Refs #` if useful.
- Do not start implementation before check-in is recorded.

## During work

- Commit with issue refs: `task(#123): ...`.
- Keep changes inside the task scope; defer discoveries into follow-up issues.
- Post updates at boundaries: done/next/blockers/scope/evidence.
- If blocked: Status Blocked + concrete reason/dependency/unblock condition; post [blocker](./comment-templates/blocker.md).
- If a session must stop: checkpoint comment with state/next/branch/PR; leave status accurate (In Progress or Blocked).
- If scope/estimate changes: [plan-change](./comment-templates/plan-change.md) + label + sprint/release/field updates.
- Run the local gates named in the task; capture output.

## Review / check-out

- Attach PR/evidence; set In Review only when ready for review.
- Verify acceptance criteria one by one; report deviations.
- Merge with `Closes #`; set Done; post [check-out](./comment-templates/check-out.md) with tests/evidence/follow-ups.
- Tooling profile: `done` requires the PR plus evidence; close the `[Stream]` container only after
  every child task is done and the release gate is green (`stream.mjs close --stream S`).
- Update parent sprint/release if exit/gates affected.
- Do not claim completion for unverified work; mark Blocked/defer instead.

## Multi-agent boundaries

- One owner per task; do not edit another owner's in-flight files without coordination.
- Partition write scopes (files/dirs) when agents work concurrently; record scopes on the task.
- The reviewer/integrator merges; agents should not bypass checks.
- Hand-off includes: task ID, branch, HEAD, what changed, what remains, evidence, risks.
- Never start a second task under the same owner while one is In Progress.

## Reviewer protocol

- Check process + content: acceptance, tests, evidence, docs, secrets, one-task scope.
- Request changes with specific links/lines; don't rewrite silently.
- Approve only when evidence is present; close/checkout after merge.

## Stop conditions

Stop and ask/block when:

- DoR is incomplete or acceptance is ambiguous.
- A dependency/blocker is unresolved.
- Secrets/credentials would be needed.
- Scope change would exceed the task/release.
- Verification fails and the fix is outside scope.
- Two tasks would be In Progress for one owner.

## Commands

Use [Reference](./REFERENCE.md) for exact commands/flags. Scripts are available now; manual fallbacks remain documented for UI-only or restricted environments. Report upstream via [Downstream feedback](./DOWNSTREAM_FEEDBACK.md) when the tracker itself is deficient.

## Branch hygiene (non-negotiable)

Install hooks once per clone: `npm run hooks:install`.

- `pre-commit` refuses commits on main/master and requires task/*, release/*, hotfix/*, or chore/*.
- `pre-push` refuses direct pushes to main/master.
- `post-checkout` warns when landing on main.
- Emergency overrides (`TRACKER_ALLOW_MAIN_COMMIT=1`, `TRACKER_ALLOW_MAIN_PUSH=1`) warn loudly and must be recorded.
- Do not issue unconditional `git checkout main`; assert the branch before committing. The main-history guard opens an OI for any main commit without a merged PR.
- CastDeck's private/personal plan cannot enforce remote branch protection; hooks, detection, and the release gate are the fallback, not a claim of platform enforcement.
