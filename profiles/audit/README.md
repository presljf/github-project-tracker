# Audit family profile (tracker audit · post-merge audit · PR close guard)

Reusable-mode callers for the tracker's audit family. Three pinned reusable workflows replace the
three workflows adopters copied separately in v1.3.x — the advisory tracker audit, the post-merge
bypass audit, and the PR close guard. The callers stay thin: triggers, required-check contexts, and
the audit token remain project choices; the verification logic is the pinned template tag.

- Canonical sections: [ACTIONS CATALOG §2.5](../../docs/ACTIONS_CATALOG.md#25-tracker-audit-advisory-first)
  (tracker audit), [§2.9](../../docs/ACTIONS_CATALOG.md#29-post-merge-bypass-audit-shipped),
  [§2.10](../../docs/ACTIONS_CATALOG.md#210-pr-close-guard-shipped); contracts
  [§7.6](../../docs/ACTIONS_CATALOG.md#76-reusable-audityml-tracker-audit-contract),
  [§7.11](../../docs/ACTIONS_CATALOG.md#711-reusable-post-merge-audityml-post-merge-bypass-audit-contract),
  [§7.12](../../docs/ACTIONS_CATALOG.md#712-reusable-pr-close-guardyml-pr-close-guard-contract).
- Copy-mode caller examples (non-runnable): [tracker-audit.yml](./tracker-audit.yml),
  [post-merge-audit.yml](./post-merge-audit.yml), [pr-close-guard.yml](./pr-close-guard.yml).
- Reusable workflows: [reusable-audit.yml](../../.github/workflows/reusable-audit.yml),
  [reusable-post-merge-audit.yml](../../.github/workflows/reusable-post-merge-audit.yml),
  [reusable-pr-close-guard.yml](../../.github/workflows/reusable-pr-close-guard.yml).
- Template's own callers (dogfooding):
  [tracker-audit.yml](../../.github/workflows/tracker-audit.yml),
  [post-merge-audit.yml](../../.github/workflows/post-merge-audit.yml),
  [pr-close-guard.yml](../../.github/workflows/pr-close-guard.yml).

The audit family is part of the v1.4.0 adoption path; v1.4.0 is the first release that ships the
`reusable-*` audit workflows (pre-v1.4.0 pins keep the old copied layout). `profiles/` is never
executed by GitHub: copy the callers into `.github/workflows/` and pin the adopted tag/SHA.

## Install

1. Copy the callers you use into `.github/workflows/`: `tracker-audit.yml`,
   `post-merge-audit.yml`, and/or `pr-close-guard.yml`.
2. Replace **both** pinned `@v1.3.2` refs in each copied file — the `uses:` reusable-workflow ref
   and the `tracker-ref` input — with the exact tag/SHA you adopted (v1.4.0+; prefer SHA when tags
   are not protected). Never `@main`.
3. Keep the caller permissions exactly as shown (they are the called jobs' union; the called
   workflow can only reduce them).
4. Configure the audit token if you run the tracker audit (see below); the other two use the
   automatic `GITHUB_TOKEN` and need no secrets.
5. Update `guard.requiredChecks` and branch protection/rulesets in the same PR as the pin upgrade
   (see the mapping below), then capture the new contexts from a green run.

## Caller permissions

| Caller | Caller-granted permissions | Why |
|---|---|---|
| `tracker-audit.yml` | `contents: read` | Checkout + the audit script; project read comes from the optional `TRACKER_TOKEN` secret |
| `post-merge-audit.yml` | `contents: read`, `issues: write`, `pull-requests: read`, `checks: read`, `statuses: read`, `actions: read` | `issues: write` opens the `tracker-contract-exception` OI; `checks`/`statuses`/`actions` read are required because `statusCheckRollup` also resolves `checkSuite.workflowRun` (private repos otherwise degrade to closure-only) |
| `pr-close-guard.yml` | `contents: read`, `issues: read`, `pull-requests: read` | The guard script is **read-only** — it fetches the PR and referenced issues through the API; no `issues: write` is granted because none is used |

The post-merge caller's six permissions are exactly the called job's union: keep the whole block,
or the reusable workflow fails at startup validation. The PR close guard is deliberately read-only;
if a future guard version needs to write, that is a documented permission increase (catalog §7.9)
and a caller change.

## Check-name mapping (update protection in the same PR)

With reusable workflows the check context is `<caller job name> / <called job name>`.

| Before (v1.3.x copied workflows) | v1.4.0 reusable contract |
|---|---|
| `audit` (tracker audit) | `tracker-audit / audit` |
| `audit` (post-merge audit) | `post-merge-audit / audit` |
| `pr-close-guard` | `pr-close-guard / guard` |

Capture the real names from a green run (`gh pr checks <pr>` or the check-runs API) before touching
protection. Renaming required checks is a **major** contract change per
[ACTIONS CATALOG §7.9](../../docs/ACTIONS_CATALOG.md#79-versioning-ref-pinning-and-stability-policy):
update branch protection/rulesets in the same PR that upgrades the pin.

This repository's audited config (template `tracker.config.json`):

```json
"guard": { "requiredChecks": ["ci / ci-gate", "docs-guard", "pr-close-guard / guard"] }
```

If `guard.requiredChecks` is absent, the post-merge audit falls back to the legacy default list
(`ci / ci-gate`, `docs-guard`, `pr-close-guard`) — which no longer matches the reusable context, so
an absent/partial config would flag every merge as a bypass. Set the list explicitly when you
migrate.

## Tracker audit token

`TRACKER_TOKEN` is an optional secret used only by `reusable-audit.yml`:

- Project read access: a project-scoped PAT with **Projects read + Metadata read** (classic PAT:
  `project` scope; ≤90 days) or a GitHub App installation token with Projects: read (org-owned
  projects; App tokens rotate hourly). Store it as a repository/organization secret, never in
  config, comments, or artifacts.
- Advisory mode (default) with no token prints a notice and skips cleanly (exit 0) — no red X for a
  project that has not configured the token yet.
- Strict mode (`mode: strict`, release-gate opt-in) requires the token and fails with an actionable
  message when it is missing.
- Fork pull requests receive no secrets; the advisory PR run exercises the skip path.

## Caveats

- **Degraded rollup:** on private repos, a token without `checks: read` + `statuses: read` +
  `actions: read` cannot read `statusCheckRollup`; the post-merge audit degrades loudly (warning +
  job summary) to a closing-keyword/partial-PR-only audit and exits 0 — no false check-related OI.
  The caller block above grants all three, so keep it intact.
- **Forged/fork PRs:** fork-originated `pull_request` events get a read-only `GITHUB_TOKEN` by
  default. The post-merge audit's OI creation needs `issues: write`, so a merged fork PR can fail
  loudly at OI creation; the close guard and tracker audit are unaffected (read-only / advisory).
  Enable "Send write tokens to workflows from pull requests" only as a deliberate, documented
  decision.
- **Post-merge audit only runs on merged PRs.** The reusable workflow re-validates `state ==
  MERGED` via the API before auditing; a dispatch with a non-merged `pr-number` fails actionably.
- The tracker audit is advisory by default: PRs give live evidence without blocking. Do not add it
  to required PR checks unless the project records that decision; for a release gate use
  `mode: strict`.
- No artifacts: the tracker-audit JSON goes to the job log and a job summary (no upload); the other
  two write job summaries only.

## Rollback to v1.3.2 copies

If the migration must be reverted: restore the previously copied `tracker-audit.yml` /
`post-merge-audit.yml` / `pr-close-guard.yml` from the v1.3.2 tag (they run the scripts inline and
report the old contexts `audit` / `pr-close-guard`), restore the matching `guard.requiredChecks`
and branch protection contexts in the same PR, and re-pin `automation.templateVersion` to the
version you actually run. Do not mix old and new required contexts.

## Local parity

The audit scripts read `GITHUB_REPOSITORY`/`PR_NUMBER` from the environment (there is no
`--repo`/`--pr` flag); use the npm aliases with an authenticated `GH_TOKEN`:

```bash
# tracker audit (offline config + live project read when the token is set)
npm run audit -- --config tracker.config.json --advisory
npm run audit -- --config tracker.config.json --strict

# post-merge bypass audit (must target an already-merged PR)
GH_TOKEN="$(gh auth token)" GITHUB_REPOSITORY=owner/repo PR_NUMBER=123 \
  npm run audit:post-merge -- --config tracker.config.json

# PR close guard (fetches the live PR when PR_BODY/PR_BRANCH/PR_LABELS are unset)
GH_TOKEN="$(gh auth token)" GITHUB_REPOSITORY=owner/repo PR_NUMBER=123 npm run guard:pr-close
```

See [ACTIONS CATALOG §6](../../docs/ACTIONS_CATALOG.md#6-local-parity-commands) for the full parity
table and [UPGRADING](../../docs/UPGRADING.md) for the migration steps.
