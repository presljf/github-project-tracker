#!/usr/bin/env node
/**
 * Render the generated repo-surface artifacts from contract/repo-surface.json (deterministic; no
 * timestamps):
 *
 *   - docs/SURFACE.md — human-readable surface map: summary counts, class map, per-class path
 *     tables (status/audience/title/catalog §/docs anchors), contract-only gaps, and generated
 *     artifact provenance. It is also the documentation anchor for `scripts/internal/*` entries.
 *   - docs/ACTIONS_CATALOG.md — the generated availability block between
 *     `<!-- surface-status:start -->` / `<!-- surface-status:end -->` is spliced from
 *     renderCatalogStatusBlock(entries) so the catalog's shipped-vs-contract-only list cannot drift
 *     from the manifest.
 *
 * The template version is read from tracker.config.json so both artifacts move with the template
 * release.
 *
 * Usage: node scripts/internal/render-surface.mjs [--root .] [--manifest contract/repo-surface.json]
 *          [--check | --stdout | --write] [--help]
 *   (no mode flag) default: write docs/SURFACE.md and splice the docs/ACTIONS_CATALOG.md block
 *   --check       compare both artifacts with the files on disk; exit 1 when stale/missing
 *   --stdout      print the rendered docs/SURFACE.md document; never writes
 *   --write       explicit write (same as the default)
 *
 * Exit codes: 0 success/up-to-date, 1 stale/missing/error, 2 usage error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, UsageError } from '../adopt/lib/cli.mjs';
import {
  CATALOG_STATUS_END_MARKER,
  CATALOG_STATUS_START_MARKER,
  renderCatalogStatusBlock,
  renderSurfaceDoc,
} from './surface-shared.mjs';

const DEFAULT_MANIFEST = 'contract/repo-surface.json';
const DEFAULT_OUTPUT = 'docs/SURFACE.md';
const DEFAULT_CATALOG = 'docs/ACTIONS_CATALOG.md';

const USAGE = `Usage: node scripts/internal/render-surface.mjs [options]

Options:
  --root DIR            Repository root (default: .)
  --manifest FILE       Manifest path (default: <root>/${DEFAULT_MANIFEST})
  --check               Fail (exit 1) when ${DEFAULT_OUTPUT} or the ${DEFAULT_CATALOG} generated
                        surface-status block is stale/missing; write nothing
  --stdout              Print the rendered ${DEFAULT_OUTPUT} document; never write
  --write               Write ${DEFAULT_OUTPUT} and splice the ${DEFAULT_CATALOG} block (default)
  --help, -h            Show this help

Exit codes: 0 success/up-to-date, 1 stale/missing/error, 2 usage error.`;

function usage() {
  return USAGE;
}

// ---------------------------------------------------------------------------
// Generated catalog availability block (shared with verify-surface.mjs)
// ---------------------------------------------------------------------------

/** Extract the generated `surface-status` block (markers included) from the catalog, or null. */
export function extractCatalogStatusBlock(catalogText) {
  const source = String(catalogText ?? '');
  const start = source.indexOf(CATALOG_STATUS_START_MARKER);
  if (start < 0) return null;
  const end = source.indexOf(CATALOG_STATUS_END_MARKER, start + CATALOG_STATUS_START_MARKER.length);
  if (end < 0) return null;
  return source.slice(start, end + CATALOG_STATUS_END_MARKER.length);
}

