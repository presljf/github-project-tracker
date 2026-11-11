# Docs validation report (T12)

**Docs version:** v1.0.0-docs.1 · **Target template:** v1.0.0
**Status:** T12 docs QA evidence complete; v1.0.0 tag follows T08 live validation + release close
**Rule:** docs must match implemented commands/config/workflows; stale docs are defects.

## Automated validation

| Check | Command | Result |
|---|---|---|
| Config contract/examples | `node scripts/github/validate-config.mjs` | OK (generic + pilot examples) |
| Full test suite | `npm test` | 36/36 pass |
| Bootstrap (read-only) | `node scripts/github/bootstrap.mjs --config tracker.config.json --dry-run` | plan printed; **0 mutations** |
| Tracker audit | `node scripts/github/audit.mjs --config tracker.config.json --strict` | 0 violations, 21 issues / 21 project items |
| Task CLI status | `node scripts/github/task.mjs status --issue 17 --config tracker.config.json` | reads title/state/assignee/status/fields |
| Reference cards | `node scripts/docs/build-cards.mjs --check` | 7/7 current; 14/14 PDFs one page |
| Workflow/action/template YAML | Ruby YAML parse over `.github/**/*.yml` | OK |
| Markdown links/anchors/fences | `npm run docs:check` | 47 Markdown files; no broken links/anchors/fences |
| Secret scan | `npm run docs:check` (includes secret patterns) | none |
| Actionlint | `actionlint` binary | unavailable in this environment; workflow YAML parsed; T12 records limitation, T08 exercises real workflows |

Coverage is tracked in the docs index and these docs:

- Playbook: model/rules; HOW TO USE: lifecycle/tasks/sprints/releases/roles; REFERENCE: commands/fields/statuses/tokens/workflows; TASK CLI: command flags/DoR/WIP/DoD; ADOPTION/UPGRADING: onboarding/pinning; ACTIONS CATALOG/CI SECURITY PROFILE/RELEASE PROFILES: workflow contracts/tokens/runners/releases; DOWNSTREAM FEEDBACK/SUPPORT/SECURITY: reporting; template repo guide: structure/versioning/tagging.

## T12 fixes applied

1. **REFERENCE §5** replaced the stale “planned tracker CLI” section with current bootstrap/audit/task commands/flags.
2. **REFERENCE §12–16, file map, availability key** updated from planned → implemented for bootstrap/audit/task, workflows/actions, release profiles, cards, style guide, template guide.
3. **docs/README** updated: automation availability, style-guide link, index entries for task CLI/actions/CI/release/cards/template/App spike.
4. **Playbook §10 anchor** made unambiguous; ACTIONS CATALOG/RELEASE PROFILES links fixed.
5. **ACTIONS CATALOG §7.2** reconciled from draft `run-*`/`package-manager` inputs to the actual `reusable-ci.yml` inputs (`node-version`, `working-directory`, `tracker-config`, `install-command`, `lint-command`, `format-command`, `test-command`, `build-command`, outputs `result`/`checks-passed`); required-check contexts documented.
6. **ACTIONS CATALOG §7.5/§10.1** updated for actual release profiles/composite actions and an implementation-status table (implemented vs contract-only).
7. **Reference cards** regenerated after anchor changes; A4/Letter one-page checks still pass.
8. **Known platform limitation** documented in [CI/security runbook §3.2](./CI_SECURITY_PROFILE.md#32-current-platform-state-verified-2026-11-11): branch protection/rulesets unavailable on private personal repo (403); apply when public/Pro. CI checks themselves run/enforce visibility.

## Fresh-eyes review

- A fresh, uninvolved agent session reviewed the docs-only path (see [fresh-eyes report](./FRESH_EYES_T12.md)). Findings: wrong pin key, stale planned wording, workflow-catalog/implemented status drift, schema/command mapping mismatch, and unverifiable claims. All blockers/should-fix items were addressed in T12; nits are recorded as deferred.
- The live scratch project setup → bootstrap → task lifecycle → audit is executed by **T08** against this template; that transcript is the live end-to-end evidence and is **not yet recorded** in this file.
- Human final review is recorded at release close before tagging.

## Release gate

T12 evidence feeds release tracker [#2](https://github.com/presljf/github-project-tracker/issues/2) and is required before the v1.0.0 tag. Remaining deferrals are explicit: live scratch (T08), actionlint unavailable, branch protection pending public/Pro.
