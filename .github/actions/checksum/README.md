# checksum

Composite action for deterministic release checksums. Contract: `docs/ACTIONS_CATALOG.md` §7.8;
profile docs: `docs/RELEASE_PROFILES.md` §6.1.

- Inputs: `paths` (required, newline-separated globs), `algorithm` (`sha256` default / `sha512`),
  `output-file` (empty derives `SHA256SUMS`/`SHA512SUMS`), `working-directory` (`.` default).
- Outputs: `checksums-file`, `digest-count`.
- Behavior: sorted `<hash>  <path>` output, self-verified before success, fails when nothing
  matches, never overwrites an existing checksum file, cross-platform (`sha256sum`/`shasum`),
  works on bash 3.2 (macOS) without `globstar`/`mapfile`, no secrets or network access.

```yaml
- name: Checksum artifacts
  id: checksum
  uses: ./.github/actions/checksum
  with:
    paths: |
      dist/**
    algorithm: sha256
    working-directory: dist
- run: ( cd dist && sha256sum -c "${{ steps.checksum.outputs.checksums-file }}" )
```

Copy-mode consumers: `profiles/release/copy/*.yml`. Cross-repo consumers pin the action by exact
template tag/SHA (`OWNER/REPO/.github/actions/checksum@v1.0.0`), never `@main`.
