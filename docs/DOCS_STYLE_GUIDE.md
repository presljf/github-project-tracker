# DOCS STYLE GUIDE

**Docs version:** `v1.0.2-docs.1` · Target template: `v1.0.2`
**Status:** authored by T13; authoritative for the documentation suite. T12 uses the [review checklist](#11-review-checklist-t12) as the fresh-eyes gate. The printable reference cards follow the same voice and rules.
**Scope:** Markdown documentation in this repository (playbook, HOW TO USE suite, reference, troubleshooting, adoption/upgrade guides, agent guide, policies, indexes, and reference cards). Code comments and issue-form YAML are out of scope, except where docs quote them.

Documentation is a hard `v1.0.0` gate: exhaustive is not enough — it must be current, consistent, and maintainable. This guide defines how.

---

## Contents

- [1. Authority and document roles](#1-authority-and-document-roles)
- [2. Audience and voice](#2-audience-and-voice)
- [3. Page types and required structure](#3-page-types-and-required-structure)
- [4. Commands and expected output](#4-commands-and-expected-output)
- [5. Terminology and glossary](#5-terminology-and-glossary)
- [6. Links and cross-references](#6-links-and-cross-references)
- [7. Screenshots, diagrams, and assets](#7-screenshots-diagrams-and-assets)
- [8. Reference-card standard](#8-reference-card-standard)
- [9. Versioning and deprecation](#9-versioning-and-deprecation)
- [10. Docs-in-the-same-PR rule](#10-docs-in-the-same-pr-rule)
- [11. Review checklist (T12)](#11-review-checklist-t12)
- [12. Editing workflow and tools](#12-editing-workflow-and-tools)
- [13. Quick decisions](#13-quick-decisions)
- [Related](#related)

## 1. Authority and document roles

Each document has one job. Do not duplicate another document's job; link to it.

| Document | Role | Authority for |
|---|---|---|
| [Playbook](./GITHUB_PROJECT_TRACKER_PLAYBOOK.md) | Conceptual model and decisions | Why the tracker works this way |
| [HOW TO USE](./HOW_TO_USE.md) | Task-oriented handbook | Doing the work end to end |
| [REFERENCE](./REFERENCE.md) | Lookup tables | Commands, fields, statuses, tokens, workflows |
| [TROUBLESHOOTING](./TROUBLESHOOTING.md) | Symptom → cause → fix | Failure handling |
| [ADOPTION](./ADOPTION.md) / [UPGRADING](./UPGRADING.md) | Onboarding and version transitions | Zero-to-first-task; pin/upgrade/rollback |
| [AGENT GUIDE](./AGENT_GUIDE.md) | Agent operating protocol | Agent-specific rules and boundaries |
| [ACTIONS CATALOG](./ACTIONS_CATALOG.md) / [CI/security profile](./CI_SECURITY_PROFILE.md) | Actions contracts and profile | Workflows, triggers, tokens, runners |
| [Reference cards](./reference-cards/README.md) | One-page print summaries | Fast reminders only — never the only source |
| [SECURITY.md](../SECURITY.md) / [SUPPORT.md](../SUPPORT.md) | Policies | Reporting boundaries |

Rules:

- **REFERENCE is normative for commands and fields.** If a command exists in code and is documented only in prose, add it to REFERENCE.
- **HOW TO USE is authoritative for procedure.** Other docs summarize and link.
- **Cards are summaries.** Detail stays in the handbook/reference; cards always cross-link.
- If two documents disagree, fix both in the same PR — never leave a contradiction.

---

## 2. Audience and voice

| Audience | Reads | Needs |
|---|---|---|
| Operator/maintainer | HOW TO USE, REFERENCE, cards | Exact steps, expected results, recovery |
| Adopting project | ADOPTION, QUICKSTART, UPGRADING | Preconditions, config, version pinning |
| Agent | AGENT GUIDE, task issue | Constraints, scope, evidence rules |
| Reviewer/T12 | style guide, playbook, reference | Checklist and canonical sources |

Voice and mechanics:

- **Direct, second person, imperative for steps:** “Run `gh auth status`.” Not “The user should perhaps run…”.
- **Present tense, active voice, short sentences.** One instruction per sentence in procedures.
- **Explain before or after the action, not instead of it:** why it matters, what happens on failure, how to recover.
- **No marketing, hype, filler, or personality.** Avoid “simply”, “just”, “obviously”, “easy”, “powerful”, “revolutionary”.
- **No chat transcripts or session context:** no “as discussed”, “per your request”, “I ran”, “AI says”. The plan of record is issues and docs, not chat.
- **Do not invent future behavior.** Anything not shipped is marked **planned** with an issue/link and a manual fallback.
- **Plain language:** define jargon on first use; avoid idioms and culture-specific references; short paragraphs (2–5 sentences); bullet lists for parallel items.
- **Accessibility:** descriptive headings and links, no color-only meaning, code readable at default zoom, alt text for images.
- **Humans and agents share the same voice.** Agent-specific protocol belongs in AGENT GUIDE only.

Do / don’t:

| Do | Don’t |
|---|---|
| “The command fails when the token lacks `project` scope. Run `gh auth refresh -s project`.” | “It might not work sometimes, try refreshing.” |
| “This is advisory: it exits 0 even with violations.” | “This should hopefully be safe.” |
| “Planned in T15; use the manual command below until then.” | “Coming soon!” |

---

## 3. Page types and required structure

Every page starts with:

1. **One H1 title** in sentence case.
2. **Docs version line:** `**Docs version:** vX.Y.Z-docs.N · Target template: vX.Y.Z`.
3. **One-line scope/purpose**, then audience and prerequisites when the page is task-oriented.

Required elements by type:

| Type | Required elements |
|---|---|
| Quickstart | Goal, prerequisites, numbered steps, expected result, next link |
| Handbook chapter | Goal, prerequisites, numbered procedure, verification, failure link, related links |
| Reference | Scope, tables with exact values, examples with expected output, version note |
| Troubleshooting | Symptom, cause, fix, verification; one failure per heading |
| Adoption/upgrade | Preconditions, steps, validation commands, rollback, version semantics |
| Agent guide | Non-negotiables, session start, work, review, boundaries, stop conditions |
| Card | One topic, one page, print formats, cross-links, version line |
| Index/README | Purpose, ordered reading table, availability/version note |
| Policy (security, support) | Scope, channel, what to include/exclude, expectations |

Structure conventions:

- Numbered H2 sections (`## 4. Token and secret matrix`) for long reference-style pages; short policy pages may use unnumbered H2s.
- H3 subsections are unnumbered (`### 4.1 Matrix`) or clearly scoped; never skip levels; maximum depth H4.
- Add a TOC for pages longer than ~200 lines; keep it in sync with headings.
- One topic per page; split when a page serves two different readers or jobs.
- End with a **Related / Next** block linking to the next useful document.
- Mark planned behavior inline (`**planned**`) with its owner/issue and fallback; do not hide it in a footer.

---

## 4. Commands and expected output

- **Copy-pasteable.** Every command must run as written after substituting placeholders. No pseudo-shell, no mix of explanation inside the command line.
- **Placeholders are uppercase:** `OWNER/REPO`, `PROJECT_NUMBER`, `ITEM_ID`, `FIELD_ID`, `OPTION_ID`, `ISSUE_URL`. Explain how to discover IDs before first use.
- **Prerequisites and side effects stated:** auth/scopes, network use, whether the command mutates GitHub, whether it is safe to re-run. Use `--dry-run` examples for mutations when the tool supports it.
- **Expected output:** show the success line, or state “no output on success”; show exit-code behavior when failure matters (`advisory exits 0; strict exits 1 on violations`).
- **Errors belong in TROUBLESHOOTING**, not inline in every procedure; link the symptom heading.
- **Never show real secret values, token strings, personal data, or internal URLs.** Use `<token>`, `${{ secrets.NAME }}`, or environment-variable names only.
- **Planned commands:** label **planned**, name the delivering task, and give the manual `gh`/UI fallback.
- **Cross-platform:** note macOS/Linux differences (for example `shasum -a 256` vs `sha256sum`); label Windows-only steps.
- **Fences are language-tagged:** `bash`, `json`, `yaml`, `js`, `text`, `mermaid`. Output-only blocks use `text`. Do not leave fences unlabeled.
- **Formatting:** one command per line or short related blocks; comments inside code start with `#`; annotate expected output as a comment only when the line is short, otherwise use a separate `text` block.
- **Destructive commands** state the target and guard variables: `gh api "repos/${OWNER:?}/${REPO:?}"`; never use unset-variable-prone paths.

Canonical expected outputs live in [REFERENCE §19](./REFERENCE.md#19-expected-outputs-and-diagrams). Reuse them exactly; update both places when behavior changes.

---

## 5. Terminology and glossary

Canonical glossary: [HOW TO USE §18](./HOW_TO_USE.md#18-glossary). This section adds formatting rules; propose missing terms in the owning HOW TO USE PR rather than creating parallel glossaries.

| Term | Use | Notes |
|---|---|---|
| Project | GitHub Projects v2 board | Capitalize; code-format field values only |
| issue | GitHub issue | Lowercase in prose; `#123` in code |
| tracker | The configured Project + repo + workflow | Not “board” as a synonym |
| template / Project Tracker OS | This repository’s product | Lowercase “template” generically |
| release | Milestone/Release field value (`v1.0.0`) | Code-format version keys |
| sprint | Sprint field value (`1.0.0.2`) | Code-format keys |
| downstream / upstream | Adopting project / this template repo | Define once in playbook; link it |
| owner | Account responsible for a task | Assignee is the GitHub user; owner is the role |
| executor | Human or agent doing the work | Record separately for agent runs |
| reviewer / maintainer | Review and triage roles | See HOW TO USE §2 |
| check-in / check-out | Start/finish comment with evidence | Hyphenated, lowercase |
| WIP | Work in progress; one task per owner | Spell out on first use |
| DoR / DoD | Definition of Ready / Done | Spell out on first use |
| gate | Blocking dependency/exit criterion | Not a generic “blocker” |
| plan of record | Issues, fields, milestones | Chat is context only |
| card | Printable reference card | Not “cheat sheet” generically; both appear in card titles |
| docs version | `vX.Y.Z-docs.N` | Always code-formatted |

Formatting rules:

- Status names are exact: `Todo`, `In Progress`, `In Review`, `Blocked`, `Done` — code-formatted when referring to the field value; bold only for emphasis in procedures.
- Field names (Release, Sprint, Area, Kind, Estimate, Source) and their values are code-formatted.
- Product names: GitHub, GitHub Actions, GitHub Projects, Node.js, macOS, Markdown, Chrome. `gh` CLI is code-formatted lowercase.
- Labels are exact code strings (`risk:medium`, `plan-change`, `source:downstream`, `status:needs-triage`).
- Define acronyms at first use in each page (`DoR`, `DoD`, `WIP`, `OIDC`, `PAT`, `GHCR`).
- Do not invent synonyms for statuses, fields, or commands; consistency beats variety.

---

## 6. Links and cross-references

- **Internal links are relative** (`./HOW_TO_USE.md#13-audit`), never absolute repo URLs, so copies and renamed branches keep working.
- **Anchor links use GitHub’s slug rules:** lowercase, punctuation removed, spaces → hyphens. When renaming headings, update every inbound link in the same PR.
- **Link text is descriptive:** “see [audit invariants](./REFERENCE.md#12-audit-invariants)”, not “click here”.
- **Link to the canonical section instead of restating it.** Summarize at most one sentence, then link.
- **Minimum cross-links:** task-oriented pages link REFERENCE + TROUBLESHOOTING; behavior pages link playbook/REFERENCE; cards link handbook + reference; adoption links QUICKSTART/HOW TO USE; security content links SECURITY.
- **External links** go to authoritative sources (for example GitHub Docs, Apple notarization docs) with descriptive text. No link shorteners, affiliate links, or live third-party endpoints as required steps.
- **Issue forms / policies** use their canonical URLs; do not duplicate form questions in prose beyond a checklist.
- **The docs index** is [docs/README.md](./README.md). A PR that adds, renames, or moves a document updates the index (or explicitly hands the index update to the docs-index owner with a tracked follow-up).
- **Versioned links:** docs target the pinned template version; when a section applies only to a version, say so next to the link.

---

## 7. Screenshots, diagrams, and assets

- **Prefer text and Mermaid** for behavior, flows, and expected output; they are diffable and reproducible.
- **Screenshots only for UI-only state** (field editors, workflow toggles, protection settings) and only when sanitized.
- **Sanitization is mandatory:** no names/emails, tokens/cookies, webhook URLs, signed URLs, private repo names, or vulnerability details. Follow [docs/assets/README.md](./assets/README.md) exactly.
- **Alt text and captions:** every image has alt text describing the information, plus a caption if the image needs context; do not rely on color alone.
- **Naming and location:** `docs/assets/images/<topic>-<state>.png`; update the asset inventory/list in the same PR.
- **Reproducible snapshots:** expected-output blocks are text, not screenshots; capture board views as sanitized text tables where possible.
- **Mermaid:** fenced as `mermaid`, with the source kept in Markdown; keep labels free of secrets and personal data.
- **Print artifacts** (cards) are generated HTML/PDF, not screenshots; see §8.

---

## 8. Reference-card standard

The printable pack lives in [docs/reference-cards/](./reference-cards/README.md). Rules:

- **One page, one topic.** Optimize for A4 and US Letter; content is sized to fit both. Never shrink below readable print sizes — cut content instead.
- **Three artifacts:** Markdown source, generated print-ready HTML, and committed A4 + Letter PDFs. Generated files are not edited by hand.
- **Required content:** card number/title, docs version + target template, concise bullets/tables, primary cross-links, placeholders only, no secrets or chat context.
- **Regenerate in the same PR** when commands/fields/statuses/tokens/policies change: `node scripts/docs/build-cards.mjs`.
- **Print CSS must include `@page` size and print margins**; browser-print fallback is documented in the cards README.
- **Freshness gate:** T12 checks card content against the implemented CLI/config and regenerates with `--check` before the release tag.
- Cards summarize; if a card needs more than one page, move detail to the handbook and shorten the card.

---

## 9. Versioning and deprecation

- **Docs version format:** `vX.Y.Z-docs.N`, where `X.Y.Z` targets the template version and `N` increments for docs-only revisions in that target. State it once at the top of each page.
- Docs versions move with the template release; release notes list docs changes. Never silently retarget docs to an unreleased behavior.
- **Planned behavior:** label **planned**, name the task/sprint, and provide the manual fallback. Remove the marker in the PR that ships the behavior.
- **Deprecation format:**

  > **Deprecated:** `<old thing>` — replaced by `<new thing>`. Kept for compatibility until `vX.0.0`; see [migration](./UPGRADING.md#migration-notes-template).

- **Breaking changes** get migration notes, a changelog entry, and an update to every affected command, reference table, screenshot, card, and expected output.
- Never rewrite history to hide a change; use dated `plan-change` comments and versioned docs. See [UPGRADING #docs-versioning](./UPGRADING.md#docs-versioning).
- Historical sections may remain only when clearly marked as historical; otherwise delete them (git history preserves the old text).

---

## 10. Docs-in-the-same-PR rule

Any change to behavior must include its documentation in the same PR:

- CLI flags/commands, config schema/validation, fields/statuses/transitions, labels, tokens/permissions, workflows/required checks, release profiles, policies.
- Update every affected surface: REFERENCE tables, HOW TO USE steps, TROUBLESHOOTING entries, expected outputs, relevant cards (regenerate), and the docs version note.
- A docs change that contradicts the implementation is a defect, even if the code is correct.
- Docs-only PRs are welcome and use the same review; they must not change code.
- If docs must be deferred, record a dated `plan-change`, keep the docs accurate for current behavior, and create a follow-up issue before merging. “Docs later” without a tracked issue is not allowed.
- Reviewers reject behavior PRs with stale commands, missing expected outputs, or contradictory docs.

---

## 11. Review checklist (T12)

Use this checklist for fresh-eyes validation and ordinary docs review. Mark evidence, not intention.

**A. Purpose and accuracy**

- [ ] H1 title, docs version line, one-line scope present.
- [ ] The page answers its stated job; no contradiction with REFERENCE/playbook.
- [ ] Commands, flags, field values, statuses, and version numbers match the code at the reviewed commit.
- [ ] Planned behavior is marked with its task and manual fallback.

**B. Voice and structure**

- [ ] Direct, second person, imperative; no hype, filler, or chat context.
- [ ] Numbered sections, valid heading hierarchy, TOC current for long pages.
- [ ] Terminology matches §5; no synonym drift; acronyms defined.
- [ ] Related/next links close the page.

**C. Commands and output**

- [ ] Commands are copy-pasteable with documented placeholders and prerequisites.
- [ ] Expected output/exit code shown or “no output” stated.
- [ ] No real secrets, tokens, personal data, or live third-party endpoints.
- [ ] Mutating commands note side effects and `--dry-run` where available.

**D. Links and assets**

- [ ] Relative links resolve; anchors match current headings (check renamed sections).
- [ ] External links authoritative and descriptive.
- [ ] Index updated for added/renamed/moved pages.
- [ ] Diagrams/screenshots sanitized, alt-texted, and reproducible; assets listed.

**E. Versioning and maintenance**

- [ ] Version/deprecation markers correct; breaking changes have migration notes.
- [ ] Docs-in-same-PR satisfied; changelog/release notes updated.
- [ ] Reference cards affected by the change regenerated (`--check` passes).

**F. Safety**

- [ ] No secrets, credentials, vulnerability details, or private data in text, code, tables, or images.
- [ ] No chat-only context or informal provenance; plan of record is linked.

**T12 sign-off:**

| Field | Value |
|---|---|
| Reviewer | |
| Date | |
| Commit reviewed | |
| Commands/evidence | |
| Deviations accepted | |
| Follow-ups | |

---

## 12. Editing workflow and tools

1. Read the canonical source for the behavior (§1) and the relevant REFERENCE tables.
2. Edit the owning page; do not fork content into a second document.
3. Validate locally:

   ```bash
   git diff --check
   node scripts/docs/build-cards.mjs --check   # only when cards are affected
   npm test
   node scripts/github/validate-config.mjs tracker.config.json   # only when config examples change
   ```

4. Check fences/links and run the §11 checklist against your own diff.
5. Update the docs version note if the target/version changed; update the index when files are added/moved.
6. Commit with the issue reference (`task(#123): ...`) and open the PR with `Closes #123`; include the validation evidence.
7. If behavior changed, confirm cards were regenerated and HTML/PDFs are committed.

Tooling rules:

- Prefer standard tools already in the repo (Node, `gh`, Markdown) over new dependencies; do not add a dependency for a one-off docs task.
- Card PDFs require Chrome/Chromium; if unavailable, the browser-print fallback in the cards README applies and the committed PDFs stay authoritative until regenerated.
- Screenshots require manual capture and sanitization; no automated launcher is assumed.
- Keep diffs reviewable: do not reformat unrelated pages, and separate moving/renaming from content changes where practical.

---

## 13. Quick decisions

| Situation | Do |
|---|---|
| New command/flag | Add to REFERENCE with expected output; link from HOW TO USE; update cards if daily-use |
| Behavior change | Docs in the same PR; migration note if breaking |
| New failure mode | Add TROUBLESHOOTING entry, then link it from the procedure |
| New UI-only step | Sanitized screenshot with alt text + checklist entry |
| Planned feature | **planned** marker + manual fallback + issue link |
| Ambiguous terminology | Use §5 canonical term; add missing term via HOW TO USE glossary PR |
| Card overflow | Cut detail, link the handbook; never exceed one page |
| Unsure where content lives | REFERENCE for reference, HOW TO USE for procedure, playbook for rationale |

---

## Related

- [Documentation index](./README.md) · [HOW TO USE](./HOW_TO_USE.md) · [REFERENCE](./REFERENCE.md) · [TROUBLESHOOTING](./TROUBLESHOOTING.md)
- [Reference cards](./reference-cards/README.md) · [docs assets policy](./assets/README.md)
- [UPGRADING](./UPGRADING.md) · [AGENT GUIDE](./AGENT_GUIDE.md) · [SECURITY.md](../SECURITY.md)


## Lint/format self-check (T18)

Tracker OS now self-applies ESLint and Prettier: `npm ci`, `npm run lint`, and
`npm run format:check`. A missing or broken lint/format command fails CI rather than succeeding
as a no-op. Dev tooling is approved in `tracker.dependencies.json`; see issue #82.
