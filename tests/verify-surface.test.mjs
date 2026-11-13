import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AUDIENCES,
  CLASSES,
  STATUSES,
  extractCatalogStatusBlock,
  normalizeCatalogStatusBlock,
  slugHeading,
  verifySurface,
  workflowCallInfo,
} from '../scripts/internal/verify-surface.mjs';
import {
  CATALOG_STATUS_END_MARKER,
  CATALOG_STATUS_START_MARKER,
  GENERATED_MARKER,
  renderCatalogStatusBlock,
} from '../scripts/internal/surface-shared.mjs';
import { cleanupSurfaceCase, materializeSurfaceCase, readCase } from './fixtures/surface/materialize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(ROOT, 'scripts', 'internal', 'verify-surface.mjs');
const RENDERER = path.join(ROOT, 'scripts', 'internal', 'render-surface.mjs');
const CASES = fs
  .readdirSync(path.join(ROOT, 'tests', 'fixtures', 'surface', 'cases'))
  .filter((name) => fs.existsSync(path.join(ROOT, 'tests', 'fixtures', 'surface', 'cases', name, 'case.json')))
  .sort();

function evaluate(name, options = {}) {
  const root = materializeSurfaceCase(name);
  try {
    return verifySurface({ root, ...options });
  } finally {
    cleanupSurfaceCase(root);
  }
}

function codes(list) {
  return new Set(list.map((item) => item.code));
}

