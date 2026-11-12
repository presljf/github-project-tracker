# Downstream feedback

**Docs version:** v1.0.2-docs.1 · Target template: v1.0.2

This repository is the **upstream source of truth** for the Project Tracker OS. If your project adopts the tracker template, you are a **downstream project**. Report bugs and feature requests here — do not fork the template or keep fixes only in your project. The intake path (forms → labels → Project → triage → close) is validated end to end; see [Publication and security checklist](./PUBLICATION.md) and [T04](#validation-v11) below.

## Before reporting

- Check the existing issues and the pinned version's docs.
- Confirm you are using a supported version (see [SECURITY.md](../SECURITY.md)); unsupported snapshot reports may be deferred.
- Check [UPGRADING](./UPGRADING.md) first if you are mid-upgrade.
- For a vulnerability, **do not open a public issue** — use the private channel in [Security reports](#security-reports).

## Report a bug

Open a **[downstream bug report](https://github.com/presljf/github-project-tracker/issues/new?template=downstream-bug.yml)** and include:

- originating project/program and repository
- pinned `automation.templateVersion` (exact, e.g. `1.0.2`)
- environment/runtime versions (`gh`, Node, OS, shell)
- what you did, expected vs actual behavior
- reproduction steps or minimal example
- impact and any workaround
- link to your downstream issue/PR, if any

The form applies the `source:downstream` and `status:needs-triage` labels automatically.

## Request a feature

Open a **[downstream feature request](https://github.com/presljf/github-project-tracker/issues/new?template=downstream-feature.yml)** and include:

- originating project/program and pinned version
- the problem/use case, not just a proposed implementation
- desired behavior and alternatives considered
- impact/urgency (best-effort; no SLA)
- link to your downstream issue/PR, if any

## Security reports

**GitHub private vulnerability reporting is enabled on this repository.** Use the **Security** tab → **Report a vulnerability** (<https://github.com/presljf/github-project-tracker/security/advisories/new>). Do not open a public issue, discussion, or PR with vulnerability details, secrets, or exploit steps.

Include affected version/commit, environment, reproduction, impact, and suggested mitigation. Reports and advisories stay private until coordinated disclosure; see [SECURITY.md](../SECURITY.md).

## Triage and labels

Downstream issues are triaged by a maintainer:

1. **Add to the Project if needed.** Auto-add normally places new issues on the board; if it did not, run:
   ```bash
   gh project item-add 2 --owner presljf --url https://github.com/presljf/github-project-tracker/issues/N
   ```
2. **Set the Project Source field** to the originating project. `Source` options are board-specific; when no dedicated option exists for that project, use `Other` and name the project in the issue or triage comment. This repository normally offers `Internal`, `CastDeck`, and `Other`.
3. **Keep `source:downstream`; remove `status:needs-triage`** once the issue is triaged (`gh issue edit N --remove-label status:needs-triage`). The status label marks untriaged intake only; the Project **Status** field remains the authoritative work state.
4. **Set the native type** (Bug/Feature) and Project fields: Area, Kind, Estimate, and — when scheduled — Release and Sprint. Set the milestone to match the release.
5. **Post a decision comment:** accept, defer, or needs-info, with rationale and the fixing release when known.
6. **Link both ways:** upstream issue ↔ downstream issue/PR; when scheduled, link the fixing release. Closing the issue moves its Project item to Done (validated path).

The board's **Downstream** view filters downstream/intake items; the `Source` field keeps origin scalable without adding a label per project.

## Versioning and upgrades

- **Patch** (`v1.0.x`): compatible fixes.
- **Minor** (`v1.1.0`): compatible features.
- **Major** (`v2.0.0`): breaking changes with migration notes.
- Downstream projects pin an **exact** version (`automation.templateVersion`) and upgrade explicitly with the changelog/migration guide; see [UPGRADING](./UPGRADING.md).
- When a fix ships, open/complete a downstream upgrade issue; it may be blocked by the upstream release/tag.
- Report issues against the pinned version and update the pin only after reading migration notes and validating locally.

## No forks, contributions, and support

- **No forks.** Temporary local workarounds must be documented with an upstream issue link and removed after the fix/upgrade ships.
- Small, well-scoped fixes/features are welcome as PRs; larger changes should start as an issue so scope/contract impact can be agreed first. PRs must use the templates and pass CI; docs changes are part of the change.
- Best-effort triage; **no SLA**. Security reports use the private channel only.

## Validation (v1.1)

The downstream intake path was exercised end to end for v1.1.0: a scratch bug report and a scratch feature request were filed with the forms' field/label payload (via CLI, to reproduce the form output; UI rendering was not automated), labelled, added to the Project, triaged via `Source`/type/fields with a recorded decision, and closed not-planned (Project status Done). Evidence is recorded in [PUBLICATION](./PUBLICATION.md) and task #42. Repeat this walkthrough at least once per release cycle and whenever the forms, labels, or triage fields change.

## Related

- [Publication and security checklist](./PUBLICATION.md)
- [Security policy](../SECURITY.md) · [Support](../SUPPORT.md)
- [Playbook](./GITHUB_PROJECT_TRACKER_PLAYBOOK.md) · [Upgrading](./UPGRADING.md)
- [Issue forms](https://github.com/presljf/github-project-tracker/issues/new/choose)


## Lint/format self-check (T18)

Tracker OS now self-applies ESLint and Prettier: `npm ci`, `npm run lint`, and
`npm run format:check`. A missing or broken lint/format command fails CI rather than succeeding
as a no-op. Dev tooling is approved in `tracker.dependencies.json`; see issue #82.
