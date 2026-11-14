# Proposals

Proposals are board-managed intake. They are visible and managed on the project board, but they
are not delivery tasks until accepted.

## Contract

- Title: `[Proposal] <short title>`
- Native type: `Feature`
- Label: `status:proposed`
- Board status: `Proposed`
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
```

The import is idempotent for the title prefix and label, adds the issue to the project if needed,
and sets the Feature type and board fields. It fails closed when the body is missing required
sections or the project does not have the `Proposed` status option.

## Board setup

Add the status option before importing:

```bash
node scripts/adopt/cli/project-field-option.mjs \
  --config tracker.config.json --field Status --option Proposed
```

Add `Proposed` to `statuses` in `tracker.config.json` so config validation and bootstrap preserve it.

## Acceptance

Acceptance/conversion to a delivery task is a follow-up command. It will add the task title
prefix, full task body, milestone, and Release/Sprint/Stream fields, and move the item to `Todo`.
Until then, proposals remain in `Proposed` and are not counted as delivery work.