/** Normalize a generated block for comparison (CRLF + trailing-whitespace insensitive). */
export function normalizeCatalogStatusBlock(block) {
  return String(block ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

/**
 * Replace the generated block between the catalog markers with `block` (markers included).
 * Returns `{ok:false, reason}` instead of throwing so callers can decide blocking vs notice.
 */
export function spliceCatalogStatusBlock(catalogText, block) {
  const source = String(catalogText ?? '');
  const startMarker = CATALOG_STATUS_START_MARKER;
  const endMarker = CATALOG_STATUS_END_MARKER;
  const startCount = source.split(startMarker).length - 1;
  const endCount = source.split(endMarker).length - 1;
  if (startCount === 0 || endCount === 0) {
    return {
      ok: false,
      reason: 'missing-markers',
      message: `${DEFAULT_CATALOG} is missing the ${startMarker} / ${endMarker} markers`,
    };
  }
  if (startCount !== 1 || endCount !== 1) {
    return {
      ok: false,
      reason: 'duplicate-markers',
      message: `${DEFAULT_CATALOG} must contain exactly one ${startMarker} / ${endMarker} pair (found ${startCount}/${endCount})`,
    };
  }
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < start) {
    return {
      ok: false,
      reason: 'misordered-markers',
      message: `${endMarker} appears before ${startMarker} in ${DEFAULT_CATALOG}`,
    };
  }
  const text = `${source.slice(0, start)}${block}${source.slice(end + endMarker.length)}`;
  return { ok: true, text };
}

/** First differing line between two texts (1-based), for the --check hint. */
export function firstDifference(expected, actual) {
  const expectedLines = String(expected).split('\n');
  const actualLines = String(actual).split('\n');
  const max = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < max; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return {
        line: index + 1,
        expected: expectedLines[index] ?? '(end of file)',
        actual: actualLines[index] ?? '(end of file)',
      };
    }
  }
  return null;
}

/** Read the template version this render should target from tracker.config.json. */
export function readTrackerVersion(root) {
  const file = path.join(root, 'tracker.config.json');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new UsageError(
      `cannot read tracker.config.json (${path.relative(process.cwd(), file) || file}): ${error.message}`,
    );
  }
  const version = config?.automation?.templateVersion;
  if (typeof version !== 'string' || !version.trim()) {
    throw new UsageError('tracker.config.json is missing automation.templateVersion');
  }
  return version.trim();
}

/**
 * Build every rendered artifact for a repository root without writing anything.
 *
 * @returns {{
 *   doc: string,
 *   manifestPath: string,
 *   outputPath: string,
 *   entries: number,
 *   catalog: {
 *     present: boolean,
 *     path: string,
 *     expectedBlock: string,
 *     block: string|null,
 *     blockError: string|null,
 *     updatedText: string|null,
 *   },
 * }}
 */
export function buildSurfaceOutputs({ root = '.', manifestPath = null } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedManifest = manifestPath ? path.resolve(manifestPath) : path.join(resolvedRoot, DEFAULT_MANIFEST);
  const outputPath = path.join(resolvedRoot, DEFAULT_OUTPUT);
  const catalogPath = path.join(resolvedRoot, DEFAULT_CATALOG);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(resolvedManifest, 'utf8'));
  } catch (error) {
    throw new UsageError(
      `cannot read manifest ${path.relative(process.cwd(), resolvedManifest) || resolvedManifest}: ${error.message}`,
    );
  }
  const trackerVersion = readTrackerVersion(resolvedRoot);
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const doc = renderSurfaceDoc({ manifest, trackerVersion });
  const expectedBlock = renderCatalogStatusBlock(entries);

  let catalogText;
  try {
    catalogText = fs.readFileSync(catalogPath, 'utf8');
  } catch {
    catalogText = null;
  }
  let block = null;
  let blockError = null;
  let updatedText = null;
  if (catalogText !== null) {
    const splice = spliceCatalogStatusBlock(catalogText, expectedBlock);
    if (splice.ok) {
      block = extractCatalogStatusBlock(catalogText);
      updatedText = splice.text;
    } else {
      blockError = splice.message;
    }
  }

  return {
    doc,
    manifestPath: resolvedManifest,
    outputPath,
    entries: entries.length,
    catalog: {
      present: catalogText !== null,
      path: catalogPath,
      expectedBlock,
      block,
      blockError,
      updatedText,
    },
  };
}

