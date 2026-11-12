/** Shared fixtures/helpers for the counts-contract tests (not a test file). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { markerValue, renderGeneratedDoc } from '../../scripts/github/suite-counts.mjs';

export const REPO_ROOT = process.cwd();
export const FIXTURES = path.join(REPO_ROOT, 'tests', 'fixtures', 'counts');
export const COUNTS_CLI = path.join(REPO_ROOT, 'scripts/github/suite-counts.mjs');
export const GUARD_CLI = path.join(REPO_ROOT, 'scripts/github/guard-docs-counts.mjs');

export function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function reviewed(overrides = {}) {
  return {
    on: '2026-11-12',
    by: 'agent:counts-test',
    evidence: ['https://github.com/owner/repo/pull/1'],
    ...overrides,
  };
}

/** Full, schema-valid tracker config (docs.counts included unless `docs: null`). */
export function countsConfig(overrides = {}) {
  const config = {
    trackerVersion: 1,
    repository: 'owner/repo',
    project: { owner: 'owner', title: 'Project Tracker', number: 1 },
    statuses: ['Todo', 'In Progress', 'In Review', 'Blocked', 'Done'],
    fields: {
      Release: { options: ['v1.0.0'] },
      Sprint: { options: ['1.0.0.1'] },
      Area: { options: ['docs'] },
      Kind: { options: ['infra'] },
      Estimate: { options: ['M'] },
    },
    releases: [{ key: 'v1.0.0', milestone: 'v1.0.0' }],
    automation: { templateVersion: '1.3.0' },
    docs: {
      counts: {
        baseline: 'docs/test-counts.baseline.json',
        generated: 'docs/TEST_COUNTS.md',
        markers: ['docs/REFERENCE.md'],
        inventoryCommand: 'npm test -- --test-reporter=tap',
        updateCommand: 'npm run docs:counts:update',
      },
    },
    ...overrides,
  };
  return config;
}

export function unitBaseline(overrides = {}) {
  return {
    schemaVersion: 1,
    suites: [
      {
        id: 'unit',
        modes: [
          {
            mode: 'full',
            collected: 3,
            passed: 3,
            failed: 0,
            skipped: 0,
            flaky: 0,
            knownSkips: [],
            reviewed: reviewed(),
            ...overrides,
          },
        ],
      },
    ],
  };
}

/** Create a temp repo with config + baseline + generated doc + marker file. */
export function tempCountsRepo({
  config = countsConfig(),
  baseline = unitBaseline(),
  generated = null,
  markers = null,
  results = {},
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'counts-'));
  const counts = config.docs?.counts;
  fs.writeFileSync(path.join(dir, 'tracker.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  if (counts) {
    if (baseline !== null) writeJson(path.join(dir, counts.baseline), baseline);
    if (generated !== null) {
      fs.mkdirSync(path.dirname(path.join(dir, counts.generated)), { recursive: true });
      fs.writeFileSync(path.join(dir, counts.generated), generated);
    } else if (baseline !== null) {
      fs.mkdirSync(path.dirname(path.join(dir, counts.generated)), { recursive: true });
      fs.writeFileSync(
        path.join(dir, counts.generated),
        renderGeneratedDoc(baseline, { baselinePath: counts.baseline }),
      );
    }
    const markerFiles =
      markers === null
        ? {
            'docs/REFERENCE.md': `# REFERENCE\n\nUnit: <!-- counts:unit/full -->${markerValue('unit/full', baseline) ?? 'n/a'}<!-- /counts:unit/full -->\n`,
          }
        : markers;
    for (const [rel, content] of Object.entries(markerFiles)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
  }
  for (const [rel, content] of Object.entries(results)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

export function runNode(script, args, { cwd, env = {} } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: 'utf8',
  });
}

export function runCounts(cwd, args, options = {}) {
  return runNode(COUNTS_CLI, args, { cwd, ...options });
}

export function runCountsGuard(cwd, args = [], options = {}) {
  return runNode(GUARD_CLI, args, { cwd, ...options });
}

export function removeRepo(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
