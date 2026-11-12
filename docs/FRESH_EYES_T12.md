# Fresh-eyes docs review — T12

**Date:** 2026-11-11
**Reviewer:** independent uninvolved agent session (`app-layer`; no tracker implementation context)
**Mode:** read-only; no repository/GitHub mutations; temp validation files removed
**Snapshot:** HEAD `35a0800` + T12 working-tree fixes
**Verdict:** after the fixes below, the manual UI/`gh` and bootstrap → task CLI → audit paths are documented and tested end-to-end in the T08 scratch project; template patch v1.2.0 carries the GraphQL adapter fix found by T08.

## Checks run

- config validation (`validate-config.mjs`) OK
- `npm test` 37/37
- cards `--check` 7/7 current; A4+Letter one-page
- independent Markdown scan: 0 broken links/anchors, balanced fences
- bootstrap dry-run: 11 actions / 0 mutations
- audit advisory + strict: 21 issues / 21 items, 0 violations
- task `status` read-only: works; CLI help matches docs
- YAML parse all `.github` workflows/actions/forms: OK
- `actionlint`: unavailable in review environment

## Blockers found and resolved

1. **Wrong template pin key.** Docs/forms/card used `trackerTemplateVersion`; canonical config key is `automation.templateVersion` (schema + audit). Added the documented key to a config, validator fails `$.trackerTemplateVersion: is not allowed`.
   **Resolved:** all docs/forms/card references changed to `automation.templateVersion`; cards regenerated.
2. **Shipped automation described as “planned”.** Quickstart, HOW TO USE, ADOPTION, TROUBLESHOOTING, playbook, and bootstrap dry-run output contradicted README/REFERENCE.
   **Resolved:** availability/status text updated for bootstrap/audit/task/workflows/release profiles; bootstrap runtime note updated.

3. **Bootstrap → first-task blocker.** Bootstrap-created task items had Status/Release/Sprint/Source but not Area/Kind/Estimate; `task.mjs start` failed DoR (`Area is empty`) and audit reported 12 missing-field violations. **Resolved:** bootstrap now seeds valid defaults for Area/Kind/Estimate; an integration test runs `bootstrap --apply` → task start → audit and passes. README/QUICKSTART/ADOPTION now state the required fields and defaults.

## Should-fix found and resolved

| Finding | Resolution |
|---|---|
| ACTIONS CATALOG said only tracker-audit existed; mixed shipped with contract-only workflows | status/availability paragraphs updated; shipped vs contract-only explicit |
| REFERENCE workflow catalog implied E2E/desktop smoke shipped | availability note added; contract-only labeled |
| CI_SECURITY_PROFILE said T09 catalog open/commands not in schema | catalog merged note; `workflows.ci.commands` added to schema; REFERENCE updated |
| actionlint/test-count evidence conflict | actionlint qualified as T15-reported/unavailable in T12; tests updated 35/35 |
| Phantom link checker; unverifiable fresh-eyes/T08 claims | added `scripts/docs/check-docs.mjs` (`npm run docs:check`); this report records fresh-eyes; T08 remains pending, not claimed |
| Release status wording inconsistent | README/docs index/changelog/validation aligned: release candidate, tag pending T08 + release close |
| Bootstrap runtime “audit planned” | now points to `audit.mjs` advisory/strict |
| Quickstart Kind options drift | aligned to feature/fix/ux/spike/test/infra |
| Node prerequisite wording | Node >=22 required for CLI/automation, optional for pure UI path |

## Second fresh-eyes round (additional fixes)

- Copy-into-existing-repo docs now list `scripts/github/**`, `schemas/`, `package.json`, `profiles/`, `tests/`.
- `project.number` is now required by the schema/docs; examples show it.
- Quickstart sets native issue type + milestone; README tells users to replace/check the bootstrap acceptance placeholder before `done`.
- Audit docs no longer overclaim native-type fallback, duplicate/retired labels, or secret scanning.
- Checksum examples use repo-root working directory; audit actions pinned by SHA; `TRACKER_TOKEN` fixed-name documented.
- T08 live scratch: bootstrap apply 51 actions; re-run 1 action/no creates; task lifecycle complete; strict audit 0 violations. v1.0.0 GraphQL options defect fixed in v1.2.0.

## Deferred nits / limitations

- TOCs on some >200-line pages and a few unlabeled output fences: style nits, not link/command blockers; T13 style guide remains authoritative.
- `actionlint` unavailable in T12 environment; T08 must run it where available.
- Branch protection/rulesets unavailable on private personal repo (403); apply when public/Pro.
- Live `bootstrap --apply`, task lifecycle writes, views/workflows/types setup, release dispatch/publishing/signing, and cross-repo reusable access are **not** verified by docs review; T08 covers the scratch end-to-end path.
