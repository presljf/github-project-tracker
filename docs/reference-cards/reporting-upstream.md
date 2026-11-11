# Reporting upstream

<!-- Docs version: v1.0.1-docs.1 · Target template: v1.0.1 · print formats: A4, Letter -->

> One page for downstream projects reporting bugs/features upstream. Policy: [DOWNSTREAM FEEDBACK](../DOWNSTREAM_FEEDBACK.md).

## Where to report

| Report | Channel |
|---|---|
| Bug | GitHub issue form **Downstream bug report** |
| Feature | GitHub issue form **Downstream feature request** |
| Vulnerability | **Never public** — private channel in [SECURITY.md](../../SECURITY.md) |
| Question/usage | Docs first ([HOW TO USE](../HOW_TO_USE.md), [TROUBLESHOOTING](../TROUBLESHOOTING.md)) |

Issue forms: `https://github.com/presljf/github-project-tracker/issues/new/choose`

## Bug vs feature

| | Bug | Feature |
|---|---|---|
| Report | Actual behavior contradicts documented behavior | Problem/use case not covered |
| Required | Repro + expected vs actual + versions | Problem, desired behavior, alternatives |
| Outcome | Fix in patch/minor, with upgrade note | Accepted, deferred, or needs-info decision |

## Must include

- [ ] Originating project/program + repository link.
- [ ] Pinned **exact** tracker version (`automation.templateVersion`).
- [ ] Environment: OS, Node, `gh`, shell/runner.
- [ ] What happened; reproduction steps or minimal example.
- [ ] Expected vs actual behavior (logs with secrets redacted).
- [ ] Impact and any workaround.
- [ ] Downstream issue/PR link.

## Triage and follow-through

1. Maintainer sets Project **Source**, labels `source:downstream` + `status:needs-triage`.
2. Type/Area/Kind/Estimate/Release/Sprint set; decision posted: accept, defer, or needs-info.
3. Fix ships under patch/minor/major versioning; release notes + changelog updated.
4. Downstream opens an upgrade issue, blocked by the upstream release when needed.
5. Upgrade deliberately: read migration notes, update the exact pin, validate, record evidence.

## Versioning and no-fork policy

| Change | Version |
|---|---|
| Compatible fix | Patch `v1.0.x` |
| Compatible feature | Minor `v1.1.0` |
| Breaking change | Major `v2.0.0` + migration notes |

- Pin an exact version; never track `main`; no forks — document temporary workarounds with an upstream issue link.
- Small, well-scoped PRs are welcome; larger changes need an upstream issue first and must pass CI.
- Support is best effort, **no SLA**. No secrets, tokens, or vulnerability details in public issues.

Links: [DOWNSTREAM FEEDBACK](../DOWNSTREAM_FEEDBACK.md) · [UPGRADING §version semantics](../UPGRADING.md#version-semantics) · [SECURITY.md](../../SECURITY.md)
