# sign-notarize-macos

Composite action for optional macOS code signing and notarization on a macOS runner. Contract:
`docs/ACTIONS_CATALOG.md` §7.8; profile docs: `docs/RELEASE_PROFILES.md` §4.2 and §6.2.

- Inputs: `artifact-path` (required), `signing-identity`, `team-id`, `notarize`, `dry-run`,
  `keychain-profile`, and secret-valued inputs `certificate-p12`, `certificate-password`,
  `apple-id`, `apple-app-password` (all optional; empty certificate means "skip signing cleanly").
- Outputs: `signed-path` (empty when skipped), `notarized` (`true`/`false`).
- Behavior: validates inputs; `dry-run: true` never signs and never contacts Apple; secret values
  are masked; an ephemeral keychain is created and deleted in a trap; runs `codesign --verify`,
  `xcrun notarytool submit --wait`, `xcrun stapler staple` (notarize only for `.app` via a
  temporary zip and for `.dmg`); failures fail the step.
- Guard contract: call only from a tag/dispatch release job inside the protected `release`
  environment. Composite actions cannot declare secrets — pass them as inputs.

```yaml
- name: Sign and notarize
  if: ${{ inputs.dry-run == false }}
  uses: ./.github/actions/sign-notarize-macos
  with:
    artifact-path: dist/MyApp.app
    signing-identity: Developer ID Application
    team-id: ${{ vars.MACOS_TEAM_ID }}
    notarize: 'true'
    dry-run: 'false'
    certificate-p12: ${{ secrets.MACOS_CERT_P12 }}
    certificate-password: ${{ secrets.MACOS_CERT_PASSWORD }}
    apple-id: ${{ secrets.APPLE_ID }}
    apple-app-password: ${{ secrets.APPLE_APP_PASSWORD }}
```

The reusable release workflow inlines equivalent signing logic for reusable mode because a called
workflow cannot rely on local composite actions from this repository when invoked cross-repo;
copy-mode callers use this action directly. Never commit certificates, passwords, or Apple
credentials; they belong in the protected `release` environment.
