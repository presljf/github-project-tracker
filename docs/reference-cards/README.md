# Reference cards — print pack

**Docs version:** `v1.0.1-docs.1` · Target template: `v1.0.1` · One page per card, A4 and US Letter.

Printable one-page summaries for daily tracker operations. The full documentation remains authoritative; cards are condensed reminders that link back to the handbook and reference.

## Card pack

| # | Card | Markdown source | Print-ready HTML | PDFs |
|---|---|---|---|---|
| 1 | Task lifecycle | [task-lifecycle.md](./task-lifecycle.md) | [task-lifecycle.html](./task-lifecycle.html) | [A4](./task-lifecycle-A4.pdf) · [Letter](./task-lifecycle-Letter.pdf) |
| 2 | Statuses, WIP & ownership | [statuses-wip-ownership.md](./statuses-wip-ownership.md) | [statuses-wip-ownership.html](./statuses-wip-ownership.html) | [A4](./statuses-wip-ownership-A4.pdf) · [Letter](./statuses-wip-ownership-Letter.pdf) |
| 3 | Command cheat sheet | [command-cheatsheet.md](./command-cheatsheet.md) | [command-cheatsheet.html](./command-cheatsheet.html) | [A4](./command-cheatsheet-A4.pdf) · [Letter](./command-cheatsheet-Letter.pdf) |
| 4 | Token & secret matrix | [token-secret-matrix.md](./token-secret-matrix.md) | [token-secret-matrix.html](./token-secret-matrix.html) | [A4](./token-secret-matrix-A4.pdf) · [Letter](./token-secret-matrix-Letter.pdf) |
| 5 | Troubleshooting & audit | [troubleshooting-audit.md](./troubleshooting-audit.md) | [troubleshooting-audit.html](./troubleshooting-audit.html) | [A4](./troubleshooting-audit-A4.pdf) · [Letter](./troubleshooting-audit-Letter.pdf) |
| 6 | Sprint & release checklists | [sprint-release-checklists.md](./sprint-release-checklists.md) | [sprint-release-checklists.html](./sprint-release-checklists.html) | [A4](./sprint-release-checklists-A4.pdf) · [Letter](./sprint-release-checklists-Letter.pdf) |
| 7 | Reporting upstream | [reporting-upstream.md](./reporting-upstream.md) | [reporting-upstream.html](./reporting-upstream.html) | [A4](./reporting-upstream-A4.pdf) · [Letter](./reporting-upstream-Letter.pdf) |

Sources are Markdown; HTML and PDFs are generated artifacts. Do not edit the generated files by hand.

## Print

**Ready-to-print:** open a PDF from the table and print at 100% scale — one page, A4 or US Letter, no headers/footers. Shading is printer-safe (light gray/blue) but enabling “background graphics” preserves the section rules.

**Browser fallback (no PDF needed):**

1. Open the card HTML in a browser.
2. Print → paper size A4 or US Letter → margins default → scale 100% (use “fit to page” only if a printer adds borders) → disable browser headers/footers → enable background graphics.
3. Confirm one page in the preview before printing.

The HTML has `@page { size: ... }` print CSS; it is generated twice in memory for the A4 and Letter PDFs. Content is sized to fit both formats with margin headroom.

## Regenerate

```bash
node scripts/docs/build-cards.mjs            # rebuild HTML + A4/Letter PDFs
node scripts/docs/build-cards.mjs --no-pdf   # rebuild HTML only
node scripts/docs/build-cards.mjs --check    # verify committed artifacts (no writes)
```

- Requires Node >= 22. PDF generation additionally requires Chrome/Chromium (auto-detected; set `CHROME_PATH` if needed). Without a browser, HTML is still generated and the print fallback above applies.
- Generated with **Google Chrome 157.0.8103.51 on macOS** (recorded in the generator output). HTML is byte-deterministic from the Markdown source; PDFs are build artifacts and may carry fresh metadata timestamps on rebuild. Other browsers/platforms may wrap lines slightly differently — use the committed PDFs for print, and `--check` to verify freshness and page size.
- `--check` verifies that each HTML file matches its Markdown source and that every PDF exists, is one page, and has the expected page size (A4 ~595×842 pt, Letter ~612×792 pt). Use it before release/fresh-eyes validation.

## Editing rules

- One page, one topic. If content no longer fits, cut rather than shrink below readable print sizes; the handbook keeps the detail.
- Keep the card’s primary cross-links (handbook, reference, policy). Update links in the same change as the docs they point to.
- No secrets, tokens, customer data, or chat-only context. Use `OWNER/REPO`, `PROJECT_NUMBER`, `ITEM_ID` placeholders.
- When behavior, commands, fields, statuses, tokens, or policies change, update the card source and run the build in the same PR (T12 validates freshness before the release tag).
- Keep generated next to sources: `<card>.html` and `<card>-A4.pdf` / `<card>-Letter.pdf`.
- The docs version line moves with the template release; see [DOCS STYLE GUIDE](../DOCS_STYLE_GUIDE.md).

## Related

- [HOW TO USE](../HOW_TO_USE.md) · [REFERENCE](../REFERENCE.md) · [TROUBLESHOOTING](../TROUBLESHOOTING.md)
- [Comment templates](../comment-templates/) · [Downstream feedback](../DOWNSTREAM_FEEDBACK.md) · [Security](../../SECURITY.md)
