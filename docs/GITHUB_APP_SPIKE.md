# GITHUB APP SPIKE

**Docs version:** `v1.2.2-docs.1` · Target template: `v1.2.2`

**Status:** complete (desk research + read-only API probes). No GitHub App was registered, installed, or credentialed; no live bot test was performed (see [Non-goals](#non-goals-and-scope-boundaries) and [Limitations](#7-limitations-and-follow-ups)).

**Timebox:** 1 hour (per task estimate 0.5–1h), spent on documented behavior + read-only repository probes. Desk research answered the assignment question, so no live app was needed.

Answers [issue #11](https://github.com/presljf/github-project-tracker/issues/11) (`1.0.0.2-T06`): can a GitHub App bot identity own/assign tracker issues, and what should the tracker do about it?

## Contents

- [Decision summary (go/no-go)](#decision-summary-gono-go)
- [Non-goals and scope boundaries](#non-goals-and-scope-boundaries)
- [1. Method and evidence classes](#1-method-and-evidence-classes)
- [2. Assignment feasibility on a personal repo](#2-assignment-feasibility-on-a-personal-repo)
- [3. Least-privilege permissions (if a bot identity is ever adopted)](#3-least-privilege-permissions-if-a-bot-identity-is-ever-adopted)
- [4. Token acquisition and expiry (Documented)](#4-token-acquisition-and-expiry-documented)
- [5. Security handling (no secrets in the repo)](#5-security-handling-no-secrets-in-the-repo)
- [6. Option A fallback (adopted default)](#6-option-a-fallback-adopted-default)
- [7. Limitations and follow-ups](#7-limitations-and-follow-ups)
- [8. Reproducible sanitized commands](#8-reproducible-sanitized-commands)
- [Sources](#sources)

## Decision summary (go/no-go)

| Question | Decision | Basis |
|---|---|---|
| Can a GitHub App bot be the **issue assignee** on this personal repo? | **NO-GO** | Documented assignee rules + read-only probes: bot accounts exist but are not assignable; assignee pool contains only the human owner. See [§2](#2-assignment-feasibility-on-a-personal-repo) |
| Can a GitHub App **comment / label / open PRs** with bot identity? | **GO** (documented, not live-tested) | Installation tokens act as `app-slug[bot]`; comments and PRs are attributed to the bot. See [§4](#4-token-acquisition-and-expiry-documented) |
| Can a GitHub App **write Projects v2 status** for this user-owned board? | **HOLD** (unverified) | Projects API documents installation tokens, but the app permission for projects is documented as an organization permission; this board is user-owned. Needs a sandbox test before trusting. See [§3.2](#32-projects-v2-hold-unverified) |
| Default human ownership path | **Option A retained** | Human assignee + `Executor:` check-in comment. Verified working in this repo today. See [§6](#6-option-a-fallback-adopted-default) |

**Recommendation for v1.0.0:** keep Option A as the only supported ownership model. Do **not** depend on a GitHub App for owner identity. Treat bot identity as an optional, later-phase automation convenience (comments/PRs only) behind the existing `automation.bot` flag — never as the assignee.

## Non-goals and scope boundaries

Per issue #11 and the repo's security rules, this spike did **not**:

- create or install a persistent GitHub App, generate private keys, or mint installation tokens;
- create a machine user account;
- write secrets, tokens, or app IDs into the repo, config, comments, or logs;
- attempt a bulk/bot assignment write on a live issue (read-only probes only).

Write scope was `docs/GITHUB_APP_SPIKE.md` only. The schema already carries optional `automation.bot.enabled` / `automation.bot.appSlug`, and `tracker.config.json` already sets `"bot": { "enabled": false }`; no schema/config/playbook/README changes were needed or made.

## 1. Method and evidence classes

- **Sources:** GitHub official docs (permissions, assignees, installation tokens, GitHub Apps, Projects API), GitHub changelog, and read-only GitHub API calls against this repository with the maintainer's `gh` user token (`project`/`repo` scopes; no app credentials).
- **Probes:** all repository/API calls in [§8](#8-reproducible-sanitized-commands) are GET requests (read-only). The only issue mutations were the required process operations on #11 (assignee, Project Status, check-in comment).
- **Evidence labeling:** each finding is marked **Verified (this repo)**, **Documented (GitHub)**, or **Assumed/unverified**. Documented behavior is not a live test on this repo.

## 2. Assignment feasibility on a personal repo

### 2.1 Repository and board facts (Verified)

```text
$ gh api repos/presljf/github-project-tracker \
    --jq '{owner:.owner.type,private,visibility}'
{"owner":"User","private":true,"visibility":"private"}
```

```text
$ gh api graphql -f query='query { node(id: "PVT_kwHOAQF9684BrMCF") {
      ... on ProjectV2 { title owner { __typename ... on User { login } } } } }'
{"title":"Project Tracker OS","owner":{"__typename":"User","login":"presljf"}}
```

- Repo owner is a **user account** (`presljf`), repo is private — a personal repository, not an organization repository.
- The tracker board is a **user-owned Projects v2** board (`Project Tracker OS`, owner `presljf`).

### 2.2 Why an app bot cannot be the assignee (Documented)

- Issue/PR assignees are **users**: GitHub documents that you can assign yourself, anyone who commented, anyone with write permission, and organization members with read permission; issues support up to 10 assignees ([Assigning issues and pull requests](https://docs.github.com/en/issues/tracking-your-work-with-issues/assigning-issues-and-pull-requests-to-other-github-users)). The same doc notes that you "may also be able to assign Copilot to an issue" — the only documented non-human exception.
- The assignability check endpoint is explicit: it returns `204` when an actor can be assigned and `404` otherwise ([REST: issue assignees](https://docs.github.com/en/rest/issues/assignees)).
- GitHub App bot accounts are **built into every GitHub App**, are never granted a password, and act through installation tokens; an installation token identifies the app as a bot account such as `@jenkins[bot]` ([Differences between GitHub Apps and OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)). Bot identity is an authentication identity, not a repository collaborator.
- Practical consequence (Documented + Verified): because the bot is not a user with repository access, the assignability check answers `404` for bot logins even though those bot accounts exist.
- The only sanctioned *agent assignment* is the GitHub Copilot cloud agent, a paid-Copilot feature with its own API (`GraphQL-Features: issues_copilot_assignment_api_support`, `agent_assignment`/`agentAssignment` inputs). Its documented examples authenticate as a **user** token, and it dispatches Copilot rather than recording a generic bot owner ([changelog](https://github.blog/changelog/2025-12-03-assign-issues-to-copilot-using-the-api/)). It is not a way to make an arbitrary App the assignee.

### 2.3 Read-only probe evidence (Verified)

Current assignee and assignable actors:

```text
$ gh issue view 11 --json assignees --jq '[.assignees[].login]'
["presljf"]

$ gh api repos/presljf/github-project-tracker/assignees --jq '[.[].login]'
["presljf"]

$ gh api graphql -f query='query { repository(owner:"presljf", name:"github-project-tracker") {
    suggestedActors(capabilities: [CAN_BE_ASSIGNED], first: 10) {
      nodes { login __typename } } } }'
{"data":{"repository":{"suggestedActors":{"nodes":[{"login":"presljf","__typename":"User"}]}}}}
```

Assignability checks for the human owner vs. bot accounts (bot accounts exist, but are not assignable):

```text
$ gh api repos/presljf/github-project-tracker/assignees/presljf -i | head -1
HTTP/2.0 204 No Content

$ gh api 'repos/presljf/github-project-tracker/assignees/dependabot%5Bbot%5D' -i | head -1
HTTP/2.0 404 Not Found

$ gh api 'repos/presljf/github-project-tracker/assignees/github-actions%5Bbot%5D' -i | head -1
HTTP/2.0 404 Not Found

$ gh api 'repos/presljf/github-project-tracker/assignees/copilot-swe-agent%5Bbot%5D' -i | head -1
HTTP/2.0 404 Not Found

$ gh api 'users/dependabot%5Bbot%5D' --jq '{login,type}'
{"login":"dependabot[bot]","type":"Bot"}
```

The `404`s are *not* because bot accounts do not exist — `users/dependabot[bot]`, `users/github-actions[bot]`, and `users/copilot-swe-agent[bot]` all resolve as `type: "Bot"`. It means those actors cannot be assigned in this repository, consistent with the documented assignee model. Copilot is additionally not enabled for this repo (no `Bot` node in `suggestedActors`); that is expected for a personal repo without a paid Copilot plan.

### 2.4 Verdict (NO-GO)

A GitHub App bot cannot be the issue assignee on this personal repository: GitHub's assignee model is user-based (plus the Copilot dispatch exception), and read-only probes confirm bot actors are not in the assignable pool. Do not build the tracker's owner identity on app assignment. Use bot identity only for unattributed automation output (comments, labels, PRs, checks). The fallback in [§6](#6-option-a-fallback-adopted-default) is the supported path.

## 3. Least-privilege permissions (if a bot identity is ever adopted)

Only relevant if a later phase uses a bot for **comments/PRs/checks**; assignment is not achievable with any permission set.

### 3.1 Least-privilege permission set

| Permission | Level | Why | Notes |
|---|---|---|---|
| `metadata` | read | Repo metadata, collaborators read; needed for most repo endpoints | Implicit/mandatory for all GitHub Apps; request it explicitly in token narrowing for clarity |
| `issues` | write | Create/edit issue comments, apply labels; the bot's output lands on issues | Does **not** make the bot assignable |
| `contents` | read | Read files/branches for audit checks and docs state | `contents: write` only if the bot must push commits — prefer human/PR flow |
| `pull requests` | write (optional) | Bot opens/comments on PRs if it is the PR actor | Skip if a human opens PRs |
| `projects` | — | Project status updates | Documented as an **organization** permission; user-owned board access unverified — see §3.2 |
| `administration`, `secrets`, `members`, `workflows`, `actions: write`, org permissions | — | Not needed for this tracker | Never request |

Token minting can be further narrowed per run: the `POST /app/installations/{installation_id}/access_tokens` request accepts `repositories` (up to 500) and `permissions` (a subset of what the app was granted), and the response reports the effective permissions/repositories ([Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)).

The task's stated least-privilege set — **Issues write, Metadata read, Contents read** — is therefore correct for a comment/read-only bot; anything more is optional and should be justified per workflow.

### 3.2 Projects v2 (HOLD, unverified)

- Documented: the Projects GraphQL API accepts an **installation access token for a GitHub App** as the token for the examples shown ([Using the API to manage Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)).
- Documented: GitHub App `Projects` permission is listed under **organization** permissions, and organization permissions only apply "if it is installed on an organization account" ([Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)).
- This board is **user-owned**. Whether a personal-account installation token can read/update a user-owned Projects v2 item is not clearly documented and was **not** tested here. Treat it as unverified and keep project-field writes on the human `gh` token (`project` scope), as the tracker does today.

## 4. Token acquisition and expiry (Documented)

Server-to-server GitHub App auth is two-step — no user interaction:

1. **JWT** signed `RS256` with the app private key. Claims: `iss` = app client ID (recommended) or app ID, `iat` 60s in the past for clock drift, `exp` **no more than 10 minutes** into the future ([Generating a JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)).
2. **Installation access token** from `POST /app/installations/{installation_id}/access_tokens` with `Authorization: Bearer <JWT>`. The token **expires after 1 hour**; the response includes `expires_at`, effective `permissions`, and accessible repositories ([Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)).

Sanitized acquisition pattern (placeholders only — never committed, never echoed):

```bash
# Private key lives OUTSIDE the repo: keychain/secret store on a workstation, or a CI secret.
APP_ID="<app-id>"
INSTALLATION_ID="<installation-id>"
PEM_PATH="<path-outside-repo>/app.private-key.pem"

b64url() { openssl base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n'; }
now=$(date +%s)
header=$(printf '{"typ":"JWT","alg":"RS256"}' | b64url)
payload=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$((now - 60))" "$((now + 540))" "$APP_ID" | b64url)
signature=$(printf '%s' "$header.$payload" | openssl dgst -sha256 -sign "$PEM_PATH" | b64url)
JWT="$header.$payload.$signature"

# Mint a narrow, 1-hour installation token for exactly one repo.
# Do not print the token; do not persist it beyond the job.
gh api --method POST "/app/installations/$INSTALLATION_ID/access_tokens" \
  -H "Authorization: Bearer $JWT" \
  --input - <<'JSON' --jq '{expires_at, permissions}'
{"repositories":["github-project-tracker"],
 "permissions":{"issues":"write","contents":"read"}}
JSON
```

Operational rules:

- **Mint per run**: the app JWT lasts ≤10 minutes, the installation token 1 hour. Do not cache the installation token beyond `expires_at`; on `401`, re-mint instead of retrying forever.
- **Use the token as a bearer token** (`GH_TOKEN` for `gh`, `Authorization: Bearer` for `curl`). It is not a user session; it cannot sign in to the UI.
- **Token format caveat:** GitHub began a staged rollout (from 2026-04-27) of a stateless installation-token format; code must not assume the historic 40-character length ([same docs page](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)).
- In Actions, the documented pattern is minting via an action (e.g. `actions/create-github-app-token`) and consuming a short-lived token; **no workflow was added in this task** — this note is for a future automation phase only.

## 5. Security handling (no secrets in the repo)

- **Private key:** grants access to every account where the app is installed. Store it in a key vault/secret store (or CI secret) — never in the repo, config, issue, or logs; consider sign-only storage where available ([Best practices for creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)). Private keys **do not expire** and must be revoked manually; apps can hold multiple keys so you can rotate without downtime (up to 25) ([Managing private keys](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)).
- **App visibility:** if a sandbox app is ever registered, choose "Only on this account" so it cannot be installed elsewhere; install it on selected repositories only.
- **Config is not a secret store:** `automation.bot` holds only `enabled`/`appSlug`; the schema's `additionalProperties: false` rejects unknown fields such as app IDs, installation IDs, or keys, and the config validator rejects values that look like secrets (`scripts/github/validate-config.mjs`).
- **Lifecycle:** after any sandbox test — uninstall the app, delete the app registration, delete/revoke its private keys, and let installation tokens expire. Record the revocation.
- **Log/comment hygiene:** never echo tokens (`set +x`, no `--verbose` logging of auth headers); mask in CI; sanitize any captured output before pasting into issues/PRs.
- **Least privilege:** request only the permissions in §3; narrow each token to the required repo(s) and permission subset; keep a human in the loop for merges and protected branches (a bot token only bypasses branch protection if an admin explicitly adds the app as a bypass actor, which this tracker should not do).
- **No machine user:** per issue non-goals, do not substitute a machine-user personal account (it consumes a seat, needs a password/2FA, and is a bigger blast radius than an App).

## 6. Option A fallback (adopted default)

**Human assignee + Executor comment** — already the tracker's documented behavior:

- Assignee: a human with push access (`presljf` on this repo). This is the only assignee the platform supports here.
- Attribution: the check-in comment records `Owner:` / `Executor: agent:<run/session>` ([check-in template](./comment-templates/check-in.md), [AGENT GUIDE](./AGENT_GUIDE.md)).
- Confirmed for issue #11: assigned to `presljf`, check-in posted, Project Status set to In Progress. Other tracker docs already phrase ownership as "human or bot identity" ([playbook](./GITHUB_PROJECT_TRACKER_PLAYBOOK.md) §owner rules), which remains accurate: the *owner* is the human; the *executor* may be an agent.

Why it is the right default:

- works on personal repos with no app, no secrets, no permission surface;
- keeps a human accountable for scope/merge/review;
- full audit trail in issue comments/PR timeline;
- no dependency on GitHub features that may change (Copilot assignment preview, app permission semantics).

Limitations: the Assignees field shows the human, not the agent; agent attribution is textual (`Executor:` line); no webhook/automation identity. If agent visibility becomes a requirement, add a label (e.g. `executor:agent`) rather than an app assignee — labels are first-class and permission-cheap — or adopt bot comments (§3–§5) while keeping the human assignee.

## 7. Limitations and follow-ups

- **Not live-tested (by design):** no app registration/installation, no private key, no installation token, no bot comment/PR, no assignment attempt write, no project write with an app token. All bot-identity statements above are *documented*, not verified on this repo.
- **Probe caveat:** the read-only assignability checks used GitHub's own bot accounts (`dependabot[bot]`, `github-actions[bot]`, `copilot-swe-agent[bot]`), not a repo-installed App bot, because no App was registered. A repo-installed App's bot is subject to the same documented user-based assignee model, but that specific actor was not exercised.
- **Unverified:** whether a personal-account installation token can read/write this user-owned Projects v2 board; the exact REST error when adding a bot login as assignee (documented behavior is that it would not take effect; not attempted to avoid a mutation).
- **Copilot agent assignment:** not tested; requires a paid Copilot plan and is a dispatch mechanism, not a generic ownership identity.
- **Docs index:** `docs/README.md` was intentionally not edited (out of scope for this task); the integrator can add a link here if this spike is accepted.
- **Schema:** no changes needed — `automation.bot.enabled`/`appSlug` already exist ([schema](../schemas/tracker.config.schema.json), [REFERENCE](./REFERENCE.md) `automation` row); `tracker.config.json` already disables it.
- **Revisit trigger:** revisit only if (a) the board moves to an organization where app project permissions are documented, (b) GitHub ships assignable bot actors for GitHub Apps, or (c) a genuine automation need for bot-authored comments/PRs appears — then re-run a timeboxed sandbox test.

**If approved, a future sandbox test (30–45 min, separate task) would:** register a throwaway private app ("only on this account", no webhook), install it on a scratch private repo with only Metadata read + Issues write (+ Contents read), mint a 1-hour installation token, then attempt (1) bot comment (expected: works, attributed to `<slug>[bot]`), (2) add bot as issue assignee (expected: no effect/422; document actual), (3) update a user-owned ProjectV2 status (expected: unknown — the decisive Projects test), and finally uninstall/delete the app and revoke keys. All credentials stay out of the repo, config, comments, and logs.

## 8. Reproducible sanitized commands

Read-only probes (any maintainer with `gh` auth; no app needed):

```bash
# ownership and board type
gh api repos/presljf/github-project-tracker --jq '{owner:.owner.type,private,visibility}'
gh api graphql -f query='query { node(id: "PVT_kwHOAQF9684BrMCF") {
    ... on ProjectV2 { title owner { __typename ... on User { login } } } } }'

# current assignees and the assignable-actor pool
gh issue view 11 --repo presljf/github-project-tracker --json assignees --jq '[.assignees[].login]'
gh api repos/presljf/github-project-tracker/assignees --jq '[.[].login]'
gh api graphql -f query='query { repository(owner:"presljf", name:"github-project-tracker") {
    suggestedActors(capabilities: [CAN_BE_ASSIGNED], first: 10) { nodes { login __typename } } } }'

# assignability checks: 204 = assignable, 404 = not assignable
gh api repos/presljf/github-project-tracker/assignees/presljf -i | head -1
gh api 'repos/presljf/github-project-tracker/assignees/dependabot%5Bbot%5D' -i | head -1
gh api 'users/dependabot%5Bbot%5D' --jq '{login,type}'   # the bot account does exist
```

Documented commands (no live execution in this task): JWT + installation-token mint in [§4](#4-token-acquisition-and-expiry-documented). Placeholders `<app-id>`, `<installation-id>`, `<path-outside-repo>` are never real values in this repo.

## Sources

- [Assigning issues and pull requests](https://docs.github.com/en/issues/tracking-your-work-with-issues/assigning-issues-and-pull-requests-to-other-github-users)
- [REST API endpoints for issue assignees](https://docs.github.com/en/rest/issues/assignees)
- [Differences between GitHub Apps and OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)
- [Generating a JWT for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
- [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app) · [Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
- [Best practices for creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app) · [Managing private keys](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)
- [Using the API to manage Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)
- [Assign issues to Copilot using the API (changelog)](https://github.blog/changelog/2025-12-03-assign-issues-to-copilot-using-the-api/)
