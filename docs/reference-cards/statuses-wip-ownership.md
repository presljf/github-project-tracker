# Statuses, WIP & ownership

<!-- Docs version: v1.3.0-docs.1 · Target template: v1.3.0 · print formats: A4, Letter -->

> One page for the five statuses, the one-task WIP rule, and who owns what. Full detail: [HOW TO USE §2, §5.2, §17](../HOW_TO_USE.md#2-roles).

## Statuses

| Status | Meaning | Set when |
|---|---|---|
| Todo | Ready, not started | DoR incomplete or work not picked |
| In Progress | Owner is working | DoR passes; check-in posted |
| In Review | Ready for review | PR + evidence attached |
| Blocked | Cannot proceed | Concrete reason + dependency linked |
| Done | Accepted and evidenced | Check-out posted; issue closed |

## Allowed transitions

| From → To | Entry condition | Evidence |
|---|---|---|
| Todo → In Progress | DoR passes, owner + branch | Check-in comment |
| In Progress → In Review | Implementation ready | PR/evidence |
| In Review → In Progress | Changes requested | Review comment |
| In Progress → Blocked | Concrete blocker | Blocker comment + blocked-by |
| Blocked → In Progress | Blocker cleared | Unblock note |
| In Review → Done | Accepted + evidenced | Check-out comment |
| Done → Todo/In Progress | Regression or follow-up | Comment + plan-change if scope |

## WIP = 1

- One **In Progress** task per owner (human or agent identity).
- A second In Progress task is a violation unless a dated `plan-change` documents the exception and timebox.
- Finish, block, or defer before starting another task; audit flags WIP violations.

## Ownership

| Role | Responsible for | Not responsible for |
|---|---|---|
| Owner | Check-in/out, status, evidence | Silent scope growth |
| Executor (human/agent) | Doing the work under the owner | Self-merging without evidence |
| Reviewer | Acceptance, evidence, quality | Rewriting history |
| Maintainer | Triage, sprint/release close, tokens | Bypassing security rules |

One owner identity per task. If a human delegates to an agent, record `Owner:` and `Executor:` separately in the check-in.

## Blocked and plan changes

- **Blocked** needs reason + dependency link + impact + unblock condition; post the blocker template.
- **Plan change:** dated `plan-change` comment (old → new, why) + label + sprint/release/Project field updates + defer equivalent scope. Never rewrite history.

## Status is authoritative

The Project **Status** field drives the board; comments and labels are context, not state. Do not use `status:blocked` as a status. Keep one source of truth.

Links: [HOW TO USE §5.2](../HOW_TO_USE.md#52-statuses-and-transitions) · [REFERENCE §7–8](../REFERENCE.md#7-fields-statuses-transitions) · [AGENT GUIDE](../AGENT_GUIDE.md)
