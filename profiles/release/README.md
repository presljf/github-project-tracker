# Release profiles

Copyable release-profile examples for Project Tracker OS adopters. The canonical documentation,
security model, and full interface contract live in [docs/RELEASE_PROFILES.md](../../docs/RELEASE_PROFILES.md)
(interface source: [docs/ACTIONS_CATALOG.md §7.5](../../docs/ACTIONS_CATALOG.md#75-release-workflow-contract)).

There are two adoption modes (hybrid D model, see ACTIONS CATALOG §8):

| Mode | What lives in your repo | When |
|---|---|---|
| **reusable** (default) | A thin caller job that calls `reusable-release.yml` by exact release tag (`@v<version>`; the contract requires the tag form for required workflows); no copied release logic | Template refs are accessible from your repo (same org or public template) |
| **copy** | Standalone caller workflows from `copy/` plus the composite actions in `.github/actions/` | Cross-repo reuse is blocked by visibility/policy, or you need project-specific steps |

The template repository's only runnable release caller is `.github/workflows/release.yml` (generic
profile, local `uses:`; it exposes the opt-in `contract-gate` dispatch input). GitHub executes only
workflows under `.github/workflows/`, so nothing in this directory runs in place:

- `reusable/` — **non-runnable examples** of reusable-mode callers for the macOS/container/package
  profiles, pinned to `reusable-release.yml@v1.3.2`. Copy into `.github/workflows/`, replace the pin
  with the tag you adopted, then add your build command/trigger/secrets.
- `copy/` — non-runnable **copy-mode** caller templates. Copy into `.github/workflows/` plus the
  composite actions below.

## Profiles

| Profile (canonical / aliases) | Runner | Artifacts | Publish target | Required secrets (all optional, empty = skip) | Permissions |
|---|---|---|---|---|---|
| `generic` / `github-release` | `ubuntu-latest` | build outputs matching `artifact-globs` + `SHA256SUMS` | GitHub Release assets (draft by default) | `RELEASE_TOKEN` only if the default token is not allowed | `contents: write` (publish job only) |
| `macos` / `desktop` / `macos-app-github-release` | `macos-15` (override `macos-runner`) | `.dmg`/`.zip`/`.app` + `SHA256SUMS` | GitHub Release assets (draft by default) | `MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_PASSWORD`; `macos-team-id` is non-secret | `contents: write` (publish job only) |
| `container` / `ghcr` | `ubuntu-latest` | image tar + metadata + checksums | GHCR `ghcr.io/<owner>/<repo>:<version>` and `:sha-<short>` | none — uses `github.token` | `contents: read`, `packages: write` |
| `package` / `npm` / `pypi` | `ubuntu-latest` | npm tarball and/or wheel+sdist + checksums | npm (trusted publishing/OIDC preferred) and/or PyPI (trusted publishing/OIDC preferred) | `NPM_TOKEN`/`PYPI_API_TOKEN` only when OIDC is unavailable | `contents: read`, `id-token: write` |

Every profile is **dry-run by default** and every publish path additionally requires a matching
release tag and the protected `release` environment (required reviewers in the adopting repo).

## Files

| File | Purpose |
|---|---|
| `reusable/release-macos.yml` | **Non-runnable** reusable-mode caller example (macOS profile; dispatch-only; pinned `reusable-release.yml@v1.3.2`) |
| `reusable/release-container.yml` | **Non-runnable** reusable-mode caller example (container/GHCR profile; dispatch-only; pinned ref) |
| `reusable/release-package.yml` | **Non-runnable** reusable-mode caller example (npm/PyPI package profile; dispatch-only; pinned ref) |
| `copy/generic-release.yml` | Copy-mode generic GitHub Release pipeline (build → checksum → guarded draft release) |
| `copy/macos-release.yml` | Copy-mode macOS pipeline (build → optional sign/notarize/staple → checksum → guarded release) |
| `copy/container-release.yml` | Copy-mode container pipeline (docker build → save → guarded GHCR push) |
| `copy/package-release.yml` | Copy-mode package pipeline (build dists → checksum → guarded npm/PyPI publish) |

The files under `reusable/` are examples, not workflows: GitHub never executes `profiles/`. Copy
one into `.github/workflows/`, replace
`presljf/github-project-tracker/.github/workflows/reusable-release.yml@v1.3.2` with the exact tag
(or full SHA) your project adopted, and add the profile trigger/build/secrets — the examples are
dispatch-only and dry-run by default.

The copy-mode workflows use the template's composite actions:

- `.github/actions/checksum` — deterministic sorted checksums, fails closed, cross-platform.
- `.github/actions/sign-notarize-macos` — mask/import/sign/notarize/staple with clean skip when
  credentials are absent and a no-network dry-run mode.

When copying in copy mode, copy **both** action directories into `.github/actions/` and record the
origin template version in the project's adoption notes (UPGRADING copy-vs-reusable procedure).

## Apply

Both modes start by copying a file out of `profiles/` into `.github/workflows/`; files under
`profiles/` are never executed where they live.

**Reusable mode (recommended):**

1. Copy `reusable/release-<profile>.yml` into `.github/workflows/<name>.yml`.
2. Replace the pinned ref
   `presljf/github-project-tracker/.github/workflows/reusable-release.yml@v1.3.2` with the exact tag
   (or full SHA) your project adopted — never `@main`.
3. Replace the `build-command` placeholder with the project's real build; update `artifact-globs`
   and `working-directory`. The artifact globs must match at least one file.
4. Add the profile's trigger and secrets only after a green dry-run: the examples are dispatch-only
   and dry-run by default. A `push: tags: v*` trigger is safe once the `release` environment and
   the caller permission union (see `docs/RELEASE_PROFILES.md` §5.1) are configured.
5. Keep `workflows.release.profile` / `dryRun` / `ref` in `tracker.config.json` consistent with
   the caller you adopt.
6. Optional (recommended for adopters on v1.4.0+): set `contract-gate: true` and pin `tracker-ref`
   to the adopted release tag (v1.4.0+; earlier tags lack `scripts/adopt/**`). The reusable runs `verify-tooling` + `verify-contract` + the offline
   `release-gate` before build, needs no new permission or secret, and fails the release on a
   missing/stale required caller or contract violation. The open-OI half of the release gate stays
   an explicit release-procedure step (`npm run gate:release -- --repo owner/repo`) because it needs
   `issues: read`; see `docs/ACTIONS_CATALOG.md` §7.5 and `docs/CI_SECURITY_PROFILE.md` §3.8.

**Copy mode:**

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
