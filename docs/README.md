# Documentation index

**Docs version:** `v1.3.2-docs.1` (targets Project Tracker OS v1.3.2; refreshed before release)
**Status:** T12 docs QA fixes applied; v1.0.0 tag follows T08 live validation + release close.

Read in this order depending on your goal:

| Goal | Start here |
|---|---|
| Set up a tracker quickly | [Quickstart](./QUICKSTART.md) |
| Learn the full operating procedure | [HOW TO USE](./HOW_TO_USE.md) |
| Look up a command, field, status, token, or workflow | [REFERENCE](./REFERENCE.md) |
| Fix a failure | [TROUBLESHOOTING](./TROUBLESHOOTING.md) |
| Adopt the tracker in a project | [ADOPTION](./ADOPTION.md) |
| Upgrade a pinned tracker version | [UPGRADING](./UPGRADING.md) |
| Operate as an agent | [AGENT GUIDE](./AGENT_GUIDE.md) |
| Use the task CLI | [TASK CLI](./TASK_CLI.md) |
| Work on CI/security/actions | [ACTIONS CATALOG](./ACTIONS_CATALOG.md) · [CI/SECURITY PROFILE](./CI_SECURITY_PROFILE.md) |
| Release a project | [RELEASE PROFILES](./RELEASE_PROFILES.md) |
| Print quick-reference cards | [Reference cards](./reference-cards/README.md) |
| Use the repository as a template | [TEMPLATE REPO](./TEMPLATE_REPO.md) |
| Review bot-identity decision | [GITHUB APP SPIKE](./GITHUB_APP_SPIKE.md) |
| Run several projects/programs | [MULTI-PROJECT](./MULTI_PROJECT.md) |
| Understand the conceptual model | [Playbook](./GITHUB_PROJECT_TRACKER_PLAYBOOK.md) |
| Report a bug/feature upstream | [Downstream feedback](./DOWNSTREAM_FEEDBACK.md) · [reporting card](./reference-cards/reporting-upstream.md) |
| Security | [SECURITY.md](../SECURITY.md) |
| Docs QA evidence | [DOCS VALIDATION](./DOCS_VALIDATION.md) |
| v1.1.0 execution plan | [ROADMAP v1.1.0](./ROADMAP_v1.1.0.md) |
| Guard adoption | [GUARD DISTRIBUTION](./GUARD_DISTRIBUTION.md) |
| Docs coverage enforcement | [DOCS COVERAGE](./DOCS_COVERAGE.md) |

**Automation availability:** bootstrap, audit, task CLI, reusable CI/security, and release profiles are implemented. Planned contracts are labeled; manual fallbacks remain documented.

**Docs conventions:** shell snippets are copy-pasteable and show expected results; secrets are never shown; screenshots/diagrams are sanitized and reproducible (Mermaid or text snapshots). See the [style guide](./DOCS_STYLE_GUIDE.md).

## Coverage map

| Area | Quickstart | HOW TO USE | Reference | Troubleshooting |
|---|---|---|---|---|
| Auth/project scope | ✓ | ✓ | ✓ | ✓ |
| New/existing repo setup | ✓ | ✓ | ✓ | ✓ |
| Fields/statuses/views | quick | full | full | ✓ |
| Task lifecycle | demo | full | transitions | ✓ |
| Sprint/release close | link | full | templates | ✓ |
| Agents/multi-project | link | roles | — | boundary failures |
| Audit/CI/releases | link | full | matrices | ✓ |
| Downstream/upgrades | link | full | versioning | ✓ |

## Versioning note

All docs target the template version pinned in `tracker.config.json`. When the template changes, docs/version/changelog must move together; T12 validates the final set before the v1.0.0 tag.
