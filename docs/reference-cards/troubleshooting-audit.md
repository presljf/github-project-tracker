# Troubleshooting & audit

<!-- Docs version: v1.2.1-docs.1 · Target template: v1.2.1 · print formats: A4, Letter -->

> First-response fixes and the audit checklist. Full catalog: [TROUBLESHOOTING](../TROUBLESHOOTING.md) · [HOW TO USE §13](../HOW_TO_USE.md#13-audit).

## Quick triage

| Symptom | Likely cause | Fix |
|---|---|---|
| `token is missing required scopes` | `gh` OAuth token lacks `project` | `gh auth refresh -s project` |
| `Could not resolve to a ProjectV2` | Wrong owner/number or token scope | Re-check `gh project list`; refresh scope |
| `Could not resolve to a node with the global id` | Stale/placeholder item ID | Re-read `gh project item-list`; use fresh ID |
| Required check stuck/pending | Path-filtered required workflow | Remove path filter; keep required job always-on |
| Audit: `Resource not accessible` | Missing project token/scope | Fix `TRACKER_TOKEN` scope; never widen blindly |
| WIP violation | Two In Progress tasks for one owner | Finish/block/defer one; document exception |
| Parent Done with open children | Closed before children finished | Reopen or record explicit deferral with plan-change |
| `Config validation fails` | Bad JSON/field/option mismatch | Run validator; fix against config schema |
| Release published unexpectedly | Missing tag/dispatch/environment guard | Stop and rotate tokens; add guards; dry-run default |
| Stale docs link | Renamed heading/file | Update relative link or add redirect-safe anchor |

## Quick diagnostics

```bash
gh --version && gh auth status
gh project list --owner @me --format json
gh project field-list PROJECT_NUMBER --owner @me --format json
node scripts/github/validate-config.mjs tracker.config.json
node scripts/github/audit.mjs --config tracker.config.json --advisory
```

## Audit checklist (10 invariants)

- [ ] Open release work has milestone + native type.
- [ ] Project fields complete (Release/Sprint for release work; Area/Kind/Estimate; Source for downstream).
- [ ] No Done parent with open children unless deferral is recorded.
- [ ] No In Progress without assignee + check-in.
- [ ] WIP ≤ 1 per owner (or documented exception).
- [ ] Blocked has reason + dependency link.
- [ ] No duplicate/retired labels.
- [ ] Sprint/release Done has exit evidence.
- [ ] Template version pinned; downstream context complete.
- [ ] No secrets in issues/comments/artifacts.

Advisory in CI first; required at release gates once stable. Audit token is project-scoped and never logged.

## Escalate

Capture exact command, exit code, and sanitized stderr; check [TROUBLESHOOTING](../TROUBLESHOOTING.md) first. If the tracker itself is deficient, report downstream with pinned version and environment — never include tokens or vulnerability details.
