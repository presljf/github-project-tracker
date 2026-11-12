# UPGRADING

**Docs version:** v1.2.2-docs.1 · Target template: v1.2.2
The tracker is versioned; downstream projects pin an exact version and upgrade deliberately.

## Version semantics

| Change | Version | Examples |
|---|---|---|
| Compatible bug fix | **patch** `vX.Y.Z` | broken workflow, docs/config fix, security patch |
| Compatible feature | **minor** `vX.Y+1.0` | new profile, new optional config field, new caller |
| Breaking change | **major** `vX+1.0.0` | config key removal/rename, status/field contract change, required workflow change |

- Downstream config records `automation.templateVersion` (exact, e.g. `1.0.0`).
- No `main` tracking; no silent sync.
- Patch/minor upgrades should be low-risk; major upgrades require a migration plan.

## Before upgrading

- [ ] Read the target changelog/release notes/migration notes.
- [ ] Confirm your current pin (`automation.templateVersion`).
- [ ] Check copied-file/overrides list in your project docs.
- [ ] Ensure no uncommitted work in copied config/workflows.
- [ ] Know rollback: previous tag/commit + config pin.

## Copy vs reusable

| Mode | Upgrade action | Notes |
|---|---|---|
| Thin callers/reusable workflows | Update pinned ref/version; keep project caller/config | preferred when access validated |
| Copied callers/composite actions | Re-copy template files; re-apply project-specific changes | document diffs/overrides |
| Both (mixed) | Track each file's origin/mode | audit should flag stale pins |

Never edit a reusable workflow in the downstream repo; override via inputs/config. For copied files, record the template version used.

## Upgrade procedure

1. **Read** target changelog + diff/overrides.
2. **Dry-run** in a branch:
   ```bash
   git checkout -b chore/upgrade-tracker-1.2.2
   ```
3. Update:
   - `tracker.config.json` (`automation.templateVersion`, new optional fields);
   - caller workflow refs/tags (pin exact tag/SHA);
   - copied files (re-copy + re-apply overrides).
4. **Validate config:**
   ```bash
   node scripts/github/validate-config.mjs tracker.config.json
   # OK   tracker.config.json
   ```
5. Run local/CI checks; keep audit advisory in the upgrade PR.
6. Update docs/version references and downstream tracking issue.
7. Merge; run audit; record new pin.
8. If broken, roll back per §Rollback.

## Migration notes template

```markdown
## Migration — tracker vOLD → vNEW

- **Breaking changes:** ...
- **Config changes:** ...
- **Copied-file changes:** ...
- **Workflow/token changes:** ...
- **Manual steps:** ...
- **Rollback:** reset pin to vOLD, restore files from tag/commit
- **Verification:** config validate + CI + audit + smoke
```

## Optional: adopt the tooling work profile

v1.3.0 adds an optional `workProfile` (`product` default, or `tooling`) plus an optional
`fields.Stream` declaration. No action is required for existing adopters: absent `workProfile`
keeps the current Release → Sprint behaviour, and a declared `Stream` field is ignored in
`product` mode.

To adopt `tooling`:

1. Set `"workProfile": "tooling"` and declare `"fields": { "Stream": { "options": ["vX.Y.Z"] } }`.
   Tooling-only repos may drop Release/Sprint fields and use `"releases": []` (the tag is the
   version record); mixed repos may keep both declarations.
2. Validate and bootstrap:
   ```bash
   node scripts/github/validate-config.mjs tracker.config.json
   node scripts/github/bootstrap.mjs --config tracker.config.json --apply
   ```
3. Open deliveries with `node scripts/github/stream.mjs open --name vX.Y.Z --delivery "..."` and
   start tasks with `node scripts/github/task.mjs start --issue N --stream S`.
4. Historical product records keep working: audit rules follow `workProfile`, so Release/Sprint
   exit-evidence and hierarchy rules do not apply to a tooling profile.
5. Rollback: set `workProfile` back to `product` (or remove it); no data migration is needed.

See [profiles/tooling](../profiles/tooling/README.md) and [REFERENCE §5.3–5.5](./REFERENCE.md#5-tracker-cli).

## Rollback

- Revert the upgrade PR **or** restore the previous tag/commit for copied files.
- Reset `automation.templateVersion` to the previous exact version.
- Re-run config validation/CI.
- If the failure is upstream, open a downstream bug report with the version/error; document the workaround.

Do not force-push over teammates' changes; use a revert PR.

## Changelog requirements

Every template release documents:

- version and date;
- patch/minor/major classification;
- breaking changes + migration;
- config/workflow/token changes;
- docs/reference updates;
- known issues.

## Downstream tracking

For each adopted project, track the upgrade as a task/issue:

- link the upstream release/changelog;
- optionally mark blocked-by the upstream release;
- include migration/evidence;
- update the pin in the same PR;
- close after audit/checks pass.

## Compatibility policy

- Document minimum `gh`/Node/runner versions.
- Private reusable access may change visibility; copy fallback must remain documented.
- Template v1.0.x patches are compatible; v1.1.0 adds features; v2.0.0 may break.
- If a project needs an unsupported change, prefer an upstream issue/contract extension over a local fork.

## Docs versioning

Docs carry `vX.Y.Z-docs.N`; update docs with the template version. T12 validates docs before release; downstream should refresh linked docs on upgrade.


## Lint/format self-check (T18)

Tracker OS now self-applies ESLint and Prettier: `npm ci`, `npm run lint`, and
`npm run format:check`. A missing or broken lint/format command fails CI rather than succeeding
as a no-op. Dev tooling is approved in `tracker.dependencies.json`; see issue #82.
