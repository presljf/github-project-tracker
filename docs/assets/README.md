# Docs assets — diagram/screenshot policy

**Docs version:** v1.4.0-docs.1

The docs use **reproducible, sanitized diagrams and expected-output snapshots** instead of binary screenshots wherever possible.

## Current diagrams

| Asset | Location | Reproducible source |
|---|---|---|
| Program/release/sprint/task hierarchy | `docs/HOW_TO_USE.md` §1 | Mermaid |
| Status transitions | `docs/HOW_TO_USE.md` §5.2 | Mermaid |
| Board text snapshot | `docs/HOW_TO_USE.md` §6, `docs/REFERENCE.md` §19 | Markdown code block |
| Comment/check-in/out examples | `docs/comment-templates/`, HOW TO USE §8–10 | Markdown |

## Screenshot checklist (release gate / T12)

When adding real screenshots, capture and sanitize:

1. Project **In flight** view (no personal data/tokens).
2. Current sprint view with task progress.
3. Task check-in and check-out comments (redact owners/links if needed).
4. Status transition (In Progress → In Review → Done).
5. UI-only steps: issue types, field options, workflow enablement, branch protection/ruleset.
6. Release/audit workflow run summary.

## Redaction rules

- Remove names/emails/org secrets not already public.
- Remove tokens, cookies, private repo names if sensitive, webhook URLs, signed URLs.
- Do not screenshot private vulnerability details.
- Prefer Mermaid/text for behavior that changes frequently.

## Regeneration

- Mermaid diagrams: edit the fenced block; GitHub renders on refresh.
- Expected outputs: run the command on a scratch repo with generic placeholders; update both output and exit code.
- Binary screenshots: store under `docs/assets/images/` with descriptive names and update this list; T12 validates links/currentness before release.
