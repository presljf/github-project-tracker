# github-project-tracker

Portable GitHub project-tracker operating system: playbook, exhaustive HOW TO USE docs, config schema/templates, generic Node profile, reusable Actions, release profiles, and downstream feedback intake.

**Docs version:** `v1.0.0-docs.1` (targets template v1.0.0; validation pending T12)

## Five-minute quickstart

> Full walkthrough: [docs/QUICKSTART.md](docs/QUICKSTART.md) · Handbook: [docs/HOW_TO_USE.md](docs/HOW_TO_USE.md)

1. **Auth + prerequisites**
   ```bash
   gh --version
   gh auth status   # token must include 'project'
   gh auth refresh -s project   # only if missing
   ```
2. **Create/link a project**
   ```bash
   gh project create --owner @me --title "Project Tracker"
   gh project link PROJECT_NUMBER --owner @me --repo OWNER/REPO
   ```
3. **Add fields/statuses** (UI): Status (`Todo`, `In Progress`, `In Review`, `Blocked`, `Done`), Release, Sprint, Area, Kind, Estimate, Source. Create a release milestone.
4. **Create sprint + task**, link them as sub-issues.
5. **Run one task through the loop:** check-in → branch `task/<issue>-<slug>` → PR `Closes #<issue>` → In Review → merge → Done → check-out.

That proves the tracker. Then read the docs below for fields/views, sprint/release closes, audit, agents, and adoption.

## Docs

- [Documentation index](docs/README.md)
- [Playbook](docs/GITHUB_PROJECT_TRACKER_PLAYBOOK.md) — conceptual model/rules
- [Quickstart](docs/QUICKSTART.md) — first tracker
- [HOW TO USE](docs/HOW_TO_USE.md) — exhaustive handbook
- [Reference](docs/REFERENCE.md) — commands/fields/tokens/workflows
- [Troubleshooting](docs/TROUBLESHOOTING.md) — symptom → cause → fix
- [Adoption](docs/ADOPTION.md) — zero→first task
- [Upgrading](docs/UPGRADING.md) — pin/upgrade/rollback
- [Agent guide](docs/AGENT_GUIDE.md) — agent operating protocol
- [Multi-project](docs/MULTI_PROJECT.md) — program/project/umbrella
- [Downstream feedback](docs/DOWNSTREAM_FEEDBACK.md) — report upstream
- [Support](SUPPORT.md) · [Security](SECURITY.md) · [Issue forms](https://github.com/presljf/github-project-tracker/issues/new/choose)

## Status

Project Tracker OS v1.0.0 is in active development. The template stays private through its own v1.0.0 validation; downstream adoption starts after release. Deeper docs are versioned with the template tag; T12 fresh-eyes validation is the release gate.
