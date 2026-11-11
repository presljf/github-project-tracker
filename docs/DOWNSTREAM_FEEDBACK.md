# Downstream feedback

**Docs version:** v1.0.1-docs.1 · Target template: v1.0.1

This repository is the **upstream source of truth** for the Project Tracker OS. If your project adopts the tracker template, you are a **downstream project**. Report bugs and feature requests here — do not fork the template or keep fixes only in your project.

## Before reporting

- Check the existing issues and the pinned version's docs.
- Confirm you are using the tracker's current supported version (see `SECURITY.md` / release notes).
- For a vulnerability, **do not open a public issue**. Follow `SECURITY.md`.

## Report a bug

Open a **[downstream bug report](https://github.com/presljf/github-project-tracker/issues/new?template=downstream-bug.yml)** and include:

- originating project/program and repository
- pinned `automation.templateVersion` (exact, e.g. `1.0.0`)
- environment/runtime versions (`gh`, Node, OS, shell)
- what you did, expected vs actual behavior
- reproduction steps or minimal example
- impact and any workaround
- link to your downstream issue/PR, if any

## Request a feature

Open a **[downstream feature request](https://github.com/presljf/github-project-tracker/issues/new?template=downstream-feature.yml)** and include:

- originating project/program and pinned version
- the problem/use case, not just a proposed implementation
- desired behavior and alternatives considered
- impact/urgency (best-effort; no SLA)
- link to your downstream issue/PR, if any

## Triage and labels

Downstream issues are triaged by a maintainer:

1. Set the Project **Source** field to the originating project.
2. Apply `source:downstream` and `status:needs-triage`.
3. Set the native type (Bug/Feature) and Project Area/Kind/Estimate/Release/Sprint.
4. Decide accept/defer/needs-info with a comment, then remove `status:needs-triage`.
5. Link the upstream issue with the downstream issue and, when scheduled, link the fixing release.

`Source` keeps origin scalable without adding a label per project. The tracker board's **Downstream** view filters downstream/intake items.

## Versioning and upgrades

- **Patch** (`v1.0.x`): compatible fixes.
- **Minor** (`v1.1.0`): compatible features.
- **Major** (`v2.0.0`): breaking changes with migration notes.
- Downstream projects pin an **exact** version (`automation.templateVersion`) and upgrade explicitly with the changelog/migration guide.
- No forks. Temporary local workarounds must be documented with an upstream issue link.
- When a fix ships, open/complete a downstream upgrade issue; it may be blocked by the upstream release/tag.

## Contributions

Small, well-scoped fixes/features are welcome as PRs. Larger changes should start as an issue so scope/contract impact can be agreed first. PRs must use the templates and pass CI; docs changes are part of the change.

## Support

Best-effort triage; **no SLA**. `status:needs-triage` marks untriaged intake. Security reports use the private channel only.

## Related

- [Playbook](./GITHUB_PROJECT_TRACKER_PLAYBOOK.md)
- [Support](../SUPPORT.md)
- [Security policy](../SECURITY.md)
- [Issue forms](https://github.com/presljf/github-project-tracker/issues/new/choose)
