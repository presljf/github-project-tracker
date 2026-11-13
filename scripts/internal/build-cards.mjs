#!/usr/bin/env node
/**
 * Reference-card build: Markdown sources -> print-ready HTML -> A4/Letter PDFs.
 *
 * Deterministic and dependency-free (Node >= 22). PDF generation uses a locally
 * installed Chrome/Chromium in headless mode; if no browser is found the HTML is
 * still generated and the browser-print fallback applies (see
 * docs/reference-cards/README.md).
 *
 * Usage:
 *   node scripts/internal/build-cards.mjs             # build HTML + PDFs
 *   node scripts/internal/build-cards.mjs --no-pdf    # build HTML only
 *   node scripts/internal/build-cards.mjs --check     # verify committed HTML/PDFs (no writes)
 *
 * Formats: A4 and US Letter, one page per card. Outputs:
 *   docs/reference-cards/<card>.html
 *   docs/reference-cards/<card>-A4.pdf
 *   docs/reference-cards/<card>-Letter.pdf
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../..');
const CARDS_DIR = path.join(ROOT, 'docs/reference-cards');
const DOCS_URL = 'https://github.com/presljf/github-project-tracker/blob/main/docs';
const REPO_URL = 'https://github.com/presljf/github-project-tracker/blob/main';
const DOCS_VERSION = 'v1.4.0-docs.1';
const TARGET_TEMPLATE = 'v1.4.0';

/** Card order defines the printed card number (n/N). */
const CARDS = [
  'task-lifecycle',
  'statuses-wip-ownership',
  'command-cheatsheet',
  'token-secret-matrix',
  'troubleshooting-audit',
  'sprint-release-checklists',
  'reporting-upstream',
];

const SIZES = {
  a4: { label: 'A4', page: 'A4 portrait' },
  letter: { label: 'Letter', page: 'Letter portrait' },
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'google-chrome',
  'chromium',
  'chromium-browser',
].filter(Boolean);

