# Documentation index

**Docs version:** `v1.0.0-docs.1` (targets Project Tracker OS v1.0.0; refreshed before release)
**Status:** T11 authored; T12 fresh-eyes validation still required before the v1.0.0 tag.

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
| Run several projects/programs | [MULTI-PROJECT](./MULTI_PROJECT.md) |
| Understand the conceptual model | [Playbook](./GITHUB_PROJECT_TRACKER_PLAYBOOK.md) |
| Report a bug/feature upstream | [Downstream feedback](./DOWNSTREAM_FEEDBACK.md) · [reporting card](./reference-cards/reporting-upstream.md) |
| Security | [SECURITY.md](../SECURITY.md) |

**Automation availability:** the tracker CLI/bootstrap/audit scripts and reusable workflows are delivered in sprint 1.0.0.2+. Until they exist, use the manual/GitHub-UI paths in this suite. Planned commands are marked **planned** and have explicit manual fallbacks.

**Docs conventions:** shell snippets are copy-pasteable and show expected results; secrets are never shown; screenshots/diagrams are sanitized and reproducible (Mermaid or text snapshots). A style guide is planned in T13.

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
