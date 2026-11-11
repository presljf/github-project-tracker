# Reference card — reporting upstream

**Project Tracker OS · downstream feedback · v1.0.0-docs.1**

## Where

- Bug: `New issue → Downstream bug report`
- Feature: `New issue → Downstream feature request`
- Security: **never public** — follow `SECURITY.md`
- Docs: `docs/DOWNSTREAM_FEEDBACK.md`

## Must include

- [ ] Originating project + repo
- [ ] Pinned tracker version (exact)
- [ ] Environment (`gh`, Node, OS, runner)
- [ ] What happened
- [ ] Repro steps / minimal example
- [ ] Expected vs actual
- [ ] Impact / workaround
- [ ] Downstream issue/PR link

## What happens

1. Maintainer sets `Source`, labels `source:downstream`, `status:needs-triage`.
2. Triages type/area/kind/estimate/release; accepts, defers, or asks for info.
3. Fix ships in patch/minor/major; downstream tracks an upgrade issue blocked by the upstream release.
4. Downstream pins the exact new version; no forks.

## Rules

- Best effort, **no SLA**.
- No secrets, tokens, or vulnerability details in public issues.
- Small PRs welcome; larger changes need an issue first.
