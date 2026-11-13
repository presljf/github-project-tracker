# setup-node-cache composite action

One step for the tracker's Node setup: install the requested Node.js version, restore the
package-manager dependency cache when a lockfile exists, and install dependencies with
`skip-on-none` semantics. It replaces the inline `actions/setup-node` + "Install dependencies"
steps that the reusable workflows used to repeat.

Interface source of truth: [ACTIONS CATALOG §7.8](../../../docs/ACTIONS_CATALOG.md#78-composite-action-interfaces).
Behavior contract: no secrets, no implicit credentials, and no failure when a project has no
lockfile or deliberately skips dependency installation.

## Usage

### Same repository

In a workflow in this repository, reference the action by its local path:

```yaml
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
    with:
      persist-credentials: false
  - name: Set up Node and dependencies
    uses: ./.github/actions/setup-node-cache
    with:
      node-version: '22'
      working-directory: '.'
```

### Cross-repository (from a reusable workflow)

Local actions are resolved in the **caller's** workspace, not the repository that owns the
reusable workflow. After the caller-repo checkout, check the tracker repository out again and
reference the action from that path:

```yaml
steps:
  - name: Checkout caller repository
    uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
    with:
      persist-credentials: false
  - name: Checkout tracker action source
    uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
    with:
      repository: ${{ job.workflow_repository }}
      ref: ${{ job.workflow_sha }}
      path: .tracker-actions
      persist-credentials: false
  - name: Set up Node and dependencies
    uses: ./.tracker-actions/.github/actions/setup-node-cache
    with:
      node-version: '22'
      working-directory: '.'
```

`job.workflow_repository` and `job.workflow_sha` resolve to the repository and commit that
contain the reusable workflow file, so the action always matches the workflow version the caller
pinned. Do not hardcode `@main` or a floating tag for these.

### Direct cross-repository reference

Adopting projects can also consume the published action directly without the extra checkout:

```yaml
- uses: presljf/github-project-tracker/.github/actions/setup-node-cache@vX.Y.Z
```

Pin an exact template tag or full commit SHA; never `@main`.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `node-version` | `22` | Node.js version or range label (`22`, `22.x`, `lts/*`). |
| `package-manager` | `npm` | Cache/install package manager: `npm`, `pnpm`, or `yarn`. |
| `working-directory` | `.` | Directory containing `package.json`/lockfiles, relative to the repository root. |
| `cache` | `true` | Restore the package-manager cache when a lockfile exists. |
| `install-dependencies` | `true` | Install dependencies after setup. |
| `registry-url` | `''` | Optional npm registry URL for `actions/setup-node` (empty = default registry). |
| `cache-dependency-path` | `''` | Cache-key lockfile path; empty auto-detects under `working-directory`. |
| `install-command` | `''` | Install command. Empty = `npm ci` when an npm lockfile exists, otherwise skip with a notice; literal `none` always skips. |

## Outputs

| Output | Meaning |
|---|---|
| `node-version` | The normalized Node.js version passed to `actions/setup-node`. |
| `cache-hit` | `actions/setup-node` `cache-hit` value (`true`/`false`; empty when caching is off). |

## Cache behavior

- Caching is restored only when `cache: true` **and** the selected package manager's lockfile
  exists under `working-directory` (`package-lock.json`/`npm-shrinkwrap.json` for npm,
  `pnpm-lock.yaml` for pnpm, `yarn.lock` for yarn). With no lockfile the action continues without
  a cache and logs a notice.
- `cache-dependency-path` overrides auto-detection for monorepo layouts; it is relative to the
  repository root, matching `actions/setup-node`.
- The action always sets `package-manager-cache: false` on `actions/setup-node`: caching is
  controlled by this action's explicit `cache` input, not by setup-node's implicit packageManager
  field detection, so adopters never get a surprise cache (or a cache-key mismatch).
- A cache miss is not a failure; only a real setup/install error fails the job.

## Install semantics

- `install-dependencies: false` skips installation entirely (used by resolver/prepare jobs that
  only need Node).
- `install-command: none` skips installation explicitly (parity with the reusable workflows'
  `install-command` input).
- An empty `install-command` runs `npm ci` **only** when an npm lockfile exists. pnpm/yarn projects
  must pass their own command (for example `corepack enable && pnpm install --frozen-lockfile`).
- The install command runs with `bash -euo pipefail -c` inside `working-directory`, so a non-zero
  exit fails the step immediately.
- Invalid `cache`/`install-dependencies` spellings (anything outside `true/1/yes/false/0/no`) and
  unknown `package-manager` values fail fast with an actionable error instead of guessing.

## Migration note

- Consumers can delete their own `actions/setup-node` step and "Install dependencies" step and
  replace them with this action; keep the caller-repo checkout (and add the tracker checkout for
  reusable workflows).
- The action covers the previous reusable-workflow behavior: auto-install `npm ci` for npm
  lockfiles, skip for other package managers unless told otherwise, and no cache when no lockfile
  exists.
- `reusable-e2e.yml` consumption is deferred until that reusable workflow ships (T05).
