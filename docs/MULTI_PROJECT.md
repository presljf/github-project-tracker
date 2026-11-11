# MULTI-PROJECT

**Docs version:** v1.0.0-docs.1 · Target template: v1.0.0
Guidance for running several projects/programs on the tracker without collapsing into one mega-board.

## Model

| Entity | Scope | Board | Version line |
|---|---|---|---|
| Program | long-lived stream (product/platform) | one project board | own releases |
| Project | repo/service/app within a program or standalone | one board (or shared program board by explicit choice) | own or program version |
| Downstream | project adopting the tracker template | own board | pins tracker version |
| Umbrella (optional) | cross-program overview only | separate, read-only-ish | none |

Default: **per-project boards authoritative; umbrella later.** Do not duplicate tasks into multiple boards; use links/fields.

## Keeping boards coherent

- Same status model and fields across projects; extend fields rather than adding labels.
- Use `Source` on the tracker board for upstream feedback; downstream project keeps its own board.
- Cross-project blockers use native "blocked by" links; if unavailable, link in body/comments.
- Gate pattern: program release trackers blocked by a gate issue; gate blocked by upstream release; adoption children blocked by upstream.
- Do not mark program-level status Blocked on every task; block roadmap/release trackers/gate.

## Tokens and identity

- One owner identity per task; human/agent Executor recorded.
- Project-scoped token per tracker/program where feasible; least privilege.
- No shared personal tokens in CI; prefer GitHub App/OIDC for automation.
- Downstream projects should not use the template maintainer's token.

## Versioning across projects

- Each project pins its own tracker version; upgrades are independent.
- One project may stay on v1.0.x while another moves to v1.1.0; no forced sync.
- Track upgrades in each project's tracker; link upstream changelog.
- Shared conventions (statuses/fields) come from the template version; document local extensions.

## When to split or merge

**Split a board** when: unrelated version lines, different owners, conflicting statuses/fields, or one program's work drowns another.
**Merge/share a board** only when: same program, same release cadence, same owner, and cross-project filtering is genuinely needed.
**Umbrella** only when cross-program reporting is required; keep it derived/linked; don't make it the source of work state.

## Adoption order

1. Stabilize one project board and lifecycle.
2. Add downstream feedback link.
3. Add a second project only after the first proves audit/close discipline.
4. Add umbrella last; make it read-only-ish.

## Multi-project checklist

- [ ] Each project has its own board, fields/statuses, release milestones.
- [ ] Source field distinguishes downstream/upstream.
- [ ] Cross-repo dependencies/gates explicit.
- [ ] Tokens scoped per project; no shared secrets.
- [ ] Upgrade pins tracked per project.
- [ ] Umbrella, if any, links rather than duplicates state.
- [ ] Audit cadence defined; exceptions recorded.