function runCli(args, cwd = ROOT) {
  return spawnSync(process.execPath, [GUARD, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function runRenderer(args, cwd = ROOT) {
  return spawnSync(process.execPath, [RENDERER, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

// ---------------------------------------------------------------------------
// Clean fixture
// ---------------------------------------------------------------------------

test('clean fixture passes with no violations or warnings', () => {
  const root = materializeSurfaceCase('clean');
  try {
    const result = verifySurface({ root, requireManifest: true });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.ok, true);
    assert.equal(result.counts.entries, 13);
    assert.equal(result.counts.shipped, 12);
    assert.equal(result.counts.contractOnly, 1);
    assert.equal(result.counts.classifiedFiles, 13);
  } finally {
    cleanupSurfaceCase(root);
  }
});

// ---------------------------------------------------------------------------
// Every rule has a negative fixture that produces its audit code
// ---------------------------------------------------------------------------

for (const name of CASES) {
  const spec = readCase(name);
  if (!spec.expect?.errors?.length) continue;
  test(`fixture ${name} fails with ${spec.expect.errors.join(', ')}`, () => {
    const result = evaluate(name);
    assert.equal(result.ok, false);
    const emitted = codes(result.errors);
    for (const code of spec.expect.errors)
      assert.ok(emitted.has(code), `${name}: expected ${code}, got ${[...emitted].join(', ')}`);
  });
}

for (const name of CASES) {
  const spec = readCase(name);
  if (!spec.expect?.warnings?.length) continue;
  test(`fixture ${name} is advisory until --strict`, () => {
    const result = evaluate(name);
    assert.equal(result.ok, true);
    const emitted = codes(result.warnings);
    for (const code of spec.expect.warnings) assert.ok(emitted.has(code), `${name}: expected warning ${code}`);
    const strict = evaluate(name, { strict: true });
    assert.equal(strict.ok, false);
  });
}

test('missing manifest skips unless --require-manifest is set', () => {
  const skipped = evaluate('missing-manifest');
  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, 'manifest-missing');
  const required = evaluate('missing-manifest', { requireManifest: true });
  assert.equal(required.ok, false);
  assert.ok(codes(required.errors).has('SURFACE_MANIFEST_PARSE'));
});

// ---------------------------------------------------------------------------
// Helpers exported for tests
// ---------------------------------------------------------------------------

test('workflowCallInfo detects workflow_call and ignores comments', () => {
  const reusable = read('clean/.github/workflows/reusable-demo.yml');
  assert.equal(workflowCallInfo(reusable).workflowCall, true);
  assert.deepEqual(workflowCallInfo(reusable).triggers, ['workflow_call']);

  const caller = read('clean/.github/workflows/demo.yml');
  assert.equal(workflowCallInfo(caller).workflowCall, false);
  assert.deepEqual(workflowCallInfo(caller).triggers, ['push', 'pull_request']);

  const commented = `${caller}\n# workflow_call only appears in this comment\n`;
  assert.equal(workflowCallInfo(commented).workflowCall, false);

  const inline = 'name: Inline\non: [workflow_call]\n';
  assert.equal(workflowCallInfo(inline).workflowCall, true);
});

test('slugHeading matches the check-docs anchor algorithm', () => {
  assert.equal(slugHeading('7.2 `reusable-ci.yml` — required CI contract'), '72-reusable-ciyml-required-ci-contract');
  assert.equal(slugHeading('1. Repository map'), '1-repository-map');
  assert.equal(slugHeading('No-copy guard distribution'), 'no-copy-guard-distribution');
  assert.equal(
    slugHeading('5.1 Reusable mode (recommended; one runnable caller)'),
    '51-reusable-mode-recommended-one-runnable-caller',
  );
});

function read(rel) {
  return fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'surface', rel), 'utf8');
}

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

test('CLI --json prints the machine-readable result and exits 0 on the clean fixture', () => {
  const root = materializeSurfaceCase('clean');
  try {
    const result = runCli(['--root', root, '--require-manifest', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.skipped, null);
    assert.equal(parsed.counts.entries, 13);
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.warnings, []);
  } finally {
    cleanupSurfaceCase(root);
  }
});

test('CLI --json exits 1 and reports violations on the real repository', () => {
  const result = runCli(['--root', ROOT, '--require-manifest', '--json']);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.counts.entries > 100);
});

test('CLI fails with the audit code and human output on a bad fixture', () => {
  const root = materializeSurfaceCase('workflow-call-in-caller');
  try {
    const result = runCli(['--root', root, '--require-manifest']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Surface guard FAILED/);
    assert.match(result.stderr, /SURFACE_WORKFLOW_CALL_INVALID/);
  } finally {
    cleanupSurfaceCase(root);
  }
});

test('CLI skips a root without a manifest and fails with --require-manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-empty-'));
  try {
    const skipped = runCli(['--root', root]);
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.match(skipped.stdout, /Surface guard skipped/);

    const required = runCli(['--root', root, '--require-manifest']);
    assert.equal(required.status, 1);
    assert.match(required.stderr, /SURFACE_MANIFEST_PARSE/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI usage errors exit 2', () => {
  const unknown = runCli(['--nope']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown option --nope/);

  const missingValue = runCli(['--root']);
  assert.equal(missingValue.status, 2);
  assert.match(missingValue.stderr, /--root requires a value/);

  const help = runCli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: node scripts\/internal\/verify-surface\.mjs/);
});

// ---------------------------------------------------------------------------
// Generated surface doc + catalog status block
// ---------------------------------------------------------------------------

test('verify-surface re-exports the shared class/status/audience lists', () => {
  assert.deepEqual(CLASSES, [
    'reusable-workflow',
    'reusable-action',
    'copy-mode',
    'adopter-cli',
    'adopter-lib',
    'internal',
    'generated',
  ]);
  assert.deepEqual(STATUSES, ['shipped', 'contract-only']);
  assert.deepEqual(AUDIENCES, ['template', 'adopter']);
});

test('renderCatalogStatusBlock is deterministic, marked, and lists reusable entries sorted', () => {
  const manifest = JSON.parse(read('clean/contract/repo-surface.json'));
  const block = renderCatalogStatusBlock(manifest.entries);
  assert.equal(block, renderCatalogStatusBlock([...manifest.entries].reverse()), 'order-independent output');
  assert.ok(block.startsWith(CATALOG_STATUS_START_MARKER), 'starts with start marker');
  assert.ok(block.endsWith(CATALOG_STATUS_END_MARKER), 'ends with end marker');
  assert.ok(block.includes(GENERATED_MARKER), 'carries the generated-by marker');
  assert.match(block, /- shipped: `demo`, `reusable-demo\.yml`/);
  assert.match(block, /- contract-only: `setup-node-cache`/);
  assert.ok(!block.includes('action.yml'), 'reusable actions use their directory name, not the shared basename');
});

