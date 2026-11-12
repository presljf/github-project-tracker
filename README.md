# Project Tracker OS

A portable, auditable GitHub project-tracker operating system: playbook, exhaustive docs, versioned config, bootstrap/audit/task CLIs, reusable CI/security workflows, release profiles, and downstream feedback intake.

**Status:** v1.2.2 validated; public template repository · **Docs version:** `v1.2.2-docs.1` · **License:** MIT

## Use this template

1. **Create a repo from this template** (GitHub **Use this template**) or copy the needed files into an existing repository.
2. **Read the quickstart:** [docs/QUICKSTART.md](docs/QUICKSTART.md) · **Handbook:** [docs/HOW_TO_USE.md](docs/HOW_TO_USE.md)
3. **Configure:** copy `tracker.config.example.json` → `tracker.config.json`; edit repo/project/releases/sprints/commands.
   ```bash
   node scripts/github/validate-config.mjs tracker.config.json
   # OK   tracker.config.json
   ```
4. **Bootstrap** (dry-run first):
   ```bash
   node scripts/github/bootstrap.mjs --config tracker.config.json --dry-run
   node scripts/github/bootstrap.mjs --config tracker.config.json --apply
   ```
   Bootstrap seeds valid default Area/Kind/Estimate (and Status/Release/Sprint/Source) so generated tasks pass DoR/audit; adjust any defaults for your project before check-in. Ensure `project.number` is the actual project number (task/audit require it). Expected output starts `Dry-run: N planned action(s); no mutations performed.` then `Applied N action(s).`
5. **Run one task through the lifecycle** with the task CLI or manual docs:
   ```bash
   node scripts/github/task.mjs start --issue 123 --owner YOUR_LOGIN
   # ... branch/PR/evidence ...
   node scripts/github/task.mjs done --issue 123 --evidence "tests pass"
   ```
6. **Replace the bootstrap task placeholder:** generated task bodies contain `- [ ] Fill a testable criterion.` Edit/check acceptance criteria before `task.mjs done` (or use `--force` after review).
7. **Audit:**
   ```bash
   node scripts/github/audit.mjs --config tracker.config.json --advisory
   ```

Expected output examples:

```text
$ node scripts/github/bootstrap.mjs --config tracker.config.json --dry-run
Dry-run: N planned action(s); no mutations performed.
$ node scripts/github/task.mjs status --issue 123
status #123: Todo; project status=Todo; assignee=(none)
$ node scripts/github/audit.mjs --config tracker.config.json --advisory
No violations.
```

Full adoption path: [docs/ADOPTION.md](docs/ADOPTION.md) · Template structure/versioning: [docs/TEMPLATE_REPO.md](docs/TEMPLATE_REPO.md).

## v1.1.0 tracker hardening plan

See [docs/ROADMAP_v1.1.0.md](docs/ROADMAP_v1.1.0.md): P0 rate-limit hardening, automated audit enforcement, existing follow-ups, and the CastDeck adoption gate.

## Documentation

- [Documentation index](docs/README.md)
- [Playbook](docs/GITHUB_PROJECT_TRACKER_PLAYBOOK.md) — model/rules
- [Quickstart](docs/QUICKSTART.md)
- [HOW TO USE](docs/HOW_TO_USE.md) — exhaustive handbook
- [Reference](docs/REFERENCE.md) — commands/fields/tokens/workflows
- [Task CLI](docs/TASK_CLI.md) — lifecycle commands
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Adoption](docs/ADOPTION.md) · [Upgrading](docs/UPGRADING.md)
- [Agent guide](docs/AGENT_GUIDE.md) · [Multi-project](docs/MULTI_PROJECT.md)
- [Actions catalog](docs/ACTIONS_CATALOG.md) · [CI/security profile](docs/CI_SECURITY_PROFILE.md) · [Release profiles](docs/RELEASE_PROFILES.md)
- [Docs style guide](docs/DOCS_STYLE_GUIDE.md) · [Reference cards](docs/reference-cards/README.md) · [Template repo guide](docs/TEMPLATE_REPO.md)
- [Guard distribution](docs/GUARD_DISTRIBUTION.md) — no-copy transport/scope enforcement
- [Downstream feedback](docs/DOWNSTREAM_FEEDBACK.md) · [Support](SUPPORT.md) · [Security](SECURITY.md)
- [Changelog](CHANGELOG.md) · [License](LICENSE)

## What’s included

| Area          | Artifacts                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Procedure     | playbook, HOW TO USE, reference, troubleshooting, adoption/upgrading, agent/multi-project docs |
| Config        | JSON Schema, generic + pilot examples, validator, comment/issue/PR templates                   |
| Automation    | bootstrap, audit (advisory/strict/JSON), task lifecycle CLI, tests                             |
| CI/security   | reusable CI/caller, Dependabot + dependency review, opt-in CodeQL, required-check runbook      |
| Release       | GitHub Release/macOS/container/package profiles with dry-run/skip guards                       |
| Downstream    | bug/feature forms, Source field, triage/versioning/no-fork policy                              |
| Profiles/docs | generic Node lint/format profile, printable reference cards (T13)                              |

## Repository layout

```
docs/                 docs, playbook, comment templates, reference cards
scripts/github/       bootstrap, audit, task CLI, validate-config, adapters
schemas/, examples/   config contract + examples
profiles/             Node and release profiles
tests/                dependency-free Node test suite (npm test)
.github/              issue/PR forms, CI/security/audit/release workflows
tracker.config.json   self-config for this repo
```

## Versioning and support

- Adopters pin `automation.templateVersion` exactly; see [Upgrading](docs/UPGRADING.md).
- Patch = compatible fixes; minor = compatible features; major = breaking changes.
- Template tag `v1.0.0` is created only after T08 replication/validation and T12 fresh-eyes docs QA.
- Best-effort support/no SLA; report bugs/features via [Downstream feedback](docs/DOWNSTREAM_FEEDBACK.md).
- Security: private reporting only per [SECURITY.md](SECURITY.md); no public vulnerability details.

## License

MIT — see [LICENSE](LICENSE). The template stays private through its own v1.0.0 validation; public transition follows the documented checklist in [docs/TEMPLATE_REPO.md](docs/TEMPLATE_REPO.md).
