# Task lifecycle

<!-- Docs version: v1.2.2-docs.1 · Target template: v1.2.2 · print formats: A4, Letter -->

> Move a task from Todo to Done without hidden work. Full procedure: [HOW TO USE §7–10](../HOW_TO_USE.md#7-find-work-and-definition-of-ready).

## Flow

`Todo → In Progress → In Review → Done`; side path `In Progress ↔ Blocked`; a reopened `Done` item gets a dated comment and goes back to Todo/In Progress.

## 1. Start — Definition of Ready

- Goal/non-goals clear; acceptance criteria testable.
- Test/evidence plan named; dependencies/blockers linked and resolved.
- Fields set: Release, Sprint, Area, Kind, Estimate; Source if downstream.
- Native type present; no unresolved blocker.

Then: assign owner → Status **In Progress** → post check-in (owner, executor, branch, HEAD, scope, evidence plan) → branch `task/<issue>-<slug>` from `main` → WIP = 1.

## 2. During work

- Commit `task(#123): ...`; push early; open a draft/early PR with `Refs #123`.
- Comment at boundaries: done / next / blockers / evidence.
- Scope or estimate change: dated `plan-change` comment + label + sprint/release/field updates.
- Session ends: checkpoint comment with state, next, branch, PR. Keep status accurate — no silent WIP.

## 3. Review — Definition of Done

- Status **In Review** only when the PR and evidence are ready; PR body uses `Closes #123`.
- Reviewer checks: acceptance criteria, required checks, tests run, docs updated, no secrets/live calls, one task/one PR, deviations recorded.

## 4. Check out

- Merge (`gh pr merge --squash --delete-branch`), confirm issue closed, Status **Done**.
- Post check-out: acceptance checked, commits/PR, tests/gates, evidence, deviations, follow-ups, parent updated.
- Update the parent sprint/release tracker if exit criteria are affected.

## CLI shortcuts

```bash
node scripts/github/task.mjs start --issue 123 --owner OWNER --executor agent:session
node scripts/github/task.mjs checkpoint --issue 123 --message "Done: ... Next: ..."
node scripts/github/task.mjs review --issue 123 --pr PR_URL --evidence "tests pass"
node scripts/github/task.mjs done --issue 123 --evidence "npm test 11/11; checks green"
```

Manual fallback: `gh project item-edit` for Status, `gh issue comment` for check-in/out. Full commands: [TASK CLI](../TASK_CLI.md) and [REFERENCE §4–7](../REFERENCE.md#4-gh-commands-used-in-this-tracker).

## Required comment fields

**Check-in:** Owner · Executor · Branch · Starting HEAD · Scope confirmed · DoR · Evidence planned · Risks/blockers → Status In Progress.

**Check-out:** Acceptance criteria · Commits/PR · Tests/gates · Evidence · Deviations · Follow-ups · Parent sprint/release updated → Status Done; issue closed.

Templates: [check-in](../comment-templates/check-in.md) · [check-out](../comment-templates/check-out.md) · [blocker](../comment-templates/blocker.md)