test('clean fixture catalog carries the generated availability block and passes in exact mode', () => {
  const root = materializeSurfaceCase('clean');
  try {
    const text = fs.readFileSync(path.join(root, 'docs', 'ACTIONS_CATALOG.md'), 'utf8');
    const block = extractCatalogStatusBlock(text);
    assert.ok(block, 'clean catalog has surface-status markers');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'contract', 'repo-surface.json'), 'utf8'));
    assert.equal(
      normalizeCatalogStatusBlock(block),
      normalizeCatalogStatusBlock(renderCatalogStatusBlock(manifest.entries)),
      'clean fixture block matches the shared renderer',
    );
    const result = verifySurface({ root, requireManifest: true });
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  } finally {
    cleanupSurfaceCase(root);
  }
});

test('catalog status block drift is blocking and does not fall back to the prose parser', () => {
  const result = evaluate('catalog-status-block-drift');
  assert.equal(result.ok, false);
  const emitted = codes(result.errors);
  assert.ok(emitted.has('SURFACE_CATALOG_STATUS_BLOCK_DRIFT'), `expected drift, got ${[...emitted].join(', ')}`);
  assert.ok(!emitted.has('SURFACE_CATALOG_STATUS_MISMATCH'), 'exact mode replaces the tolerant parser');
});

test('catalog without generated markers keeps the tolerant prose-parser fallback', () => {
  const result = evaluate('catalog-status-mismatch');
  const emitted = codes(result.errors);
  assert.ok(emitted.has('SURFACE_CATALOG_STATUS_MISMATCH'), `expected fallback code, got ${[...emitted].join(', ')}`);
  assert.ok(!emitted.has('SURFACE_CATALOG_STATUS_BLOCK_DRIFT'), 'no marker block in this fixture');
});

test('render-surface --check passes on the committed docs/SURFACE.md', () => {
  const result = runRenderer(['--check']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /docs\/SURFACE\.md is up to date/);
});

test('render-surface --stdout reproduces docs/SURFACE.md byte-for-byte', () => {
  const result = runRenderer(['--stdout']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, fs.readFileSync(path.join(ROOT, 'docs', 'SURFACE.md'), 'utf8'));
});

test('render-surface --check fails loudly when docs/SURFACE.md is stale, and --write repairs it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-render-'));
  try {
    fs.mkdirSync(path.join(root, 'contract'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'contract', 'repo-surface.json'), path.join(root, 'contract', 'repo-surface.json'));
    fs.copyFileSync(path.join(ROOT, 'tracker.config.json'), path.join(root, 'tracker.config.json'));
    fs.copyFileSync(path.join(ROOT, 'docs', 'SURFACE.md'), path.join(root, 'docs', 'SURFACE.md'));

    const fresh = runRenderer(['--root', root, '--check']);
    assert.equal(fresh.status, 0, fresh.stderr);

    fs.appendFileSync(path.join(root, 'docs', 'SURFACE.md'), '\nstale edit\n');
    const stale = runRenderer(['--root', root, '--check']);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /docs\/SURFACE\.md is stale/);
    assert.match(stale.stderr, /first difference at docs\/SURFACE\.md:\d+/);

    const wrote = runRenderer(['--root', root, '--write']);
    assert.equal(wrote.status, 0, wrote.stderr);
    const repaired = runRenderer(['--root', root, '--check']);
    assert.equal(repaired.status, 0, repaired.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('render-surface mode flags are mutually exclusive (usage error)', () => {
  const result = runRenderer(['--check', '--stdout']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /only one of --check, --stdout, --write/);
});
