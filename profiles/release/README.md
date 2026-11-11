# Release profiles

Copyable release-profile examples for Project Tracker OS adopters. The canonical documentation,
security model, and full interface contract live in [docs/RELEASE_PROFILES.md](../../docs/RELEASE_PROFILES.md)
(interface source: [docs/ACTIONS_CATALOG.md §7.5](../../docs/ACTIONS_CATALOG.md#75-release-workflow-contract)).

There are two adoption modes (hybrid D model, see ACTIONS CATALOG §8):

| Mode | What lives in your repo | When |
|---|---|---|
| **reusable** (default) | A thin caller job that calls `reusable-release.yml` by exact tag/SHA; no copied release logic | Template refs are accessible from your repo (same org or public template) |
| **copy** | Standalone caller workflows from `copy/` plus the composite actions in `.github/actions/` | Cross-repo reuse is blocked by visibility/policy, or you need project-specific steps |

The template repository itself ships reusable-mode callers in `.github/workflows/release*.yml`;
this directory ships the **copy-mode** equivalents and the shared profile reference material.

## Profiles

| Profile (canonical / aliases) | Runner | Artifacts | Publish target | Required secrets (all optional, empty = skip) | Permissions |
|---|---|---|---|---|---|
| `generic` / `github-release` | `ubuntu-latest` | build outputs matching `artifact-globs` + `SHA256SUMS` | GitHub Release assets (draft by default) | `RELEASE_TOKEN` only if the default token is not allowed | `contents: write` (publish job only) |
| `macos` / `desktop` / `macos-app-github-release` | `macos-14` (override `macos-runner`) | `.dmg`/`.zip`/`.app` + `SHA256SUMS` | GitHub Release assets (draft by default) | `MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_PASSWORD`; `macos-team-id` is non-secret | `contents: write` (publish job only) |
| `container` / `ghcr` | `ubuntu-latest` | image tar + metadata + checksums | GHCR `ghcr.io/<owner>/<repo>:<version>` and `:sha-<short>` | none — uses `github.token` | `contents: read`, `packages: write` |
| `package` / `npm` / `pypi` | `ubuntu-latest` | npm tarball and/or wheel+sdist + checksums | npm (trusted publishing/OIDC preferred) and/or PyPI (trusted publishing/OIDC preferred) | `NPM_TOKEN`/`PYPI_API_TOKEN` only when OIDC is unavailable | `contents: read`, `id-token: write` |

Every profile is **dry-run by default** and every publish path additionally requires a matching
release tag and the protected `release` environment (required reviewers in the adopting repo).

## Files

| File | Purpose |
|---|---|
| `copy/generic-release.yml` | Copy-mode generic GitHub Release pipeline (build → checksum → guarded draft release) |
| `copy/macos-release.yml` | Copy-mode macOS pipeline (build → optional sign/notarize/staple → checksum → guarded release) |
| `copy/container-release.yml` | Copy-mode container pipeline (docker build → save → guarded GHCR push) |
| `copy/package-release.yml` | Copy-mode package pipeline (build dists → checksum → guarded npm/PyPI publish) |

The copy-mode workflows use the template's composite actions:

- `.github/actions/checksum` — deterministic sorted checksums, fails closed, cross-platform.
- `.github/actions/sign-notarize-macos` — mask/import/sign/notarize/staple with clean skip when
  credentials are absent and a no-network dry-run mode.

When copying, copy **both** action directories into `.github/actions/` and record the origin
template version in the project's adoption notes (UPGRADING copy-vs-reusable procedure).

## Apply (copy mode)

1. Copy `copy/<profile>-release.yml` into `.github/workflows/<name>.yml`.
2. Copy `.github/actions/checksum/` and (for macOS) `.github/actions/sign-notarize-macos/` into
   `.github/actions/`.
3. Replace every `build-command` placeholder with the project's real build; update
   `artifact-globs` and `working-directory`. The artifact globs must match at least one file.
4. Configure the protected `release` environment: required reviewers and a deployment rule that
   only allows tags matching the release pattern. Configure the optional secrets listed above.
5. Keep `workflows.release.profile` / `dryRun` / `ref` in `tracker.config.json` consistent with
   the caller you adopt (profile names are free-form per config schema; keep the canonical name
   in this table unless the project documents an override).
6. Validate before enabling publishing:
   - `workflow_dispatch` with `dry-run: true` → release job skipped, checksums present;
   - negative test: `publish: true` with `dry-run: true` → fails with the contradictory-inputs error;
   - negative test: a non-matching tag → fails the tag-pattern guard;
   - missing macOS secrets → signing skips cleanly (or ad-hoc fallback on a publish run, with a warning);
   - `SHA256SUMS` verifies with `sha256sum -c`.
7. Pin composite action refs if consumed cross-repo, e.g.
   `OWNER/REPO/.github/actions/checksum@<exact-tag-or-sha>` — never `@main`.

## Safety rules

- No release/publish steps on `pull_request` (and no `pull_request_target` anywhere).
- Publishing is only reachable from a release tag (or a dispatch that selected the release tag
  ref) with `publish: true`, `dry-run: false`, and the protected `release` environment.
- No secrets in config, docs, comments, logs, or artifacts; static-token exceptions are
  documented, scoped, and rotated in the tracker.
- Releases are immutable by policy: the pipeline fails if the release already exists rather than
  overwriting assets.
- Draft by default: a human reviews the checksums/artifacts and publishes the draft.