const FLAGS = new Set(process.argv.slice(2));
const CHECK_ONLY = FLAGS.has('--check');
const NO_PDF = FLAGS.has('--no-pdf') || CHECK_ONLY;
if ([...FLAGS].some((flag) => !['--check', '--no-pdf', '--help'].includes(flag))) {
  console.error(`unknown option: ${[...FLAGS].find((f) => !['--check', '--no-pdf', '--help'].includes(f))}`);
  process.exit(2);
}
if (FLAGS.has('--help')) {
  console.log('Usage: node scripts/internal/build-cards.mjs [--no-pdf | --check]');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Markdown -> HTML (small deterministic subset used by the cards)
// ---------------------------------------------------------------------------

const escapeHtml = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Resolve relative Markdown links in cards to the upstream GitHub docs/root tree. */
function resolveHref(href) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const clean = href.replace(/^\.\//, '');
  const rootRelative = clean.startsWith('../../');
  const target = rootRelative ? clean.slice(6) : clean.startsWith('../') ? clean.slice(3) : clean;
  if (!target.endsWith('.md') && !target.includes('.md#')) return href;
  return `${rootRelative ? REPO_URL : DOCS_URL}/${target}`;
}

/** Inline Markdown: code spans, links, bold, italics. */
function inline(text) {
  const codes = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${resolveHref(href)}">${label}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // eslint-disable-next-line no-control-regex
  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
}

const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/;
const isTableStart = (lines, index) =>
  lines[index].trim().startsWith('|') &&
  lines[index + 1] !== undefined &&
  TABLE_SEPARATOR.test(lines[index + 1].trim());
const isFence = (line) => /^\s*```/.test(line);
const isHeading = (line) => /^#{1,6}\s+/.test(line);
const isCheckList = (line) => /^\s*[-*]\s+\[[ xX]\]\s+/.test(line);
const isBullet = (line) => /^\s*[-*]\s+/.test(line) && !isCheckList(line);
const isOrdered = (line) => /^\s*\d+\.\s+/.test(line);
const isNote = (line) => /^>\s?/.test(line);
const isRule = (line) => /^---+$/.test(line.trim());

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseTable(lines, start) {
  const header = splitTableRow(lines[start]);
  const rows = [];
  let index = start + 2;
  while (index < lines.length && lines[index].trim().startsWith('|')) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }
  const head = `<thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`;
  const body = rows.length
    ? `<tbody>${rows.map((row) => `<tr>${header.map((_, cellIndex) => `<td>${inline(row[cellIndex] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';
  return { html: `<table>${head}${body}</table>`, next: index };
}

/** Parse one card source. Returns { title, sectionsHtml }. */
function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let title = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === '') {
      index += 1;
      continue;
    }

    // Single-line HTML comments are metadata only (e.g. docs version); never rendered.
    if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) {
      index += 1;
      continue;
    }

    if (isFence(line)) {
      const opening = trimmed.slice(3).trim();
      const language = opening.split(/\s+/)[0] || '';
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence
      const className = language ? ` class="language-${escapeHtml(language)}"` : '';
      out.push(`<pre><code${className}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^#\s+/.test(line)) {
      const heading = trimmed.replace(/^#\s+/, '');
      if (title === null) title = heading;
      else out.push(`<h2>${inline(heading)}</h2>`);
      index += 1;
      continue;
    }
    if (/^##\s+/.test(line)) {
      out.push(`<h2>${inline(trimmed.replace(/^##\s+/, ''))}</h2>`);
      index += 1;
      continue;
    }
    if (/^###\s+/.test(line)) {
      out.push(`<h3>${inline(trimmed.replace(/^###\s+/, ''))}</h3>`);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = parseTable(lines, index);
      out.push(table.html);
      index = table.next;
      continue;
    }

    if (isCheckList(line)) {
      const items = [];
      while (index < lines.length && isCheckList(lines[index])) {
        const match = lines[index].match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
        const box = match[1].toLowerCase() === 'x' ? '☑' : '☐';
        items.push(`<li class="check"><span class="box">${box}</span> ${inline(match[2].trim())}</li>`);
        index += 1;
      }
      out.push(`<ul class="checks">${items.join('')}</ul>`);
      continue;
    }

    if (isBullet(line)) {
      const items = [];
      while (index < lines.length && isBullet(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^\s*[-*]\s+/, '').trim())}</li>`);
        index += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (isOrdered(line)) {
      const items = [];
      while (index < lines.length && isOrdered(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^\s*\d+\.\s+/, '').trim())}</li>`);
        index += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (isNote(line)) {
      const parts = [];
      while (index < lines.length && isNote(lines[index])) {
        parts.push(inline(lines[index].replace(/^>\s?/, '').trim()));
        index += 1;
      }
      out.push(`<div class="note">${parts.join('<br>')}</div>`);
      continue;
    }

    if (isRule(line)) {
      index += 1;
      continue;
    }

    // Paragraph: consume consecutive plain lines.
    const paragraph = [trimmed];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !isFence(lines[index]) &&
      !isHeading(lines[index]) &&
      !isTableStart(lines, index) &&
      !isCheckList(lines[index]) &&
      !isBullet(lines[index]) &&
      !isOrdered(lines[index]) &&
      !isNote(lines[index]) &&
      !isRule(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }

  if (!title) throw new Error('card source has no H1 title');
  return { title, body: out.join('\n') };
}

// ---------------------------------------------------------------------------
// HTML template + print CSS
// ---------------------------------------------------------------------------

function stylesheet(pageSize) {
  return `/* Reference-card print styles. Content is sized to fit both A4 and US Letter.
   The committed HTML uses A4; the generator rebuilds this stylesheet with
   size: Letter portrait for the -Letter.pdf artifacts. To print from a browser
   directly, choose A4 or US Letter and keep scale at 100% (fit-to-page is an
   acceptable fallback if the printer adds borders). */
@page { size: ${pageSize}; margin: 10mm 11mm 11mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #111; }
body {
  font: 9.8pt/1.32 "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
a { color: #1f4e79; text-decoration: none; }
.card-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm;
  border-bottom: 2pt solid #1f4e79; padding-bottom: 2mm; margin-bottom: 2.6mm; }
.kicker { font-size: 7.3pt; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: #1f4e79; }
.card-header h1 { font-size: 19pt; line-height: 1.02; margin: 1mm 0 0; }
.header-meta { font-size: 7.3pt; color: #555; text-align: right; line-height: 1.35; }
main h2 { font-size: 10.3pt; text-transform: uppercase; letter-spacing: .05em; color: #1f4e79;
  margin: 2.4mm 0 1mm; padding-bottom: .5mm; border-bottom: .5pt solid #c9d6e3; }
main h3 { font-size: 9.6pt; margin: 1.8mm 0 .7mm; }
p { margin: 0 0 1.6mm; }
ul, ol { margin: 0 0 1.8mm; padding-left: 4.4mm; }
li { margin: 0 0 .55mm; }
ul.checks { list-style: none; padding-left: 0; }
li.check { margin: 0 0 .8mm; padding-left: 4.4mm; text-indent: -4.4mm; }
li.check .box { font-size: 9.6pt; color: #1f4e79; }
code { font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 8.5pt;
  background: #f2f4f7; padding: 0 .5mm; border-radius: .8mm; }
pre { margin: 0 0 2mm; padding: 1.5mm 2.2mm; background: #f6f8fa; border: .4pt solid #d8dee4;
  border-radius: 1mm; font-size: 8.2pt; line-height: 1.3; white-space: pre-wrap; }
pre code { background: none; padding: 0; font-size: inherit; }
table { width: 100%; border-collapse: collapse; margin: 0 0 2.2mm; font-size: 8.9pt; line-height: 1.26; }
th { background: #eef3f8; text-align: left; padding: 1.1mm 1.5mm; border: .4pt solid #c9d6e3;
  font-size: 8.2pt; text-transform: uppercase; letter-spacing: .03em; }
td { padding: 1.05mm 1.5mm; border: .4pt solid #c9d6e3; vertical-align: top; }
.note { background: #eef3f8; border-left: 2pt solid #1f4e79; padding: 1.3mm 2mm; margin: 0 0 2mm;
  font-size: 9.2pt; }
.card-footer { display: flex; justify-content: space-between; gap: 6mm; margin-top: 3mm;
  padding-top: 1.2mm; border-top: .6pt solid #c9d6e3; font-size: 7.2pt; color: #555; }
@media print {
  @page { size: ${pageSize}; margin: 10mm 11mm 11mm; }
  html, body { background: #fff; }
  a { color: #1f4e79; }
  main { page-break-inside: avoid; }
}`;
}

function renderHtml({ title, body }, number, pageSize) {
  const header = `<header class="card-header">
  <div>
    <div class="kicker">Project Tracker OS · Reference card ${number}/${CARDS.length}</div>
    <h1>${escapeHtml(title)}</h1>
  </div>
  <div class="header-meta">${DOCS_VERSION}<br>target template ${TARGET_TEMPLATE}</div>
</header>`;
  const footer = `<footer class="card-footer">
  <span>Project Tracker OS · ${DOCS_VERSION} · target template ${TARGET_TEMPLATE}</span>
  <span>One page · A4/Letter · docs/reference-cards</span>
</footer>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Project Tracker OS reference card</title>
<!-- Generated by scripts/internal/build-cards.mjs from docs/reference-cards/${CARDS[number - 1]}.md. Do not edit by hand. -->
<style>
${stylesheet(pageSize)}
</style>
</head>
<body>
${header}
<main>
${body}
</main>
${footer}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// PDF generation + verification
// ---------------------------------------------------------------------------

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.includes('/') && fs.existsSync(candidate)) return candidate;
    if (!candidate.includes('/')) {
      try {
        const resolved = execFileSync('command', ['-v', candidate], { shell: '/bin/sh', encoding: 'utf8' }).trim();
        if (resolved) return resolved;
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

function chromeVersion(chrome) {
  try {
    return execFileSync(chrome, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown Chrome version';
  }
}

function renderPdf(chrome, html, pageSize, outputPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-card-'));
  const tempHtml = path.join(tempDir, `${path.basename(outputPath, '.pdf')}.html`);
  fs.writeFileSync(tempHtml, html);
  try {
    execFileSync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-pdf-header-footer',
        '--virtual-time-budget=2000',
        `--print-to-pdf=${outputPath}`,
        `file://${tempHtml}`,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(outputPath)) throw new Error(`Chrome did not write ${outputPath}`);
}

const PAGE_TYPE = /\/Type\s*\/Page\b/g;
const MEDIA_BOX = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/;

function inspectPdf(file) {
  if (!fs.existsSync(file)) return { exists: false };
  const raw = fs.readFileSync(file, 'latin1');
  const pageCount = (raw.match(PAGE_TYPE) || []).length;
  const box = raw.match(MEDIA_BOX);
  const [width, height] = box ? [Number(box[1]), Number(box[2])] : [0, 0];
  const kind =
    width > 0 && height > 0
      ? Math.abs(width - 595) < 6 && Math.abs(height - 842) < 6
        ? 'A4'
        : Math.abs(width - 612) < 6 && Math.abs(height - 792) < 6
          ? 'Letter'
          : `${width}x${height}`
      : 'unknown';
  return { exists: true, pageCount, kind, width, height };
}

function checkCard(slug, sizeKey) {
  const source = path.join(CARDS_DIR, `${slug}.md`);
  const htmlFile = path.join(CARDS_DIR, `${slug}.html`);
  const pdfFile = path.join(CARDS_DIR, `${slug}-${SIZES[sizeKey].label}.pdf`);
  const expectedHtml = renderHtml(
    markdownToHtml(fs.readFileSync(source, 'utf8')),
    CARDS.indexOf(slug) + 1,
    SIZES.a4.page,
  );
  const problems = [];
  if (!fs.existsSync(htmlFile)) problems.push('missing HTML');
  else if (fs.readFileSync(htmlFile, 'utf8') !== expectedHtml) problems.push('HTML is stale (rebuild required)');
  const pdf = inspectPdf(pdfFile);
  if (!pdf.exists) problems.push('missing PDF');
  else {
    if (pdf.pageCount !== 1) problems.push(`PDF has ${pdf.pageCount} pages (expected 1)`);
    if (pdf.kind !== SIZES[sizeKey].label)
      problems.push(`PDF page size ${pdf.kind} (expected ${SIZES[sizeKey].label})`);
  }
  return { problems, pdf };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fs.mkdirSync(CARDS_DIR, { recursive: true });

if (CHECK_ONLY) {
  let failures = 0;
  for (const slug of CARDS) {
    const htmlFile = path.join(CARDS_DIR, `${slug}.html`);
    const source = path.join(CARDS_DIR, `${slug}.md`);
    let problems = [];
    if (!fs.existsSync(source)) problems.push('missing Markdown source');
    if (!fs.existsSync(htmlFile)) problems.push('missing HTML');
    if (!problems.length) {
      const expectedHtml = renderHtml(
        markdownToHtml(fs.readFileSync(source, 'utf8')),
        CARDS.indexOf(slug) + 1,
        SIZES.a4.page,
      );
      if (fs.readFileSync(htmlFile, 'utf8') !== expectedHtml) problems.push('HTML is stale (rebuild required)');
    }
    for (const sizeKey of Object.keys(SIZES)) {
      const result = checkCard(slug, sizeKey);
      problems = problems.concat(result.problems);
    }
    if (problems.length) {
      failures += 1;
      console.error(`✗ ${slug}: ${problems.join('; ')}`);
    } else {
      console.log(`✓ ${slug}: HTML current; A4 + Letter PDFs one page`);
    }
  }
  if (failures) {
    console.error(`\n${failures} card(s) failed; run node scripts/internal/build-cards.mjs`);
    process.exit(1);
  }
  console.log(`\nOK: ${CARDS.length} cards current (HTML + A4/Letter single-page PDFs)`);
  process.exit(0);
}

const chrome = NO_PDF ? null : findChrome();
if (!NO_PDF && !chrome) {
  console.warn('warning: no Chrome/Chromium found; generating HTML only.');
  console.warn('PDF fallback: open docs/reference-cards/<card>.html and print to PDF (A4/Letter, one page).');
}
if (chrome) console.log(`PDF engine: ${chromeVersion(chrome)}`);

let failures = 0;
console.log(`\n${'card'.padEnd(26)} ${'HTML'.padEnd(8)} ${'A4'.padEnd(6)} ${'Letter'.padEnd(7)} result`);
console.log('-'.repeat(66));

for (const [index, slug] of CARDS.entries()) {
  const source = path.join(CARDS_DIR, `${slug}.md`);
  if (!fs.existsSync(source)) {
    console.error(`✗ ${slug}: missing source ${path.relative(ROOT, source)}`);
    failures += 1;
    continue;
  }
  const parsed = markdownToHtml(fs.readFileSync(source, 'utf8'));
  const htmlA4 = renderHtml(parsed, index + 1, SIZES.a4.page);
  const htmlFile = path.join(CARDS_DIR, `${slug}.html`);
  fs.writeFileSync(htmlFile, htmlA4);

  const sizes = chrome ? Object.keys(SIZES) : [];
  for (const sizeKey of sizes) {
    const pdfFile = path.join(CARDS_DIR, `${slug}-${SIZES[sizeKey].label}.pdf`);
    // The committed HTML is A4; the Letter build swaps the @page size only.
    const html = sizeKey === 'a4' ? htmlA4 : htmlA4.replaceAll('A4 portrait', 'Letter portrait');
    try {
      renderPdf(chrome, html, SIZES[sizeKey].page, pdfFile);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${slug}: PDF ${SIZES[sizeKey].label} failed: ${error.message}`);
    }
  }

  const a4 = inspectPdf(path.join(CARDS_DIR, `${slug}-A4.pdf`));
  const letter = inspectPdf(path.join(CARDS_DIR, `${slug}-Letter.pdf`));
  const pagesOk = a4.pageCount === 1 && letter.pageCount === 1;
  const sizesOk = a4.kind === 'A4' && letter.kind === 'Letter';
  if (!pagesOk || (sizes.length && !sizesOk)) failures += 1;
  console.log(
    `${slug.padEnd(26)} ${'written'.padEnd(8)} ${String(a4.pageCount ?? '-').padEnd(6)} ${String(letter.pageCount ?? '-').padEnd(7)} ${
      pagesOk && sizesOk ? 'ok' : 'CHECK'
    }`,
  );
}

if (failures) {
  console.error(`\n${failures} problem(s); inspect output above.`);
  process.exit(1);
}
console.log(
  `\nOK: ${CARDS.length} cards -> Markdown, HTML, ${chrome ? 'A4 + Letter PDFs' : 'PDFs skipped (no Chrome)'}`,
);
