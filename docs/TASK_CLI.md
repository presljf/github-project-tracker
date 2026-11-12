# TASK CLI

**Docs version:** v1.3.0-docs.1 · Status: available now

`scripts/github/task.mjs` implements the task lifecycle with DoR/WIP/DoD checks. It reads `tracker.config.json`, updates the Project Status field, assigns the owner, and posts standard comments.

```bash
node scripts/github/task.mjs <command> --issue N [--config tracker.config.json] [--dry-run] [--json]
```

Default: mutates. `--dry-run` validates and prints the planned result with no GitHub writes.

## Commands

| Command | Flags | Effect |
|---|---|---|
| `start` | `--issue`, `--owner`, `--executor`, `--branch NAME`, `--stream ISSUE` | Validates open/task/type/fields/acceptance/dependencies, WIP≤1, assigns owner, sets **In Progress**, posts check-in; optional git branch create/switch. `--stream` is required by the tooling work profile (the `[Stream]` container) and rejected by product mode |
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

## Work profiles

The enforcement matrix comes from `tracker.config.json` `workProfile` (`product` default, or
`tooling`). Absent config means `product`, so existing adopters are unchanged.

| | `product` | `tooling` |
|---|---|---|
| Container | `[Release]` → `[Sprint]` | `[Stream]` |
| DoR fields | Area/Kind/Estimate/Release/Sprint | Area/Kind/Estimate/Stream (+ `--stream` membership) |
| Milestone | required | optional (tag records the version) |
| `done` | evidence + checked acceptance | **PR required** + evidence + checked acceptance |

```bash
# tooling-profile start: --stream names the open [Stream] container; the task must be its sub-issue
node scripts/github/task.mjs start --issue 123 --owner presljf --executor agent:session \
  --stream 120 --branch task/123-tooling-docs

# tooling-profile done: PR + evidence are both required
node scripts/github/task.mjs done --issue 123 --pr https://github.com/OWNER/REPO/pull/45 \
  --evidence "npm test 137/137; lint/format/docs gates green"
```

Stream lifecycle (tooling profile): `node scripts/github/stream.mjs open|close` — see
[REFERENCE §5.4](./REFERENCE.md#54-stream-tooling-profile). `close` refuses while child tasks are
open, requires the release gate green, records `### Stream close evidence`, and records an optional
tag name. Product mode rejects the stream CLI; `[Stream]` containers are not closable by PR
closing keywords.

## DoR / WIP / DoD behavior

**start (product profile, default)** requires:
- open task issue (not a `[Sprint]`/`[Release]`/`[Program]`/`[Stream]` tracker)
- native type + milestone
- project item with Area/Kind/Estimate/Release/Sprint
- `## Acceptance criteria` section
- no blocked-by dependencies
- no other In Progress task for the owner (WIP limit)

**start (tooling profile)** requires the same checks except Release/Sprint/milestone, plus an open
`[Stream]` container supplied with `--stream` that: exists, is on the project, has a non-empty
`Stream` field, contains the task as a sub-issue, and matches the task's `Stream` field value.
Area/Kind/Estimate/Stream must be set on the task.

**done** requires evidence and no unchecked acceptance criteria; `--force` is an explicit override
after review. In the tooling profile `--pr` (PR URL or number) is also required, so a task cannot
be checked out without its PR being recorded; the audit flags closed tooling tasks that lack a
`### Check-out` comment. It does not run the tracker audit; run `audit.mjs`/release gates separately.

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

## Remote-only verification suites

When `tracker.config.json` declares `verification.remoteOnly[]`, run the guard before spawning a
declared suite (e.g. desktop GUI smoke). It is offline and uses `GITHUB_ACTIONS === 'true'` as the
only remote signal:

```bash
# local: blocked with workflow/label/override instructions (exit 1) unless hidden mode/override applies
node scripts/github/guard-local-suite.mjs --suite desktop-smoke

# hidden local mode (non-authoritative; only when the suite declares localMode: hidden)
node scripts/github/guard-local-suite.mjs --suite desktop-smoke --hidden

# verify aggregator: record the deferral instead of blocking (exit 0, DEFERRED_REMOTE line)
node scripts/github/guard-local-suite.mjs --suite desktop-smoke --mode report --json
```

Adopters typically wire the guard into their suite scripts (visible wrapper without `--hidden`,
hidden wrapper with it) and into the Playwright `globalSetup` via
`scripts/github/playwright-remote-guard.mjs`. Agents must never set the suite override env — it is
for deliberate human debugging only. Details: [REFERENCE §5.6](./REFERENCE.md#56-guard-local-suite-remote-only-verification-policy).

## Counts evidence

When `docs.counts` is configured, test-count evidence at check-out must come from the counted
inventory and the counts guard, not from remembered numbers:

```bash
node scripts/github/suite-counts.mjs check --suite unit --mode full --results test-results/unit.tap
node scripts/github/guard-docs-counts.mjs
```

`check` prints `COUNTS_OK ...` on zero drift and fails on count/skip drift, flaky > 0, or malformed
output; `guard:docs:counts` validates the baseline agreement metadata and generated doc/markers.
A counts change in the same task/PR must update the baseline + generated doc + markers together
(see [profiles/counts](../profiles/counts/README.md)).

## Availability

The task CLI is covered by `npm test` (mock adapter, happy/error/WIP/DoR/DoD/dry-run paths). T12 validates the real end-to-end lifecycle on a scratch issue before release. The tooling work profile, stream open/close lifecycle, and mode-aware audit are covered by `tests/work-profile.test.mjs` (DoR matrix, close gates, a closed rehearsal stream cycle, and audit positive/negative fixtures).


### Preflight

`start` blocks on uncommitted changes. Deliberate exception: `--allow-dirty --dirty-reason "why"`, recorded in the check-in comment.


## Lint/format self-check (T18)

Tracker OS now self-applies ESLint and Prettier: `npm ci`, `npm run lint`, and
`npm run format:check`. A missing or broken lint/format command fails CI rather than succeeding
as a no-op. Dev tooling is approved in `tracker.dependencies.json`; see issue #82.

`start` warns loudly in the check-in when `core.hooksPath` is not `.githooks`; run
`npm run hooks:install` before starting work.
