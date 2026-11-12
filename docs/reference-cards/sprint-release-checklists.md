# Sprint & release checklists

<!-- Docs version: v1.2.1-docs.1 · Target template: v1.2.1 · print formats: A4, Letter -->

> Printable close gates for sprints and releases. Full lifecycle: [HOW TO USE §11–12](../HOW_TO_USE.md#11-sprint-lifecycle).

## Sprint kickoff

- [ ] All tasks pass DoR; dependencies linked.
- [ ] Sprint tracker Status **In Progress**; goal/tasks/risks announced.
- [ ] Parent release tracker verified; scope fits the sprint window.

## Sprint during

- [ ] Track child issues via the board; update the sprint only for blockers, deferrals, scope changes.
- [ ] WIP = 1 per owner; plan changes dated + labelled.

## Sprint close

- [ ] All children Done or explicitly deferred with a `plan-change` link.
- [ ] Post sprint demo/exit comment: goal, outcome, evidence, carried-over, risks.
- [ ] Close the sprint issue; update parent release tracker.
- [ ] Acceptance: no Done sprint with open children unless deferral is recorded.

## Release kickoff

- [ ] Release tracker **In Progress**; scope/sprints/gates/rollback/artifacts confirmed.
- [ ] Required checks and tokens ready; dry-run defaults documented.
- [ ] Every gate has an owner and evidence expectation.

## Release during

- [ ] Update the release tracker at each sprint close: completed scope, risks, decisions, estimate changes.
- [ ] Do not duplicate sprint status; resolve blockers at the release level.

## Release close

- [ ] Every gate checked with linked evidence.
- [ ] Tag matches versions; build/publish artifacts + checksums (`SHA256SUMS`).
- [ ] Release notes + docs updated; milestone/release tracker closed.
- [ ] Final summary posted; known issues + rollback documented.
- [ ] No close with open child sprints unless explicitly deferred.

## Close blockers — fix before exit

- Unchecked acceptance criteria or missing evidence: not Done.
- Open child issues without a `plan-change` deferral: sprint/release not closeable.
- Unresolved known risk or no rollback plan: release not closeable.
- Parent tracker not updated: the close is incomplete.

## Evidence to attach

Commands + results, artifact checksums, workflow run links, audit summary, and any deviation. Rollback: revert the release PR or restore the previous exact tag/commit and reset `automation.templateVersion`.

Links: [sprint-close](../comment-templates/sprint-close.md) · [release-close](../comment-templates/release-close.md) · [REFERENCE §16](../REFERENCE.md#16-release-profiles) · [UPGRADING](../UPGRADING.md#rollback)
