# Fresh-eyes docs review — T12

**Date:** 2026-11-11
**Reviewer:** independent uninvolved agent session (`app-layer`; no tracker implementation context)
**Mode:** read-only; no repository/GitHub mutations; temp validation files removed
**Snapshot:** HEAD `35a0800` + T12 working-tree fixes
**Verdict:** qualified yes — the manual UI/`gh` → task CLI → audit path is usable from docs after the fixes below; live scratch apply/lifecycle evidence remains T08.

## Checks run

- config validation (`validate-config.mjs`) OK
- `npm test` 35/35
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

## Deferred nits / limitations

- TOCs on some >200-line pages and a few unlabeled output fences: style nits, not link/command blockers; T13 style guide remains authoritative.
- `actionlint` unavailable in T12 environment; T08 must run it where available.
- Branch protection/rulesets unavailable on private personal repo (403); apply when public/Pro.
- Live `bootstrap --apply`, task lifecycle writes, views/workflows/types setup, release dispatch/publishing/signing, and cross-repo reusable access are **not** verified by docs review; T08 covers the scratch end-to-end path.
