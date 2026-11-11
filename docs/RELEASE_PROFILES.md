# RELEASE PROFILES

**Docs version:** `v1.0.0-docs.1` · Target template: `v1.0.0`
**Scope:** reusable release pipeline (`reusable-release.yml`), thin callers for four profiles (generic GitHub Release, macOS signed/notarized, GHCR container, npm/PyPI package), composite actions (`checksum`, `sign-notarize-macos`), and copy-mode examples under `profiles/release/`.
**Status:** T10 implements this profile layer. Publishing is dry-run/skip guarded by default; no live release was published while authoring.
**Contracts:** [ACTIONS CATALOG §2.4/§7.5/§7.8/§9](./ACTIONS_CATALOG.md) is the interface source of truth; this page documents the delivered behavior. [REFERENCE §13–16](./REFERENCE.md#13-workflow-catalog-planned-1002), [CI & security profile](./CI_SECURITY_PROFILE.md), and [UPGRADING](./UPGRADING.md) stay consistent with it.

## 1. Safety model (read this first)

Every release pipeline in this repo follows one model, regardless of profile:

1. **Dry-run is the default.** `dry-run: true` builds, signs (only in real mode), checksums, and validates; it never creates a release, uploads assets, pushes an image, or publishes a package. `workflow_dispatch` callers default to `dry-run: true`.
2. **Publishing needs a release tag.** A publish run requires a `push` on a tag matching `workflows.release`'s tag pattern (default `^v\d+\.\d+\.\d+$`) or a dispatch that selected a release tag ref, plus `publish: true` and `dry-run: false`. The resolved version must equal the tag (`v<version>`); mislabelled tags fail closed.
3. **The `release` environment gates publishing.** Publish/signing jobs run in the protected `release` environment (required reviewers, tags-`v*`-only deployment rule configured in the adopting repo). Dry-run jobs never enter it.
4. **No publish path from pull requests.** There is no `pull_request` trigger, no `pull_request_target`, and every publish job re-asserts `event_name != pull_request`.
5. **Checksums are verified, releases are immutable, drafts by default.** Artifacts are checksummed after signing, checksums are verified before upload, an existing release fails the run instead of being overwritten, and the GitHub Release is a draft (`draft: true`) until a human publishes it.
6. **Least privilege, no secrets in logs.** Workflow-level `permissions: {}`; per-job grants only. Secrets are optional, environment-scoped, masked; empty signing credentials mean a documented skip/ad-hoc fallback, never a silent unsigned publish.

## 2. Profiles

| Profile | Canonical / aliases | Runner | Artifacts | Publish target | Job permissions |
|---|---|---|---|---|---|
| `generic` | `generic`, `github-release` | `ubuntu-latest` | build outputs + `SHA256SUMS` | GitHub Release assets | build/checksum `contents: read`; publish `contents: write` |
| `macos` | `macos`, `desktop`, `macos-app-github-release` | `macos-14` (input `macos-runner`) | dmg/zip/app + `SHA256SUMS` | GitHub Release assets | signing/publish `contents: write` (+`contents: read` elsewhere) |
| `container` | `container`, `ghcr`, `image` | `ubuntu-latest` | image tar + metadata + `SHA256SUMS` | GHCR image tags | build `contents: read`; publish `packages: write` |
| `package` | `package`, `npm`, `pypi`, `packages` | `ubuntu-latest` | npm tarball and/or wheel+sdist + `SHA256SUMS` | npm / PyPI | build `contents: read`; publish `id-token: write` (+`contents: read`) |

Config mapping: `workflows.release.profile` in `tracker.config.json` (the schema `workflows.release` also carries `ref` and `dryRun`). The value is a free-form string; adopters keep it identical to the caller/profile name they use. Aliases above are accepted by the reusable workflow so older example configs (`github-release`, `macos-app-github-release`) keep working, but new projects should use the canonical name.

## 3. Reusable workflow contract (`reusable-release.yml`)

File: `.github/workflows/reusable-release.yml` · trigger: `workflow_call` only. Manual dispatch lives on the thin callers (§5) — a reusable workflow is invoked by a caller, and keeping dispatch on callers keeps the publishing ref explicit.

### 3.1 Inputs

| Input | Type | Default | Notes |
|---|---|---|---|
| `profile` | string | `generic` | `generic`/`macos`/`container`/`package` (+ aliases above) |
| `version` | string | `''` | Empty derives it from the tag ref (or `0.0.0-dryrun` on a dry-run dispatch); must equal `v<version>` on tags |
| `tag-pattern` | string | `^v[0-9]+\.[0-9]+\.[0-9]+$` | POSIX ERE; `\d` accepted as `[0-9]` |
| `dry-run` | boolean | `true` | Build/validate/checksum only |
| `publish` | boolean | `false` | Honored only with matching tag + `dry-run: false` |
| `artifact-globs` | string | `dist/**` | Newline-separated, repo-root-relative; must match ≥1 file (fail closed) |
| `checksum-algorithm` | string | `sha256` | `sha256` → `SHA256SUMS`; `sha512` → `SHA512SUMS` |
| `build-command` | string | `''` | Shell command run from `working-directory`; empty uses the profile default |
| `working-directory` | string | `.` | Build command directory (artifact globs stay repo-root-relative) |
| `node-version` | string | `22` | Empty skips `setup-node` |
| `macos-runner` | string | `macos-14` | Runner label for the macos profile |
| `macos-team-id` | string | `''` | Non-secret Apple team ID, required for notarization |
| `macos-signing-identity` | string | `Developer ID Application` | codesign identity |
| `image-name` | string | `''` | Empty → `ghcr.io/<owner>/<repo>` (lowercase); no tag |
| `package-registries` | string | `''` | Empty auto-detects from build output; `npm`, `pypi`, or `npm,pypi` override |
| `artifact-name` | string | `release-artifacts` | Base workflow-artifact name |
| `retention-days` | number | `30` | Artifact retention |
| `release-name` | string | `''` | Empty → validated tag |
| `draft` | boolean | `true` | Create the GitHub Release as a draft |
| `prerelease` | boolean | `false` | Mark prerelease |

The §7.5 catalog contract lists the stable core; T10 adds optional inputs (`version`, `build-command`, `node-version`, `macos-*`, `artifact-name`, `retention-days`, `release-name`, `draft`, `prerelease`) which are additive/minor under the catalog's stability policy (§7.9). The catalog page itself is owned by T14/T15 refinement; this page is authoritative for the delivered behavior.

### 3.2 Outputs

| Output | Meaning |
|---|---|
| `version` | Validated semantic version (no leading `v`) |
| `artifacts` | Newline-separated artifact file list (bundle-relative) |
| `checksums-file` | `SHA256SUMS` or `SHA512SUMS` |
| `release-url` | Created GitHub Release URL (empty on dry-run) |
| `dry-run` | `'true'` when nothing was published |

### 3.3 Secrets (all optional)

| Secret | Profile | Purpose |
|---|---|---|
| `RELEASE_TOKEN` | generic, macos, container | Alternate publishing token only when org policy forbids the default token; never needed for dry-runs |
| `MACOS_CERT_P12` | macos | Base64 Developer ID Application `.p12` |
| `MACOS_CERT_PASSWORD` | macos | `.p12` password |
| `APPLE_ID` | macos | Apple ID for notarytool |
| `APPLE_APP_PASSWORD` | macos | App-specific password for notarytool |
| `NPM_TOKEN` | package | Static npm token fallback when trusted publishing/OIDC is unavailable |
| `PYPI_API_TOKEN` | package | Static PyPI token fallback when trusted publishing/OIDC is unavailable |

`macos-team-id` is an input (non-secret); store it as an environment/repo **variable** (`vars.MACOS_TEAM_ID`) and pass it in, or pass it literally in the caller if it is not sensitive. Signing/publishing secrets belong on the protected `release` environment; the caller passes them by name (`secrets: MACOS_CERT_P12: ${{ secrets.MACOS_CERT_P12 }}`), and the called workflow's jobs declare `environment: release` so environment secrets resolve.

### 3.4 Permissions, environment, runners

- Workflow-level `permissions: {}`. Callers must grant the union needed by the called jobs: `contents: write` for generic/macos; `contents: read` + `packages: write` for container; `contents: read` + `id-token: write` for package. Called jobs can only reduce the caller grant.
- Called publish/signing jobs run with `environment: release`. Callers cannot set the environment on a reusable-workflow job (GitHub restriction) — it is declared inside the reusable workflow, which is why the environment name is part of the contract.
- Runners: `ubuntu-latest` except the macos profile (`macos-14` by default; override with `macos-runner`).
- No concurrency is set on the reusable workflow; callers set `concurrency: release-${{ github.ref }}` with `cancel-in-progress: false` (never cancel a publish halfway).

### 3.5 Pipeline shape

| Job | Profile | What it does |
|---|---|---|
| `prepare` | all | Validate inputs, resolve version/tag, enforce guards, compute runner/artifact names |
| `build` | all | Checkout (tag commit checked when publishing), profile build command/default, fail if no artifacts match, upload artifacts |
| `sign-macos` | macos (publish only) | Import cert into an ephemeral keychain, codesign, notarize + staple, re-upload signed artifacts; ad-hoc fallback with warning when credentials are absent |
| `checksum` | generic, macos, package | Download artifacts (signed when signing ran), generate sorted checksums, self-verify, upload `release-bundle` |
| `publish-github-release` | generic, macos (publish only) | Verify checksums, fail if the release exists, `gh release create --verify-tag [--draft] [--prerelease] --generate-notes` with all assets |
| `publish-container` | container (publish only) | Load image tar, tag `:<version>` and `:sha-<short>`, GHCR login with `github.token`, push, report digest |
| `publish-package` | package (publish only) | Verify checksums, npm publish with provenance/OIDC (or `NPM_TOKEN` fallback), PyPI trusted publishing (or `PYPI_API_TOKEN` fallback) |

## 4. Profile details

### 4.1 `generic` — GitHub Release assets

- Build command produces files matching `artifact-globs` (default `dist/**`, flattened asset names relative to the glob root; avoid duplicate basenames). Empty build command means "artifacts already exist".
- `SHA256SUMS` is attached as a release asset next to the artifacts; the publish job re-verifies it.
- Release is a draft by default; `draft: false` publishes immediately after environment approval. `prerelease: true` marks it.
- Failure modes: tag/version mismatch, no artifact match, checksum mismatch, existing release, missing permissions → fail closed; nothing is published.
- Local parity: build, `sha256sum` (or `shasum -a 256`), `gh release create --draft`.

### 4.2 `macos` — dmg/zip with optional signing/notarization

- Build command should produce `.app`/`.dmg`/`.zip` under `artifact-globs`. Signing applies to `.app`, `.dmg`, and Mach-O binaries; `.zip` cannot be signed/notarized as-is — sign the `.app` before zipping (the reusable sign step notarizes `.app` via a temporary zip and `.dmg` directly, then staples).
- **Credentials present** (`MACOS_CERT_P12` + `MACOS_CERT_PASSWORD`; notarization additionally needs `APPLE_ID`, `APPLE_APP_PASSWORD`, `macos-team-id`): ephemeral keychain, `codesign --options runtime --timestamp`, `xcrun notarytool submit --wait`, `xcrun stapler staple`, keychain removed in a trap. Notarization missing credentials = signed-but-not-notarized, with a warning.
- **Credentials absent on a publish run:** documented ad-hoc fallback (`codesign --force --deep --sign -`) with an explicit `::warning::` and `signing-mode: ad-hoc` output; the release still requires the `release` environment approval. This is the documented fallback for internal distribution, never a silent unsigned publish.
- **Dry-run:** build + checksum only; signing is skipped entirely (no keychain, no Apple calls).
- Notary credentials in CI: Apple ID + app-specific password are the portable path; `notarytool` keychain profiles are supported by the composite action (`keychain-profile`) for self-hosted setups.
- Certificate expiry ≤1 year; rotate passwords; never commit the `.p12`, password, or Apple ID secrets.

### 4.3 `container` — GHCR image

- Build command builds and tags an image as `$IMAGE_NAME:$VERSION` (`IMAGE_NAME` is provided by the workflow, default `ghcr.io/<owner>/<repo>`); the workflow saves it as a tar artifact. Without a build command it runs `docker build -t "$IMAGE_NAME:$VERSION" .` at the repo root.
- Publish job (guarded) loads the tar, tags `:<version>` and `:sha-<12>`, logs in to `ghcr.io` with the workflow token, and pushes. It reports the digest in the job summary/output.
- `packages: write` is granted to the publish job only. No registry PATs.
- Optional SBOM/provenance: use `docker buildx` with `--sbom=true --provenance=mode=max` in the project's build command and push directly (buildx attestations require the push step); this template ships the guarded `docker save`/push path only. Record the decision in the project tracker if attestations are required.
- Local parity: `docker build`, `docker run` smoke, `docker save`, `docker login`/`docker push` only in a real release.

### 4.4 `package` — npm / PyPI

- Build command produces `dist/*.tgz` (npm) and/or `dist/*.whl`/`dist/*.tar.gz` (PyPI); empty build command runs `npm pack` when `package.json` exists, or `python -m build` when `pyproject.toml` exists.
- Registry auto-detection comes from the built files; override with `package-registries`.
- **npm:** preferred path is trusted publishing (OIDC) — the publish job grants `id-token: write` and runs `npm publish --provenance --access public`; configure the trusted publisher on npmjs.com for this repository/workflow/environment. `NPM_TOKEN` is the static-token exception (masked, documented, rotated).
- **PyPI:** preferred path is trusted publishing via `pypa/gh-action-pypi-publish` (OIDC + PEP 740 attestations, pinned by SHA); configure the trusted publisher on PyPI for this repository/workflow/environment. `PYPI_API_TOKEN` is the static-token exception (`twine upload` with the token passed via `TWINE_PASSWORD`, never on the command line).
- Publishing is never on a PR; versions must be already tagged.
- Local parity: `npm pack --dry-run`, `python -m build`, `twine check dist/*`.

## 5. Callers and wiring

### 5.1 Reusable mode (recommended)

In-repo template callers (also the copyable contract examples):

| Caller | Trigger | Profile | Caller permissions |
|---|---|---|---|
| `.github/workflows/release.yml` | push tags `v*`; dispatch (dry-run default) | generic | `contents: write` on the called job |
| `.github/workflows/release-macos.yml` | dispatch only (example) | macos | `contents: write` |
| `.github/workflows/release-container.yml` | dispatch only (example) | container | `contents: read`, `packages: write` |
| `.github/workflows/release-package.yml` | dispatch only (example) | package | `contents: read`, `id-token: write` |

Generic caller expressions: on a tag push it passes `dry-run: false` and `publish: true`; on dispatch it passes the operator's `dry-run` (default `true`) and `publish` (default `false`). The reusable workflow still refuses to publish unless the ref is the matching tag and the environment approves. The profile example callers are dispatch-only in the template repository (no product build/secrets exist here); adopters add the tag trigger once their project commands/secrets are configured.

Downstream (pinned) form — never `@main`:

```yaml
jobs:
  release:
    permissions:
      contents: write
    uses: presljf/github-project-tracker/.github/workflows/reusable-release.yml@v1.0.0
    with:
      profile: generic
      dry-run: ${{ github.event_name == 'workflow_dispatch' && inputs.dry-run || false }}
      publish: ${{ github.event_name == 'push' || inputs.publish }}
      build-command: 'npm ci && npm run build'
      artifact-globs: |
        dist/*.zip
        dist/*.tar.gz
    secrets:
      RELEASE_TOKEN: ${{ secrets.RELEASE_TOKEN }}   # optional
```

Pass signing/publishing secrets by name exactly as listed in §3.3; do not use `secrets: inherit` for third-party/workflow reuse unless the caller and called workflow are first-party and reviewed. Caller must grant at least the permissions the called jobs use (the called workflow can only reduce them).

### 5.2 Copy mode

`profiles/release/copy/{generic,macos,container,package}-release.yml` are standalone callers for repos where cross-repo reuse is blocked (hybrid D copy fallback, ACTIONS CATALOG §8.4). Copy the caller into `.github/workflows/` **and** copy `.github/actions/checksum/` and (for macOS) `.github/actions/sign-notarize-macos/` into `.github/actions/`; record the origin template version and local overrides in the project notes. The copy examples use the same tag/environment guards and pinned action SHAs, but keep checksum generation inside the build/sign jobs rather than a dedicated bundle job — preserve the guards, do not add PR publishes.

### 5.3 Environment, tag protection, and dispatch setup

1. Create the `release` environment in the adopting repo. Add required reviewers; restrict deployment branches/tags to the release tag pattern. Put signing/publishing secrets there (environment secrets).
2. Protect release tags: ruleset restricting tag creation/update/deletion for `v*` to maintainers; never move or delete a published tag.
3. Grant Actions workflow permissions: the repo's default workflow token must be allowed to `contents: write` / `packages: write` where the profile needs it (or pass `RELEASE_TOKEN` per org policy).
4. Add the dispatch trigger only after a green dry-run; keep `dry-run: true` as the dispatch default.
5. Record the profile choice and template pin in `tracker.config.json` (`workflows.release.profile`, `workflows.release.ref`, `workflows.release.dryRun`) and in the project's adoption notes.

## 6. Composite actions

### 6.1 `checksum`

Path: `.github/actions/checksum/action.yml`

| Input | Required | Default | Purpose |
|---|---|---|---|
| `paths` | yes | — | Newline-separated globs relative to `working-directory`; `**` and `*` match across `/` |
| `algorithm` | no | `sha256` | `sha256`/`sha512` |
| `output-file` | no | `''` → `SHA256SUMS`/`SHA512SUMS` | Checksum file name (never overwritten) |
| `working-directory` | no | `.` | Directory containing the artifacts |

Outputs: `checksums-file`, `digest-count`. Behavior: deterministic sorted `<hash>  <path>` lines, self-verified before success, fails when no file matches, refuses to overwrite an existing checksum file, no secrets/network, portable to bash 3.2 (macOS) via `sha256sum`/`shasum` fallback.

```yaml
- uses: ./.github/actions/checksum
  id: checksum
  with:
    paths: |
      dist/**
    algorithm: sha256
    working-directory: dist
- run: ( cd dist && sha256sum -c "${{ steps.checksum.outputs.checksums-file }}" )
```

### 6.2 `sign-notarize-macos`

Path: `.github/actions/sign-notarize-macos/action.yml` (macOS runner only; the caller selects `runs-on: macos-*`).

| Input | Required | Default | Purpose |
|---|---|---|---|
| `artifact-path` | yes | — | `.app`, `.dmg`, or Mach-O binary to sign |
| `signing-identity` | no | `Developer ID Application` | codesign identity |
| `team-id` | no | `''` | Apple team ID (notarization) |
| `notarize` | no | `false` | Submit + staple when credentials are present |
| `dry-run` | no | `true` | Validate only; never contacts Apple, never signs |
| `keychain-profile` | no | `''` | notarytool keychain profile (overrides apple-id creds) |
| `certificate-p12` | no | `''` | Base64 `.p12`; empty = skip signing cleanly |
| `certificate-password` | no | `''` | `.p12` password |
| `apple-id` | no | `''` | notarytool Apple ID |
| `apple-app-password` | no | `''` | notarytool app-specific password |

Outputs: `signed-path` (empty when skipped), `notarized` (`'true'`/`'false'`). Guard contract: call only from the tag/dispatch release job inside the protected `release` environment; composite actions cannot declare secrets, so the caller passes secret values as inputs. Values are masked; the ephemeral keychain is deleted in a trap; failures fail the step.

## 7. Artifact naming and checksums

- Workflow artifact name: `artifact-name` (default `release-artifacts`); the verified bundle is `release-bundle`; macOS signed artifacts are `<artifact-name>-signed`.
- GitHub Release assets are the files from the bundle root: artifact names are flattened relative to the glob root (avoid duplicate basenames in a single release).
- Checksum file format is the standard two-space format, sorted by path, e.g.:

```text
9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08  app-1.2.3.zip
```

- Verify locally/CI: `sha256sum -c SHA256SUMS` (Linux) or `shasum -a 256 -c SHA256SUMS` (macOS/POSIX).
- Container: checksum of the saved image tar is included in the artifact evidence; the published tags `:<version>` and `:sha-<short>` pin the digest reported in the job summary.
- Release assets should be reviewed against `SHA256SUMS` before a human publishes the draft release.

## 8. Validation checklist

Run before enabling any publish path (T12 captures evidence for the template release; adopters repeat for their project):

- [ ] YAML parses (`python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))' <file>`) for every workflow/action.
- [ ] `actionlint .github/workflows/*.yml` passes in an environment that has it (not available in the authoring environment for T10; T15/T12 must run it on real workflows).
- [ ] `npm test` passes, including `tests/release-profiles.test.mjs` (structural guards: dry-run defaults, publish guards, tag pattern, environment, pinned SHAs, no secrets).
- [ ] `npm run validate:config` passes (release config keys remain schema-valid).
- [ ] Dispatch dry-run: no release/asset/image/package is created and `dry-run` output is `true`; checksums are produced and verified.
- [ ] Negative: `publish: true` with `dry-run: true` fails with the contradictory-inputs error.
- [ ] Negative: a non-release tag (for example `v1.2`) or a tag/version mismatch fails before any build/publish.
- [ ] Negative: an existing release fails instead of being overwritten.
- [ ] Missing macOS secrets: signing skips cleanly on dry-runs; on publish runs the ad-hoc fallback emits a warning and signs only app bundles/binaries.
- [ ] Secret scan: no literal tokens/keys in workflows, docs, profiles, examples; secret-looking strings only as placeholder names.
- [ ] Fork PR: no secrets, read-only token, and no publish path (there is no PR trigger at all).

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Tag 'v1.2' does not match tag-pattern` | Tag is not a release tag; push the matching tag or fix `tag-pattern` (POSIX ERE, `\d` accepted) |
| `Tag 'v1.2.3' does not match resolved version tag` | Caller passed a mismatched `version`; align the tag and version |
| `publish: true with dry-run: true is contradictory` | Remove one: dry-run for validation, or `dry-run: false` + tag for publishing |
| `publish: true requires a release tag ref` | Dispatch must select the release tag ref; publishing from a branch is intentionally impossible |
| `No files matched artifact-globs` / `No artifact files to checksum` | Build command produced nothing or globs are wrong; artifact globs are repo-root-relative |
| `Release ... already exists` | Releases are immutable; bump the version instead of overwriting |
| Signing skipped | `MACOS_CERT_P12` absent (expected on dry-runs/unconfigured projects); configure environment secrets or review the ad-hoc artifacts |
| `notarize=true needs apple-id/apple-app-password/team-id` | Notarization credentials/`macos-team-id` missing; sign-only still works without them |
| GHCR push denied | Caller job must grant `packages: write`; package visibility/org policy must allow GHCR writes with `github.token` |
| npm/PyPI publish denied | Configure trusted publishing for this repo/workflow/environment, or pass `NPM_TOKEN`/`PYPI_API_TOKEN` as the documented exception |

## 10. Versioning and stability

- The reusable interface is versioned with the template (ACTIONS CATALOG §7.9). Adding optional inputs/outputs/secrets is **minor**; changing dry-run defaults, tag semantics, output names, or requiring a new secret is **major**.
- Callers pin the exact template tag (`@v1.0.0`) or full SHA; never `@main` or a floating major tag. Composite actions consumed cross-repo are pinned the same way; copy-mode files record their origin template version.
- Downstream upgrades follow [UPGRADING](./UPGRADING.md): read the changelog/migration, re-pin, re-run the dry-run/dispatch validation, and record the new pin in the tracker config.
- When the contract changes, update this page, the catalog summary (§7.5), REFERENCE, and the changelog in the same release.
- **Rollback:** remove/disable the caller trigger or environment approval to stop publishes; keep published tags/releases immutable (never delete or move a tag to "undo" a release — publish a new patch version instead); revert a bad pipeline change with a normal PR and re-run the dry-run validation before re-enabling publishing.

## 11. What was and was not verified (T10)

- **Verified locally:** all release workflow/composite/caller YAML parses; `tests/release-profiles.test.mjs` (17 tests) and the rest of `npm test` (35 total) pass; `npm run validate:config` passes; no secrets or literal credentials in the added files; the checksum generator was exercised on a scratch tree (sorted recursive globs, self-verification with `shasum`/`sha256sum`, no-match fail-closed, overwrite refusal, sha512 selection); and the `prepare` guard script was exercised against tag-publish, tag-dry-run, dispatch-dry-run, publish-from-branch, contradictory dry-run+publish, non-release tag, tag/version mismatch, invalid semver, unsupported algorithm, container work-directory, and unknown-profile cases.
- **Not executed:** no GitHub Actions run, dispatch, tag push, signing, image push, package publish, or release creation happened while authoring (workflows cannot be dispatched from an unmerged branch, and the issue forbids live publishing). `actionlint` is not installed in the authoring environment. T12/T15 must capture the dispatch dry-run and negative-guard evidence on a real workflow run before relying on publish paths.

## 12. Related documents

| Document | Why it matters here |
|---|---|
| [ACTIONS CATALOG](./ACTIONS_CATALOG.md) §2.4, §7.5, §7.8, §9 | Interface contract, guardrails, composite-action contracts |
| [CI & security profile](./CI_SECURITY_PROFILE.md) | Required checks, token/permissions defaults, workflow hardening |
| [REFERENCE](./REFERENCE.md) §13–16 | Workflow/token/runner/release quick lookup |
| [UPGRADING](./UPGRADING.md) | Copy vs reusable, pins, upgrade procedure |
| [HOW TO USE](./HOW_TO_USE.md) | Lifecycle context for release work |
| [profiles/release](../profiles/release/README.md) | Copy-mode examples and the shared profile matrix |
| [tracker config schema](../schemas/tracker.config.schema.json) | `workflows.release` keys |
| [SECURITY.md](../SECURITY.md) | Private vulnerability reporting; never expose tokens |
| [GitHub: reusable workflows](https://docs.github.com/en/actions/sharing-automations/reusing-workflows) · [Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) · [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) · [OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect) | Upstream behavior reference |
