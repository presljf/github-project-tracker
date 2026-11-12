# TASK CLI

**Docs version:** v1.0.2-docs.1 · Status: available now

`scripts/github/task.mjs` implements the task lifecycle with DoR/WIP/DoD checks. It reads `tracker.config.json`, updates the Project Status field, assigns the owner, and posts standard comments.

```bash
node scripts/github/task.mjs <command> --issue N [--config tracker.config.json] [--dry-run] [--json]
```

Default: mutates. `--dry-run` validates and prints the planned result with no GitHub writes.

## Commands

| Command | Flags | Effect |
|---|---|---|
| `start` | `--issue`, `--owner`, `--executor`, `--branch NAME` | Validates open/task/type/milestone/fields/acceptance/dependencies, WIP≤1, assigns owner, sets **In Progress**, posts check-in; optional git branch create/switch |
| `checkpoint` | `--issue`, `--message` or `--message-file` | Posts an Update comment; status unchanged |
| `review` | `--issue`, `--pr URL`, `--evidence TEXT` | Sets **In Review**, posts review/evidence comment |
| `block` | `--issue`, `--reason`, `--blocked-by URL` | Sets **Blocked**, optionally adds native blocked-by, posts blocker note |
| `done` | `--issue`, `--evidence` or `--evidence-file`, `--pr URL`, `--force` | Verifies unchecked acceptance (unless `--force`), sets **Done**, closes issue, posts check-out |
| `status` | `--issue` | Read-only status/fields/assignees; use `--json` for machine-readable fields |

## Examples

```bash
# start (fails if DoR/WIP checks fail)
node scripts/github/task.mjs start --issue 123 --owner presljf --executor agent:session

# dry-run start: no mutations
node scripts/github/task.mjs start --issue 123 --dry-run

# checkpoint
node scripts/github/task.mjs checkpoint --issue 123 --message "Done: ...\nNext: ..."

# review with PR/evidence
node scripts/github/task.mjs review --issue 123 --pr https://github.com/OWNER/REPO/pull/45 --evidence "tests pass"

# blocked
node scripts/github/task.mjs block --issue 123 --reason "waiting on #99" --blocked-by https://github.com/OWNER/REPO/issues/99

# done
node scripts/github/task.mjs done --issue 123 --evidence "npm test 18/18; link check clean"

# status
node scripts/github/task.mjs status --issue 123
```

## DoR / WIP / DoD behavior

**start** requires:
- open task issue (not a `[Sprint]`/`[Release]`/`[Program]` tracker)
- native type + milestone
- project item with Area/Kind/Estimate/Release/Sprint
- `## Acceptance criteria` section
- no blocked-by dependencies
- no other In Progress task for the owner (WIP limit)

**done** requires evidence and no unchecked acceptance criteria; `--force` is an explicit override after review. It does not run the tracker audit; run `audit.mjs`/release gates separately.

## Ownership and comments

- `--owner` overrides `automation.defaultAssignee`; `--executor` overrides `TRACKER_EXECUTOR`/default.
- `start` posts the check-in template; `done` posts the check-out template; `block` posts the blocker template.
- Status field is authoritative; comments are the audit trail.

## Expected outputs

```text
$ node scripts/github/task.mjs status --issue 17
status #17: In Progress; project status=In Progress; assignee=presljf
fields: {"release":"v1.0.0",...}

$ node scripts/github/task.mjs start --issue 123
start #123: applied
### Check-in ...
```

## Errors / exit codes

Exit 1 with an actionable message on: missing/invalid config, missing issue, tracker issue instead of task, missing fields/type/milestone/acceptance, blocked dependency, WIP violation, missing evidence, unchecked acceptance without `--force`, or GitHub API failure. `--dry-run` makes no mutations.

## Availability

The task CLI is covered by `npm test` (mock adapter, happy/error/WIP/DoR/DoD/dry-run paths). T12 validates the real end-to-end lifecycle on a scratch issue before release.


### Preflight

`start` blocks on uncommitted changes. Deliberate exception: `--allow-dirty --dirty-reason "why"`, recorded in the check-in comment.