/**
 * Backwards-compatible wrapper: the docs/SURFACE.md render only (used by tests/tooling that only
 * need the Markdown document).
 * @returns {{doc: string, manifestPath: string, outputPath: string, entries: number}}
 */
export function buildSurfaceMarkdown({ root = '.', manifestPath = null } = {}) {
  const built = buildSurfaceOutputs({ root, manifestPath });
  return {
    doc: built.doc,
    manifestPath: built.manifestPath,
    outputPath: built.outputPath,
    entries: built.entries,
  };
}

function reportBlockProblem(built) {
  console.error(`error: ${built.catalog.blockError}; restore the generated-block markers before rendering.`);
  process.exitCode = 1;
}

function checkSurface(built) {
  let existing;
  try {
    existing = fs.readFileSync(built.outputPath, 'utf8');
  } catch {
    existing = null;
  }
  if (existing === null) {
    console.error(`error: ${DEFAULT_OUTPUT} is missing; run \`npm run surface:render\` (${built.entries} entries).`);
    process.exitCode = 1;
    return false;
  }
  if (existing !== built.doc) {
    const diff = firstDifference(built.doc, existing);
    console.error(`error: ${DEFAULT_OUTPUT} is stale; run \`npm run surface:render\` to regenerate.`);
    if (diff) console.error(`first difference at ${DEFAULT_OUTPUT}:${diff.line}`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function checkCatalog(built) {
  if (!built.catalog.present) {
    console.error(`notice: ${DEFAULT_CATALOG} not found; skipping generated surface-status block check.`);
    return true;
  }
  if (built.catalog.blockError) {
    reportBlockProblem(built);
    return false;
  }
  const expected = normalizeCatalogStatusBlock(built.catalog.expectedBlock);
  const actual = normalizeCatalogStatusBlock(built.catalog.block);
  if (expected !== actual) {
    const diff = firstDifference(expected, actual);
    console.error(
      `error: ${DEFAULT_CATALOG} surface-status block is stale; run \`npm run surface:render\` to splice the generated block.`,
    );
    if (diff)
      console.error(`first difference in the ${DEFAULT_CATALOG} surface-status block at block line ${diff.line}`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function writeOutputs(built) {
  if (built.catalog.present && built.catalog.blockError) {
    reportBlockProblem(built);
    return false;
  }
  fs.mkdirSync(path.dirname(built.outputPath), { recursive: true });
  fs.writeFileSync(built.outputPath, built.doc);
  console.log(`Wrote ${DEFAULT_OUTPUT} (${built.entries} entries).`);
  if (!built.catalog.present) {
    console.error(`notice: ${DEFAULT_CATALOG} not found; skipped generated surface-status block sync.`);
    return true;
  }
  fs.writeFileSync(built.catalog.path, built.catalog.updatedText);
  console.log(`Updated ${DEFAULT_CATALOG} generated surface-status block.`);
  return true;
}

function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv, {
      flags: ['check', 'stdout', 'write', 'help'],
      options: ['root', 'manifest'],
    });
    const modes = ['check', 'stdout', 'write'].filter((mode) => Boolean(parsed[mode]));
    if (modes.length > 1) throw new UsageError('use only one of --check, --stdout, --write');
    if (parsed.help) {
      console.log(usage());
      return;
    }
    const built = buildSurfaceOutputs({ root: parsed.root ?? '.', manifestPath: parsed.manifest ?? null });
    if (parsed.stdout) {
      process.stdout.write(built.doc);
      return;
    }
    if (parsed.check) {
      const surfaceOk = checkSurface(built);
      const catalogOk = checkCatalog(built);
      if (surfaceOk && catalogOk) {
        console.log(`${DEFAULT_OUTPUT} is up to date (${built.entries} entries).`);
        if (built.catalog.present) console.log(`${DEFAULT_CATALOG} surface-status block is up to date.`);
      }
      return;
    }
    writeOutputs(built);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`error: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
