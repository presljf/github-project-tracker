# AGENT GUIDE

**Docs version:** v1.0.1-docs.1 · Target template: v1.0.1
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

## Session start

- [ ] Read the task issue (Why, goal, non-goals, acceptance, test/evidence, deps).
- [ ] Confirm DoR; if missing, do not start — comment what is missing.
- [ ] Check WIP: no other In Progress task for this owner.
- [ ] Confirm branch/base and repo state (`git status`, pull main).
- [ ] Check task type/fields/blockers; no unresolved dependency.
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
