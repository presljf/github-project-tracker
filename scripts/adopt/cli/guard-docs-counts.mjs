#!/usr/bin/env node
/**
 * Docs counts guard: enforce the verified PASS/FAIL/SKIP counts contract.
 *
 * Validates the committed baseline (schema + counts + named-skip agreement + reviewed evidence),
 * regenerates the expected canonical `docs/TEST_COUNTS.md`, and fails when it or any configured
 * inline `<!-- counts:<suite>/<mode>[/<metric>] -->` marker is stale.
 *
 * Historical docs are exempt by construction: only files listed in `docs.counts.markers` are
 * checked, so past release/acceptance entries are never rewritten. No test execution happens here;
 * the counted-runner CLI verifies live results against the same baseline in the suite/CI job.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, UsageError } from '../lib/cli.mjs';
import { checkMarkers, renderGeneratedDoc, resolveCountsConfig, validateBaseline } from './suite-counts.mjs';

/** Evaluate the guard against a repo root (exported for tests; returns {ok, errors, checked}). */
export function evaluateDocsCounts({ root = '.', config }) {
  const resolvedRoot = path.resolve(root);
  const counts = resolveCountsConfig(config);
  if (counts.errors.length) {
    return {
      ok: false,
      noPolicy: false,
      errors: counts.errors,
      checked: { baseline: null, suites: 0, modes: 0, markerFiles: 0 },
    };
  }
  if (!counts.present) {
    return {
      ok: true,
      noPolicy: true,
      errors: [],
      checked: { baseline: null, suites: 0, modes: 0, markerFiles: 0 },
    };
  }
  const errors = [];
  const baselineFile = path.join(resolvedRoot, counts.baseline);
  if (!fs.existsSync(baselineFile)) {
    return {
      ok: false,
      noPolicy: false,
      errors: [
        {
          path: counts.baseline,
          message: 'baseline file not found (create it with the counted-runner record command)',
        },
      ],
      checked: { baseline: counts.baseline, suites: 0, modes: 0, markerFiles: 0 },
    };
  }
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      noPolicy: false,
      errors: [{ path: counts.baseline, message: `cannot parse baseline: ${err.message}` }],
      checked: { baseline: counts.baseline, suites: 0, modes: 0, markerFiles: 0 },
    };
  }
  const validation = validateBaseline(baseline);
  errors.push(...validation.errors);
  const suites = Array.isArray(baseline?.suites) ? baseline.suites.length : 0;
  const modes = Array.isArray(baseline?.suites)
    ? baseline.suites.reduce((total, suite) => total + (Array.isArray(suite?.modes) ? suite.modes.length : 0), 0)
    : 0;
  if (!validation.ok) {
    return {
      ok: false,
      noPolicy: false,
      errors,
      checked: { baseline: counts.baseline, suites, modes, markerFiles: 0 },
    };
  }
  const generatedFile = path.join(resolvedRoot, counts.generated);
  const expectedDoc = renderGeneratedDoc(baseline, { baselinePath: counts.baseline });
  if (!fs.existsSync(generatedFile)) {
    errors.push({
      path: counts.generated,
      message:
        'generated counts doc is missing; run the update command (e.g. `node scripts/adopt/cli/suite-counts.mjs render`)',
    });
  } else if (fs.readFileSync(generatedFile, 'utf8') !== expectedDoc) {
    errors.push({
      path: counts.generated,
      message: `generated counts doc is stale; run \`${counts.updateCommand}\` (or \`node scripts/adopt/cli/suite-counts.mjs render\`) and commit the result`,
    });
  }
  for (const rel of counts.markers) {
    const file = path.join(resolvedRoot, rel);
    if (!fs.existsSync(file)) {
      errors.push({ path: rel, message: 'marker file not found; create it or remove it from docs.counts.markers' });
      continue;
    }
    const markerCheck = checkMarkers(fs.readFileSync(file, 'utf8'), baseline, { label: rel });
    for (const error of markerCheck.errors) errors.push({ path: rel, message: error.message });
  }
  if (errors.length) {
    errors.push({
      path: '$',
      message: `fix counts docs with \`${counts.updateCommand}\` (or \`node scripts/adopt/cli/suite-counts.mjs render\`), then commit baseline+docs+markers together`,
    });
  }
  return {
    ok: errors.length === 0,
    noPolicy: false,
    errors,
    checked: { baseline: counts.baseline, suites, modes, markerFiles: counts.markers.length },
  };
}

function usage() {
  return [
    'Usage: node scripts/adopt/cli/guard-docs-counts.mjs [--root DIR] [--config FILE] [--json]',
    '',
    'Validates the committed counts baseline (schema + named-skip/reviewed agreement), regenerates',
    'docs/TEST_COUNTS.md, and fails when it or any inline `<!-- counts:<key> -->` marker is stale.',
    'Absent docs.counts config is a no-op. Historical docs are exempt by construction (only files',
    'listed in docs.counts.markers are checked).',
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    try {
      const args = parseArgs(process.argv.slice(2), {
        flags: ['json', 'help'],
        options: ['root', 'config'],
      });
      if (args.help) {
        console.log(usage());
        return;
      }
      const root = path.resolve(args.root || '.');
      const configPath = path.resolve(args.config || path.join(root, 'tracker.config.json'));
      if (!fs.existsSync(configPath)) throw new UsageError(`config not found: ${configPath}`);
      let config;
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (err) {
        throw new UsageError(`cannot parse config ${configPath}: ${err.message}`);
      }
      const result = evaluateDocsCounts({ root, config });
      if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.noPolicy) {
        if (!args.json) console.log('docs counts guard: docs.counts is not configured (no-op).');
        return;
      }
      if (!result.ok) {
        console.error(`docs counts guard FAILED (${result.errors.length}):`);
        for (const error of result.errors) console.error(`- ${error.path}: ${error.message}`);
        process.exitCode = 1;
        return;
      }
      if (!args.json) {
        console.log(
          `docs counts contract OK — ${result.checked.suites} suite(s) / ${result.checked.modes} mode(s); generated doc and ${result.checked.markerFiles} marker file(s) current.`,
        );
      }
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
