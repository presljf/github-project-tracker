# Token & secret matrix

<!-- Docs version: v1.2.2-docs.1 · Target template: v1.2.2 · print formats: A4, Letter -->

> Least-privilege tokens and secrets by job. Full model: [REFERENCE §14](../REFERENCE.md#14-token-and-secret-matrix) · [ACTIONS CATALOG §4](../ACTIONS_CATALOG.md#4-token-and-secret-matrix).

## Who needs what

| Need | Token/source | Scope | Stored as |
|---|---|---|---|
| Repo CI, dependency review | `GITHUB_TOKEN` | `contents: read` | Automatic, per-run |
| Tracker audit (advisory) | `TRACKER_TOKEN` or GitHub App | Project read | Repo secret; skip cleanly if unset |
| Tracker audit (release gate) | Same | Project read | `release` environment secret |
| Release publish (generic) | `GITHUB_TOKEN` | `contents: write` (publish job only) | Automatic |
| Container publish | `GITHUB_TOKEN` | `packages: write` | Automatic |
| Package/cloud publish | OIDC or env secret | Minimal publish role | `release` environment |
| Signing/notarization | Apple cert + app password | n/a | `release` environment secrets |

`TRACKER_TOKEN` name is configurable via `tracker.config.json` → `workflows.audit.tokenSecret`. Never hard-code another name in docs or workflow callers.

## Rules

- Start with `permissions: {}` and grant the minimum per job; publish jobs only on a tag or explicit dispatch.
- Fork/untrusted PRs get **no secrets** and a read-only token. Never use `pull_request_target` with untrusted checked-out code.
- Audit is read-only: project read is enough; no write scopes needed.
- Prefer OIDC/short-lived credentials over long-lived cloud keys; document any static exception.
- Never put tokens in repo, config, issues, comments, logs, artifacts, or caches. Mask derived values; rotate PATs and certs.
- Publishing/signing runs inside the protected `release` environment with required reviewers; PR jobs never declare it.
- OIDC jobs get `id-token: write` only on the publish job; cloud trust policies pin repo + tag/environment.
- Environment deployment rules allow tags `v*` only; secrets are scoped to that environment, not repo-wide.

## Safe CI permission shape

```yaml
permissions: {}          # workflow default: deny
jobs:
  ci:
    permissions:
      contents: read     # only what the job proves it needs
```

## Setup checklist

- [ ] Audit token created project-scoped (PAT or App) and stored as a secret.
- [ ] `workflows.audit.tokenSecret` matches the stored name.
- [ ] Release environment created with reviewers; tag rules restrict `v*`.
- [ ] Signing/publish secrets are environment secrets, absent-safe, and documented.
- [ ] CI needs no secrets; local parity commands run without credentials.

Links: [CI/security token matrix](../CI_SECURITY_PROFILE.md#5-token-and-secret-matrix) · [UPGRADING](../UPGRADING.md) · [SECURITY.md](../../SECURITY.md)
