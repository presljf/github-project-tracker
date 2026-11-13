#!/usr/bin/env node
/**
 * Render docs/SURFACE.md from contract/repo-surface.json (deterministic; no timestamps).
 *
 * docs/SURFACE.md is the generated, human-readable repo-surface map: summary counts, class map,
 * per-class path tables (status/audience/title/catalog §/docs anchors), contract-only gaps, and
 * generated-artifact provenance. The template version is read from tracker.config.json so the page
 * moves with the template release.
 *
 * Usage: node scripts/internal/render-surface.mjs [--root .] [--manifest contract/repo-surface.json]
 *          [--check | --stdout | --write] [--help]
 *   (no mode flag) default: write docs/SURFACE.md
 *   --check       compare the rendered bytes with the file on disk; exit 1 when stale/missing
 *   --stdout      print the rendered document; never write
 *   --write       explicit write (same as the default)
 *
 * Exit codes: 0 success/up-to-date, 1 stale/missing/error, 2 usage error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, UsageError } from '../adopt/lib/cli.mjs';
import { renderSurfaceDoc } from './surface-shared.mjs';

const DEFAULT_MANIFEST = 'contract/repo-surface.json';
const DEFAULT_OUTPUT = 'docs/SURFACE.md';

const USAGE = `Usage: node scripts/internal/render-surface.mjs [options]

Options:
  --root DIR            Repository root (default: .)
  --manifest FILE       Manifest path (default: <root>/${DEFAULT_MANIFEST})
  --check               Fail (exit 1) when ${DEFAULT_OUTPUT} is stale or missing; write nothing
  --stdout              Print the rendered document instead of writing
  --write               Write ${DEFAULT_OUTPUT} (the default)
  --help, -h            Show this help

Exit codes: 0 success/up-to-date, 1 stale/missing/error, 2 usage error.`;

function usage() {
  return USAGE;
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
 * Build the rendered document for a repository root without writing anything.
 * @returns {{doc: string, manifestPath: string, outputPath: string, entries: number}}
 */
export function buildSurfaceMarkdown({ root = '.', manifestPath = null } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedManifest = manifestPath ? path.resolve(manifestPath) : path.join(resolvedRoot, DEFAULT_MANIFEST);
  const outputPath = path.join(resolvedRoot, DEFAULT_OUTPUT);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(resolvedManifest, 'utf8'));
  } catch (error) {
    throw new UsageError(
      `cannot read manifest ${path.relative(process.cwd(), resolvedManifest) || resolvedManifest}: ${error.message}`,
    );
  }
  const trackerVersion = readTrackerVersion(resolvedRoot);
  const doc = renderSurfaceDoc({ manifest, trackerVersion });
  const entries = Array.isArray(manifest.entries) ? manifest.entries.length : 0;
  return { doc, manifestPath: resolvedManifest, outputPath, entries };
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
    const root = parsed.root ?? '.';
    const built = buildSurfaceMarkdown({ root, manifestPath: parsed.manifest ?? null });
    const relativeOutput = path.relative(path.resolve(root), built.outputPath) || DEFAULT_OUTPUT;
    if (parsed.stdout) {
      process.stdout.write(built.doc);
      return;
    }
    if (parsed.check) {
      let existing = null;
      try {
        existing = fs.readFileSync(built.outputPath, 'utf8');
      } catch {
        existing = null;
      }
      if (existing === null) {
        console.error(
          `error: ${DEFAULT_OUTPUT} is missing; run \`npm run surface:render\` (${built.entries} entries).`,
        );
        process.exitCode = 1;
        return;
      }
      if (existing !== built.doc) {
        const diff = firstDifference(built.doc, existing);
        console.error(`error: ${DEFAULT_OUTPUT} is stale; run \`npm run surface:render\` to regenerate.`);
        if (diff) console.error(`first difference at ${DEFAULT_OUTPUT}:${diff.line}`);
        process.exitCode = 1;
        return;
      }
      console.log(`${DEFAULT_OUTPUT} is up to date (${built.entries} entries).`);
      return;
    }
    fs.mkdirSync(path.dirname(built.outputPath), { recursive: true });
    fs.writeFileSync(built.outputPath, built.doc);
    console.log(`Wrote ${relativeOutput} (${built.entries} entries).`);
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
