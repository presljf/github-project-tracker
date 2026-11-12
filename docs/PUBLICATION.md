# PUBLICATION

**Docs version:** v1.2.0-docs.1 · Target template: v1.2.0
**Status:** public template repository — decision recorded 2026-11-11 (T01, [#39](https://github.com/presljf/github-project-tracker/issues/39)); publication/security checklist completed 2026-11-11 (T04, [#42](https://github.com/presljf/github-project-tracker/issues/42)).
**Owner:** repository maintainer. Re-run §3 whenever visibility, license, security settings, maintainers, secrets, or release gating change, and before each release tag.
**Scope:** publication posture and security checklist for this repository. Security reporting policy is [SECURITY.md](../SECURITY.md); downstream intake is [DOWNSTREAM_FEEDBACK.md](./DOWNSTREAM_FEEDBACK.md).

---

## 1. Current status

| Setting | Current state | Evidence |
|---|---|---|
| Repository visibility | **Public** | `gh api repos/presljf/github-project-tracker` → `visibility: public` |
| Template repository | **Enabled** (`is_template: true`) | `README.md` "Use this template" instructions |
| Default branch | `main` | Repository API |
| License | **MIT** | `LICENSE` committed; GitHub license API reports MIT |
| Private vulnerability reporting | **Enabled** | `PUT /repos/.../private-vulnerability-reporting` → HTTP 204; `GET` → `{"enabled":true}` (2026-11-11) |
| Dependabot security updates | Enabled | `security_and_analysis.dependabot_security_updates.status = enabled` |
| Secret scanning / push protection | **Disabled** — recommended follow-up (§7) | `security_and_analysis.secret_scanning* = disabled` |
| SHA-pinning requirement | Not enforced by the platform; actions are pinned by SHA by convention | [CI/security profile](./CI_SECURITY_PROFILE.md#8-action-sha-pinning) |
| Default workflow token | Read-only (`default_workflow_permissions: read`) | `gh api repos/.../actions/permissions/workflow` |
| Branch protection / rulesets | Available now that the repo is public; **pending T03 ([#41](https://github.com/presljf/github-project-tracker/issues/41) is Blocked)** | [CI/security profile §3](./CI_SECURITY_PROFILE.md#3-required-check-and-branch-protection-contract) |
| GitHub Releases | None published yet; tags `v1.0.0` and `v1.2.0` exist | `gh release list` (empty); `git tag` |
| Release gate | **No public release/announcement without explicit maintainer approval** | [Release tracker #45](https://github.com/presljf/github-project-tracker/issues/45) gates |

---

## 2. Public-transition decision

- **Date:** 2026-11-11.
- **Decision:** make this repository a **public template repository**.
- **Driver:** private cross-repo reusable-workflow/composite-action access was blocked from a downstream repo (`workflow was not found`). The same downstream test resolved and ran the reusable CI workflow and remote composite action successfully once the template was public. Full result: [ACTIONS CATALOG §8.5](./ACTIONS_CATALOG.md#85-privatepublic-cross-repo-reuse-validation-before-choosing-reusable-mode). Copy-mode fallback remains documented ([§8.6](./ACTIONS_CATALOG.md#86-public-template-fallback)).
- **Caveats accepted:** public source and history are readable; no secrets/vulnerability details may ever be committed; publication is not a release announcement (release gating stays with the release tracker).
- **Rollback:** if a critical exposure is found, make the repository private, notify affected downstream users through a private/security channel, re-validate reusable-workflow consumers (they will need copy mode while private), rotate any exposed credentials, and record the reversal and reason on the roadmap/release trackers. Do not rewrite public history to hide an incident; coordinate disclosure instead.

---

## 3. Publication and security checklist

Legend: **PASS** = verified now; **PENDING** = tracked in another task; **FOLLOW-UP** = recommended action owned by the maintainer.

| # | Item | Requirement | Status | Evidence / owner |
|---|---|---|---|---|
| 1 | Visibility and template | Public repo with template repository enabled, README usable from GitHub "Use this template" | **PASS** | Repository API (`visibility: public`, `is_template: true`); `README.md` |
| 2 | License | MIT license committed and detected | **PASS** | `LICENSE`; GitHub license API |
| 3 | No secrets in working tree | Docs/secret scan clean; no credential files tracked | **PASS** | `npm run docs:check` → 50 files, links/fences clean, no secret-like patterns (2026-11-11, includes this page); filename scan found only the legitimate token-matrix card files |
| 4 | No secrets in git history | No token/private-key patterns in history | **PASS** | `git log -p --all` scanned for GitHub PATs, AWS keys, private keys, Slack tokens → 0 matches (2026-11-11) |
| 5 | Issue forms | Bug and feature forms valid YAML; required context enforced; security redirection | **PASS** | `.github/ISSUE_TEMPLATE/downstream-{bug,feature}.yml` parse OK; forms updated with supported-version confirmation and private-reporting guidance |
| 6 | Downstream intake and triage | Labels, Project add, `Source` field, type/milestone/fields, decision comment, close → Done, docs and no-fork/versioning guidance | **PASS** | Form-equivalent walkthrough [#62](https://github.com/presljf/github-project-tracker/issues/62) (bug) and [#63](https://github.com/presljf/github-project-tracker/issues/63) (feature) created, labelled, added to the Project, triaged, closed not-planned with Project status Done (2026-11-11); [DOWNSTREAM_FEEDBACK](./DOWNSTREAM_FEEDBACK.md#triage-and-labels) updated |
| 7 | Private vulnerability reporting | Enabled on the public repo; SECURITY.md points to the private channel | **PASS** | API `PUT` → HTTP 204, `GET` → `{"enabled":true}`; [SECURITY.md](../SECURITY.md) updated; advisory form: <https://github.com/presljf/github-project-tracker/security/advisories/new> |
| 8 | Dependency/security features | Dependabot updates on; CodeQL opt-in; secret scanning/push protection | **PARTIAL** | Dependabot security updates enabled; CodeQL opt-in in [CI/security profile](./CI_SECURITY_PROFILE.md#43-codeql-opt-in); **secret scanning + push protection disabled** — recommend enabling (monthly review) |
| 9 | Branch protection / required checks | Required CI checks, PR reviews, force-push/deletion blocks, tag rules | **PENDING** | Available now that the repo is public; owned by T03 ([#41](https://github.com/presljf/github-project-tracker/issues/41)); contract in [CI/security profile §3](./CI_SECURITY_PROFILE.md#3-required-check-and-branch-protection-contract) |
| 10 | Actions hardening | SHA-pinned actions, least-privilege permissions, no secrets on untrusted PRs | **PASS** | [CI/security profile](./CI_SECURITY_PROFILE.md#8-action-sha-pinning); default workflow token read-only |
| 11 | Release gating | No release without approval; tags/versions/artifacts/checksums checked | **PASS** (gate) | Release tracker [#45](https://github.com/presljf/github-project-tracker/issues/45); tags exist, GitHub Releases not yet published (release task) |
| 12 | Reporting channels advertised | README/docs/forms/config link security and downstream intake | **PASS** | `README.md`, `.github/ISSUE_TEMPLATE/config.yml`, [SECURITY.md](../SECURITY.md), [DOWNSTREAM_FEEDBACK](./DOWNSTREAM_FEEDBACK.md), [reporting card](./reference-cards/reporting-upstream.md) |
| 13 | Docs set | Publication status documented and linked from security/downstream docs; docs checks pass | **PASS** | This page; `npm run docs:check`; docs index entry for this page is a docs-index owner follow-up (§7) |
| 14 | Maintainer/ownership | Admin access recorded; new maintainers briefed before publication changes | **PASS for single maintainer** | `@presljf` admin; re-run checklist when maintainers change |

---

## 4. Evidence log (2026-11-11)

**Private vulnerability reporting**

```bash
$ gh api --method PUT repos/presljf/github-project-tracker/private-vulnerability-reporting -i
HTTP/2.0 204 No Content

$ gh api repos/presljf/github-project-tracker/private-vulnerability-reporting
{"enabled":true}
```

**Repository posture**

```bash
$ gh api repos/presljf/github-project-tracker \
    --jq '{visibility,is_template,license:.license.spdx_id,security_and_analysis}'
{"visibility":"public","is_template":true,"license":"MIT",
 "security_and_analysis":{"dependabot_security_updates":{"status":"enabled"},
 "secret_scanning":{"status":"disabled"},
 "secret_scanning_non_provider_patterns":{"status":"disabled"},
 "secret_scanning_push_protection":{"status":"disabled"},
 "secret_scanning_validity_checks":{"status":"disabled"}}}
```

**Downstream walkthrough (both reports closed not-planned; Project status Done)**

| Report | Type | Labels at creation | Triage evidence | Final state |
|---|---|---|---|---|
| [#62](https://github.com/presljf/github-project-tracker/issues/62) | Bug | `source:downstream`, `status:needs-triage` | Project added manually (auto-add did not pick it up); Source=`Other`, Area=`docs`, Kind=`fix`, Estimate=`S`; native type `Bug`; milestone `v1.1.0`; `status:needs-triage` removed; triage + cleanup comments | Closed `not_planned`; Project status `Done` |
| [#63](https://github.com/presljf/github-project-tracker/issues/63) | Feature | `source:downstream`, `status:needs-triage` | Same path; Source=`Other`, Area=`docs`, Kind=`feature`, Estimate=`S`; native type `Feature`; milestone `v1.1.0`; decision **deferred** (walkthrough artifact); `status:needs-triage` removed | Closed `not_planned`; Project status `Done` |

Note: `Release`/`Sprint` fields were intentionally **not** set on these scratch artifacts so the walkthrough did not add work to the v1.1.0 sprint/release trackers. Real downstream triage sets them when scheduling (documented in [DOWNSTREAM_FEEDBACK](./DOWNSTREAM_FEEDBACK.md#triage-and-labels)).

**Repository hygiene**

```bash
$ npm run docs:check
docs check OK — 50 Markdown files; links/anchors/fences clean; no secret-like patterns.

$ git log -p --all | grep -E 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY|AKIA[0-9A-Z]{16}|xox[baprs]-' | wc -l
0
```

No `.env`, credential, `.pem`, `.p12`, or private-key files are tracked (filename scan; the only matches are the intentional token-matrix reference-card files).

---

## 5. Checklist rerun procedure

```bash
gh api repos/presljf/github-project-tracker \
  --jq '{visibility,is_template,license:.license.spdx_id,security_and_analysis}'
gh api repos/presljf/github-project-tracker/private-vulnerability-reporting
gh api repos/presljf/github-project-tracker/actions/permissions/workflow
gh release list --repo presljf/github-project-tracker || true
git tag --sort=-v:refname | head -5
npm run docs:check
npm test
node scripts/github/validate-config.mjs tracker.config.json
```

Record the results here (dated) whenever publication/security settings change; T12 fresh-eyes review validates this page before the release tag.

---

## 6. Publication gates and triggers

- **No public release or announcement without explicit maintainer approval** (release tracker gate). Publication of the *repo* is not publication of a *release*.
- **Gate for future releases:** checklist §3 PASS/PENDING dispositions reviewed; `npm test`, `npm run docs:check`, config validation, and tracker audit run; release notes and checksums ready; rollback documented.
- **Re-run this checklist when:** visibility changes (public ↔ private), license or governance changes, maintainers are added/removed, secrets/tokens are added to CI, security settings change (private reporting, secret scanning, Dependabot, CodeQL, branch protection/rulesets), a public security incident occurs, or the template repository flag changes.
- **Never:** commit secrets, publish vulnerability details pre-disclosure, enable `pull_request_target` with untrusted code, or tag a release that fails the release gates.

---

## 7. Known gaps and follow-ups

| Gap | Impact | Owner / next action |
|---|---|---|
| `tracker.config.json` governance still says `publication.status: "private"` and `security.privateVulnerabilityReporting: false` | Config examples understate current state | Config owner (out of T04 write scope): update config/docs pin follow-up; schema already supports both fields |
| Secret scanning + push protection disabled | Leaked-secret detection relies on review/docs scan | Maintainer: enable GitHub secret scanning/push protection (free for public repos) and record here |
| Branch protection/rulesets not enabled | Required checks/reviews not platform-enforced | T03 [#41](https://github.com/presljf/github-project-tracker/issues/41) once unblocked; contract in CI/security profile §3 |
| No GitHub Releases for `v1.0.0`/`v1.2.0` tags | Tag exists without release notes/artifacts | Release task per [#45](https://github.com/presljf/github-project-tracker/issues/45); do not publish without approval |
| `docs/README.md` index does not list this page | Discoverability | Docs-index owner (out of T04 write scope) |
| Reference-card generator constants still print `v1.0.0-docs.1` / target template `v1.0.0` after the T05 docs bump to v1.2.0 (card Markdown metadata is v1.2.0), and repo-root relative links are rewritten as `docs/../<file>` in generated HTML/PDF | Regenerated card headers understate the docs/template version; a few print links are malformed | Scripts/docs owner (out of T04 write scope): update `DOCS_VERSION`/`TARGET_TEMPLATE` and root-relative link rewriting in `scripts/docs/build-cards.mjs`, then regenerate all cards |
| Community files: CONTRIBUTING/CODE_OF_CONDUCT absent (community health 71%) | Lower contributor guidance | Maintainer decision; not a security blocker |
| Default workflow token is read-only (good) but SHA-pinning is convention-only | Action refs verified by review, not platform policy | Maintainer may enable the SHA-pinning requirement; record here if enabled |
