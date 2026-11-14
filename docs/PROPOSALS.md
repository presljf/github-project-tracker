# Proposals

Proposals are board-managed intake. They are visible and managed on the project board, but they
are not delivery tasks until accepted.

## Contract

- Title: `[Proposal] <short title>`
- Native type: `Feature`
- Label: `status:proposed`
- Board status: `Proposed` (or `Deferred`)
- Board fields: `Area`, `Kind`, `Estimate`, `Source`; `Priority` when the project has it
- No `Release`, `Sprint`, or `Stream` requirement
- No milestone, task sections, or task hierarchy requirement

Required body sections:

```markdown
## Problem / context
## Proposal
## Value
## Scope
## Non-goals
## Dependencies / blockers
## Decision needed
## Acceptance when accepted
```

Use `node scripts/adopt/cli/proposal.mjs template` for the scaffold.

## Audit

Open `[Proposal]` issues are classified as proposals. The audit requires the proposal label, body
sections, project item, `Proposed` status, and core fields. It does not require a milestone,
delivery container, task ancestry, or task body sections.

## CLI

```bash
# Scaffold
node scripts/adopt/cli/proposal.mjs template

# Import an existing free-form issue
node scripts/adopt/cli/proposal.mjs import --issue 169 --body-file /tmp/proposal-169.md \
  --area cross --kind infra --estimate M --source Internal

# Dry run
node scripts/adopt/cli/proposal.mjs import --issue 169 --body-file /tmp/proposal-169.md --dry-run

# List proposals
node scripts/adopt/cli/proposal.mjs list

# Accept into a tooling Stream (converts in place)
node scripts/adopt/cli/proposal.mjs accept --issue 169 \
  --title "[v1.5.0-T01] Implement proposals" --stream 200

# Accept into a product Release/Sprint
node scripts/adopt/cli/proposal.mjs accept --issue 169 \
  --title "[0.6.1-T01] Implement proposals" \
  --release 10 --sprint 11 --milestone v0.6.0

# Defer or reject
node scripts/adopt/cli/proposal.mjs defer --issue 169 --reason "Not this release"
node scripts/adopt/cli/proposal.mjs reject --issue 169 --reason "Out of scope"
```

The import is idempotent for the title prefix and label, adds the issue to the project if needed,
and sets the Feature type and board fields. It fails closed when the body is missing required
sections or the project does not have the `Proposed` status option.

## Board setup

Add the status option before importing:

```bash
node scripts/adopt/cli/project-field-option.mjs \
  --config tracker.config.json --field Status --option Proposed
node scripts/adopt/cli/project-field-option.mjs \
  --config tracker.config.json --field Status --option Deferred
```

Add `Proposed` and `Deferred` to `statuses` in `tracker.config.json` so config validation and
bootstrap preserve them. Create the `status:proposed` and `status:deferred` labels once.

## Lifecycle

- `Proposed` — intake; no delivery fields.
- `Deferred` — intake explicitly deferred; still no delivery fields.
- **Accept** converts the same issue in place:
  - task title and full task body;
  - `Task` native type;
  - Release/Sprint or Stream field and, for product, the milestone;
  - sub-issue link under the target container;
  - `Status = Todo`;
  - removes the proposal labels and records `### Proposal accepted`.
- **Reject** sets `Status = Done`, records the reason, and closes the issue as not planned.

Acceptance never creates a duplicate issue, so comments, links, and history stay attached.
