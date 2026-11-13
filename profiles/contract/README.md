# Contract + metadata profile

Reusable-mode caller for the tracker's contract and metadata verification. One pinned reusable
workflow replaces the two workflows adopters copied separately in v1.3.x — `tracker-contract.yml`
(pinned tooling + adoption-contract checks) and `tracker-metadata.yml` (live Project metadata
checks) — while keeping the same two verification outcomes.

- Interface contract: [ACTIONS CATALOG §7.10](../../docs/ACTIONS_CATALOG.md#710-reusable-contractyml-contract-metadata-verification-contract).
- Workflow catalog entry and behavior: [ACTIONS CATALOG §2.8](../../docs/ACTIONS_CATALOG.md#28-tracker-contract-metadata-verification).
- Copy-mode caller example (non-runnable): [tracker-contract.yml](./tracker-contract.yml).
- Reusable workflow: [`.github/workflows/reusable-contract.yml`](../../.github/workflows/reusable-contract.yml).
- Template's own caller (dogfooding): [`.github/workflows/tracker-contract.yml`](../../.github/workflows/tracker-contract.yml).

Adopting this caller is the v1.4.0 contract-verification path (required adoption step; see
[ADOPTION](../../docs/ADOPTION.md)). v1.4.0 is the first release that ships
`reusable-contract.yml`; older pins keep their old copied workflows. `profiles/` is never executed
by GitHub: copy the caller into `.github/workflows/` and pin the adopted template tag/SHA before it
can run.

## What it verifies

Two independent jobs:

| Job | Checks | When |
|---|---|---|
| `contract` | Optional version guard, pinned-tracker fetch, `verify-tooling` (tooling versions/config + pinned `.tracker-os` tag), `verify-contract` (adoption contract) | Every call, offline, no secrets |
| `metadata` | `verify-metadata`: live Project fields/options/issue types/hierarchy against the adoption contract | Only when `metadata: true`; requires `TRACKER_TOKEN` |

Check contexts produced by a caller job named `tracker-contract`:
`tracker-contract / contract` and `tracker-contract / metadata`.

## Interface

| Input | Type | Default | Meaning |
|---|---|---|---|
| `tracker-ref` | string | `v1.3.2` | Exact template tag/SHA to load the adoption contract and verification tooling from. Downstream: the tag you adopted. Self mode (`tracker-ref: ''`): the caller checkout. |
| `config-path` | string | `tracker.config.json` | Tracker config path (repository-root-relative; resolved under `working-directory`). Affects `verify-tooling` only. |
| `contract-path` | string | `''` | Adoption contract path (repository-root-relative or absolute). Empty auto-detects `contract/adoption-contract.json` in self mode and `.tracker/contract/adoption-contract.json` downstream. |
| `runs-on` | string | `ubuntu-latest` | Runner label for both jobs. |
| `version-guard-command` | string | `''` | Optional trusted, offline version-consistency command run before the contract checks (for example `node scripts/version-guard.mjs`). Never fetched at runtime. |
| `metadata` | boolean | `true` | Run the live metadata job. Requires `TRACKER_TOKEN`; pass `false` on fork PRs. |
| `working-directory` | string | `'.'` | Project working directory used by the verification commands. |
| `submodule-path` | string | `.tracker-os` | Tracker submodule whose pinned tag `verify-tooling` checks; a missing/non-git path logs a notice and skips that check. |
| `node-version` | string | `'22'` | Node.js version used by the verification tooling. |

Outputs: `contract-ok` (`'true'` when `verify-tooling` and `verify-contract` both pass) and
`metadata-ok` (`'true'` when the metadata job passes; empty when the job is skipped).

Secret: `TRACKER_TOKEN` (`required: false`; required only when `metadata: true`).

## Permissions and secrets

- Workflow and both jobs declare `contents: read` only: no write scopes, no artifacts, no
  `pull_request_target`, no third-party network calls beyond the adopter's own tooling read.
- The contract job uses the automatic `GITHUB_TOKEN` and passes no secrets.
- The metadata job reads the live project with `TRACKER_TOKEN`: a project-scoped PAT (**Projects
  read + Metadata read**, ≤90 days) or a GitHub App installation token (Projects: read; App tokens
  rotate hourly). A user-owned Projects v2 board generally needs a PAT with the `project` scope.
- Pass the token explicitly by name as the caller example does; never `secrets: inherit`.
- Fork pull requests receive no secrets. Set `metadata: ${{ github.event_name != 'pull_request' }}`
  (as the example does) so pull requests — fork PRs included — run only the offline contract job;
  a metadata run with `metadata: true` and no token fails with an actionable message instead of
  silently passing.

## Check-name mapping (update branch protection in the same PR)

| Before (v1.3.x copied workflows) | v1.4.0 reusable contract |
|---|---|
| `tracker-contract` | `tracker-contract / contract` |
| `tracker-metadata` | `tracker-contract / metadata` |

Capture the real names from a green run before changing protection: `gh pr checks <pr>` or the
check-runs API. Renaming required checks is a **major** contract change per [ACTIONS CATALOG
§7.9](../../docs/ACTIONS_CATALOG.md#79-versioning-ref-pinning-and-stability-policy); update the
ruleset/branch protection in the same upgrade PR. Only require `tracker-contract / metadata` where
your caller runs metadata on the gated events — the bundled expression disables it on all pull
requests, so adding it to a PR-required list would block PRs; keep it project-defined/advisory
otherwise.

## Migration from the v1.3.x copied workflows

1. Copy [tracker-contract.yml](./tracker-contract.yml) to `.github/workflows/tracker-contract.yml`;
   replace **both** pinned `@v1.3.2` refs (the `uses:` reusable-workflow ref and `tracker-ref`)
   with the exact tag/SHA you adopted — `v1.4.0` is the first release that ships
   `reusable-contract.yml`, so the tag must contain it.
2. Keep the `metadata:` expression (`false` on pull requests, `true` on `push` to `main` and
   `workflow_dispatch`); optionally add `version-guard-command` if you already trust a local
   version-consistency script.
3. Configure `TRACKER_TOKEN` with project read (skip it only if you run contract checks alone).
4. Run one PR and one `push`/dispatch to exercise both jobs; capture the new contexts with
   `gh pr checks <pr>`.
5. Update branch protection/ruleset required checks to `tracker-contract / contract` in the same
   PR that upgrades the pin; add `tracker-contract / metadata` only where the caller runs metadata
   on required events (never on PR lists with the bundled expression).
6. Keep the old copied `tracker-contract.yml`/`tracker-metadata.yml` workflows until the pin
   upgrade lands and the new contexts are green, then delete the old workflow files. Do not make
   old and new contexts required at the same time for long.
7. Bump the `.tracker-os` submodule and `automation.templateVersion` per
   [UPGRADING](../../docs/UPGRADING.md), then re-run the PR/push validation.

Versions below v1.4.0 keep the old layout and old check contexts; there is no backport.

## Local verification

```bash
# contract-job parity (offline; no token)
npm run verify:tooling -- --root . --contract contract/adoption-contract.json --tracker-config tracker.config.json
npm run verify:contract -- --root . --contract contract/adoption-contract.json

# metadata-job parity (live API; needs a project-read token)
GH_TOKEN=... npm run verify:metadata -- --repo owner/repo --contract contract/adoption-contract.json
```

- `verify:metadata` resolves `project.number` from the repository-root/`working-directory`
  `tracker.config.json`; set it before adopting metadata checks.
- `config-path` only feeds `verify-tooling`; the other verify scripts read `tracker.config.json`
  from the repository root (or the working directory they are invoked from), so keep the canonical
  config at the root unless you document an override.

## Caveats

- Never pin `@main` or a floating major tag; use an exact template tag or full commit SHA
  (prefer SHA if tags are not protected).
- The reusable workflow's self mode is keyed on the canonical repository slug
  (`presljf/github-project-tracker`), which is why the template's own caller passes
  `tracker-ref: ''`. Downstream adopters always pass the adopted tag/SHA.
- Metadata is a live GitHub read: a missing token, missing `project.number`, unreadable project, or
  contract mismatch fails the job; there is no silent skip when `metadata: true`.
- Contract checks run with `submodules: recursive` on the adopter checkout. Downstream runs check
  the pinned tracker ref into `.tracker/` (never the caller's merge SHA); self mode uses the caller
  workspace checkout instead.
