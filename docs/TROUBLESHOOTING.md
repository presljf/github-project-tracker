# TROUBLESHOOTING

**Docs version:** v1.2.0-docs.1 · Target template: v1.2.0
Symptom → cause → fix. Run `gh --version` and `gh auth status` first; many failures are auth/scope/ID issues.

## Contents

- [Auth and project scope](#auth-and-project-scope)
- [Issues, types, and hierarchy](#issues-types-and-hierarchy)
- [Project fields/views](#project-fieldsviews)
- [Issue forms / templates](#issue-forms-templates)
- [Labels and single-source](#labels-and-single-source)
- [Tokens / CI / Actions](#tokens-ci-actions)
- [Audit / WIP / process](#audit-wip-process)
- [Bootstrap / scripts / upgrades](#bootstrap-scripts-upgrades)
- [Network / limits / platform](#network-limits-platform)
- [Downstream feedback](#downstream-feedback)
- [Quick diagnostics](#quick-diagnostics)

## Auth and project scope

### `your authentication token is missing required scopes`
**Cause:** `gh` token lacks `project` (Projects v2).
**Fix:**
```bash
gh auth refresh -s project,repo
gh auth status
# - Token scopes: 'repo', 'project', ...
```
Org repos may also require SSO authorization in the browser.

### `Could not resolve to a ProjectV2`
**Cause:** wrong owner/number, token lacks access, or org SSO.
**Fix:** `gh project list --owner @me` / `--owner ORG`; confirm number; re-auth with org access.

### `Resource not accessible by integration`
**Cause:** Actions token lacks project permissions, or App not installed on the project/repo.
**Fix:** use a project-scoped PAT/GitHub App token for audit; do not use the default `GITHUB_TOKEN` for Projects v2 writes.

## Issues, types, and hierarchy

### Native issue types unavailable
**Cause:** personal/plan/org setting.
**Fix:** use the documented fallback (project `Kind`) and record it; do not create duplicate type labels. Audit only exempts the documented fallback.

### `Type` field rejected
**Cause:** `Type` is reserved in Projects v2.
**Fix:** use `Kind` (or another non-reserved name).

### Sub-issue API returns 404/422
**Cause:** feature unavailable, wrong parent/child ID, or child already has a parent.
**Fix:** verify native sub-issues are enabled; use `issue.id` (database ID), not number; detach/remove existing parent first; fallback to body links + labels.

### Duplicate/incorrect parent progress
**Cause:** task linked to wrong sprint/release.
**Fix:** remove the sub-issue link, re-add under the correct parent, update Release/Sprint fields.

## Project fields/views

### `Could not resolve to a node with the global id of 'PVTI_...'`
**Cause:** item ID from another project or stale output.
**Fix:** `gh project item-list PROJECT_NUMBER --owner @me --format json --limit 100`; use the current `id`. Do not reuse IDs from docs/examples.

### `single-select-option-id` fails
**Cause:** option ID isn't from that field, or field was recreated.
**Fix:** `gh project field-list`; use `options[].id` for the same field; verify with `item-list`.

### Option order/status values not updating
**Cause:** editing the wrong field/option or a cached board.
**Fix:** refresh project; `field-list` to confirm; use item-edit with exact IDs; check GraphQL errors.

### Views/filters missing
**Cause:** project view not created or filter syntax invalid.
**Fix:** create/edit in UI; use source field filter like `source:Downstream` (case-sensitive); update view via GraphQL if needed.

### Built-in workflow not setting Done
**Cause:** workflow disabled or item not in project.
**Fix:** enable auto-add + close→Done; verify issue is a project item; manually set Done if needed.

## Issue forms / templates

### Issue form invalid / not showing
**Cause:** YAML syntax, unknown field type, duplicate `id`, missing `validations`.
**Fix:** parse YAML locally (`ruby -e 'require "yaml"; YAML.load_file("...")'` or a YAML linter); check GitHub issue-form schema; ensure unique ids; labels exist.

### Contact link 404
**Cause:** target URL repo/path changed or private docs not visible.
**Fix:** update `.github/ISSUE_TEMPLATE/config.yml` to existing docs; avoid planned files in contact links until they exist.

### Template not applied
**Cause:** file not under `.github/ISSUE_TEMPLATE/`, wrong case, or repo default settings.
**Fix:** confirm path/name; check Settings → Issues → issue templates; refresh.

## Labels and single-source

### Duplicate dimension labels
**Cause:** convenience labels added alongside fields.
**Fix:** remove `area:*`, `release:*`, `sprint:*`, `type:*`; keep only risk/process; update audit/docs.

### `status:blocked` vs Status Blocked disagreement
**Cause:** transitional label left behind.
**Fix:** Status field is authoritative; remove the label after adoption; document exceptions.

## Tokens / CI / Actions

### Audit job fails: `Resource not accessible...`
**Cause:** missing project scope or token secret.
**Fix:** create project-scoped PAT/App token; store `TRACKER_TOKEN`; grant least privilege; never print it. For fork PRs, do not expose secrets.

### Workflow can't find reusable workflow
**Cause:** private cross-repo access restricted, or wrong repo/ref.
**Fix:** validate access; use copy fallback (thin callers/composite actions) or make template public; pin a tag/SHA, not `main`, for stability.

### Required check stuck/pending
**Cause:** job name changed, workflow skipped, or path filter.
**Fix:** update branch protection required-check names; make path-filtered required jobs always run a no-op; check Actions logs.

### `pull_request_target` security warning
**Cause:** running untrusted PR code with secrets.
**Fix:** remove `pull_request_target` from untrusted paths; split privileged publish workflows; use environments/approvals.

### Release workflow publishes unexpectedly
**Cause:** no dry-run/environment gate.
**Fix:** default `dryRun: true`; require tag/environment approvals; never publish from PRs; protect tags.

## Audit / WIP / process

### Audit reports missing fields
**Cause:** item not on board, fields not set, or wrong project.
**Fix:** add item; set Release/Sprint (release work), Area/Kind/Estimate, Source downstream; re-run advisory audit.

### WIP violation
**Cause:** >1 In Progress task per owner.
**Fix:** finish/block/defer one; comment exception + plan-change if unavoidable; update status.

### Parent Done with open children
**Cause:** sprint/release closed early.
**Fix:** reopen parent, finish/defer children with dated plan-change, then close.

### Task In Progress without assignee/check-in
**Cause:** status moved without process.
**Fix:** add owner + check-in comment, or return to Todo/Blocked. No silent WIP.

### Stale task / session ended
**Cause:** no checkpoint.
**Fix:** post state/next/branch/PR; set Blocked if needed; hand off explicitly.

### `plan-change` missing
**Cause:** scope/estimate changed silently.
**Fix:** add dated plan-change comment retroactively with old→new and why; update trackers/fields.

## Bootstrap / scripts / upgrades

### `bootstrap.mjs` fails midway
**Cause:** partial resources, permission, duplicate names, or invalid config.
**Fix:** run with `--dry-run`; read the error path; rerun idempotently; never delete user data to force it. Manual fallback: create missing fields/views/labels by UI.

### Config validation fails
**Cause:** missing required key, extra key, duplicate options, secret-looking value, templateRepo without version.
**Fix:**
```bash
node scripts/github/validate-config.mjs tracker.config.json
# FAIL ... $path: message
```
Fix the `$path`; re-run until `OK`.

### Upgrade breaks adopted project
**Cause:** breaking major change, copied files diverged, or stale pin.
**Fix:** roll back to the pinned version/commit; read `UPGRADING.md` migration notes; re-apply copy fallback; never force-push over local changes.

### Config/copied files drift
**Cause:** manual edits not recorded; template upgrade overwrote.
**Fix:** record local overrides in the project docs/config; re-apply after upgrade; open upstream issue if the generic contract is insufficient.

## Network / limits / platform

### Rate limit / secondary rate limit
**Cause:** too many API calls (bootstrap/migration), especially GraphQL project mutations.
**Fix:** run `npm run rate-limit` and use response headers, not just `/rate_limit`; wait for reset, reduce concurrency/batches, keep ≥1s between mutations. The transport handles primary/secondary failures without blind mutation retries; see [REFERENCE](./REFERENCE.md#rate-limit-behavior).

### `connection refused` / TLS / 502/503
**Cause:** transient network/API.
**Fix:** retry with backoff; verify `gh auth status`; check GitHub status; don't repeat destructive steps blindly.

### Windows quoting/backticks
**Cause:** PowerShell differences.
**Fix:** use Git Bash/WSL for bash snippets; in PowerShell use backticks and `ConvertFrom-Json`; see [Reference](./REFERENCE.md#17-shell-notes).

### Docs link broken
**Cause:** path renamed or planned doc not created.
**Fix:** update link; mark planned docs in index/table; run `npm run docs:check` before merging docs.

## Downstream feedback

### Report is missing origin/version/context
**Cause:** reporter used generic issue form.
**Fix:** ask for the downstream form fields; add `Source` and `source:downstream`; if accepted, schedule/link the downstream issue.

### Vulnerability details posted publicly
**Cause:** security report used public issue.
**Fix:** hide/delete details where possible, ask reporter to follow `SECURITY.md`; record incident; do not repeat details.

### Downstream fork diverges
**Cause:** local fix without upstream issue.
**Fix:** require an upstream issue link; document workaround; plan upgrade when fix ships.

## Quick diagnostics

```bash
gh --version
gh auth status
gh project list --owner @me --format json
gh project field-list PROJECT_NUMBER --owner @me --format json
gh project item-list PROJECT_NUMBER --owner @me --format json --limit 100
node scripts/github/validate-config.mjs tracker.config.json
```

If none of this solves it: capture the exact command, exit code, sanitized stderr, and expected/actual in a downstream feedback issue. Never include tokens/secrets.
