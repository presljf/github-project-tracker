# Tooling work profile (Stream → Task)

An **enforced second work profile** for tooling streams whose delivery is unversioned until the tag
is cut. It uses the same DoR/WIP/evidence engine as product work — it is not a bypass.

| | `product` (default) | `tooling` |
|---|---|---|
| Lifecycle | `[Release]` → `[Sprint]` → Task | `[Stream]` → Task |
| Required fields | Area/Kind/Estimate + Release/Sprint | Area/Kind/Estimate + `Stream` |
| Version record | Release + Sprint keys | tag (if any), recorded at stream close |
| Start | `task.mjs start --issue N` | `task.mjs start --issue N --stream S` |
| Done | PR optional, evidence required | **PR required** + evidence, check-out comment |
| Container close | sprint/release close flow | `stream.mjs close` (open-children + release-gate gates) |
| Audit | Release/Sprint ancestry + fields | Stream ancestry + Stream field + stream close evidence |

`workProfile` is optional in `tracker.config.json`; absent means `product`. Absent Stream field in
the product profile is ignored, so existing boards keep working unchanged.

## Files

| File | Purpose |
|---|---|
| `tracker.config.example.json` | Valid tooling-profile config: `workProfile: "tooling"`, `fields.Stream`, empty `releases` (the tag is the version record) |
| this README | Profile selection, stream lifecycle, and adoption notes |

## Adopt the tooling profile

1. Declare the profile and Stream field in `tracker.config.json`:
   ```json
   {
     "workProfile": "tooling",
     "fields": {
       "Stream": { "options": ["v1.3.1"] },
       "Area": { "options": ["docs", "ci", "code"] },
       "Kind": { "options": ["feature", "fix", "infra", "docs"] },
       "Estimate": { "options": ["S", "M", "L"] }
     },
     "releases": []
   }
   ```
   `fields.Stream.options` is the initial set of per-delivery options; new deliveries are appended
   safely by `project-field-option.mjs` / `stream.mjs open` (existing option ids, colours, and item
   values are preserved).
2. Validate and bootstrap: `node scripts/github/validate-config.mjs tracker.config.json`, then
   `node scripts/github/bootstrap.mjs --config tracker.config.json --apply` creates the `Stream`
   project field.
3. Open a delivery container:
   ```bash
   node scripts/github/stream.mjs open --name v1.3.1 --delivery "Documentation & maintenance"
   ```
4. Create tasks as **sub-issues** of the `[Stream]` issue; set their `Stream` field to the same
   delivery option. Start each task with:
   ```bash
   node scripts/github/task.mjs start --issue <task> --owner <login> \
     --executor "agent:<name>" --stream <stream-issue> --branch task/<issue>-<slug>
   ```
   Tooling DoR requires Stream membership + Stream field + Area/Kind/Estimate + acceptance + no
   blockers; WIP = 1, assignee and check-in rules are identical to the product profile.
5. Close the delivery container after the tag/release flow:
   ```bash
   node scripts/github/stream.mjs close --stream <stream-issue> \
     --evidence "npm test 137/137; release gate green; tag v1.3.1 recorded" --tag v1.3.1
   ```
   `close` refuses while child tasks are open, requires the release gate green, records
   `### Stream close evidence`, sets Status Done, and closes the container. Tag creation itself
   stays with the release flow.

## Notes

- Historical product records remain valid: audit rules are selected by `workProfile`; closed
  `[Release]`/`[Sprint]` exit-evidence rules only apply in the product profile.
- Milestones are optional in the tooling profile (the tag is the version record); native types and
  required issue sections are still enforced.
- `done` in the tooling profile requires `--pr` (URL or number) plus `--evidence`, and the audit
  flags closed tooling tasks that have no `### Check-out` evidence comment.
- Streams are not closed by PR closing keywords; `guard:pr-close` rejects `Closes #` against a
  `[Stream]` container.
