import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateDocsCounts } from '../scripts/github/guard-docs-counts.mjs';
import { renderGeneratedDoc } from '../scripts/github/suite-counts.mjs';
import {
  countsConfig,
  readJson,
  removeRepo,
  reviewed,
  runCountsGuard,
  tempCountsRepo,
  unitBaseline,
} from './helpers/counts-fixtures.mjs';

function configFor(dir) {
  return readJson(path.join(dir, 'tracker.config.json'));
}

test('counts guard passes a valid baseline, generated doc, and markers', () => {
  const tmp = tempCountsRepo({ marker: undefined });
  try {
    fs.writeFileSync(
      path.join(tmp, 'docs/REFERENCE.md'),
      '# REFERENCE\n\nUnit: <!-- counts:unit/full -->3 collected · 3 passed · 0 failed · 0 skipped · 0 flaky<!-- /counts:unit/full -->\n',
    );
    const result = evaluateDocsCounts({ root: tmp, config: configFor(tmp) });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.noPolicy, false);
    assert.deepEqual(result.checked, {
      baseline: 'docs/test-counts.baseline.json',
      suites: 1,
      modes: 1,
      markerFiles: 1,
    });

    const cli = runCountsGuard(tmp);
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /docs counts contract OK — 1 suite\(s\) \/ 1 mode\(s\)/);
  } finally {
    removeRepo(tmp);
  }
});

test('counts guard fails stale generated doc and stale markers with update guidance', () => {
  const tmp = tempCountsRepo();
  try {
    fs.appendFileSync(path.join(tmp, 'docs/TEST_COUNTS.md'), '\nstale trailing line\n');
    fs.writeFileSync(
      path.join(tmp, 'docs/REFERENCE.md'),
      '# REFERENCE\n\nUnit: <!-- counts:unit/full -->0 passed<!-- /counts:unit/full -->\n',
    );
    const result = evaluateDocsCounts({ root: tmp, config: configFor(tmp) });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.path === 'docs/TEST_COUNTS.md' && /stale/.test(error.message)));
    assert.ok(
      result.errors.some(
        (error) => error.path === 'docs/REFERENCE.md' && /stale marker counts:unit\/full/.test(error.message),
      ),
    );
    assert.ok(result.errors.some((error) => /npm run docs:counts:update/.test(error.message)));

    const cli = runCountsGuard(tmp);
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /docs counts guard FAILED/);
    assert.match(cli.stderr, /docs\/TEST_COUNTS\.md/);
  } finally {
    removeRepo(tmp);
  }
});

test('counts guard fails missing generated doc, missing marker file, and unknown/unclosed markers', () => {
  const missingDoc = tempCountsRepo();
  try {
    fs.rmSync(path.join(missingDoc, 'docs/TEST_COUNTS.md'));
    const result = evaluateDocsCounts({ root: missingDoc, config: configFor(missingDoc) });
    assert.ok(result.errors.some((error) => /generated counts doc is missing/.test(error.message)));
  } finally {
    removeRepo(missingDoc);
  }

  const missingMarker = tempCountsRepo({ markers: {} });
  try {
    const result = evaluateDocsCounts({ root: missingMarker, config: configFor(missingMarker) });
    assert.ok(
      result.errors.some((error) => error.path === 'docs/REFERENCE.md' && /marker file not found/.test(error.message)),
    );
  } finally {
    removeRepo(missingMarker);
  }

  const badMarkers = tempCountsRepo();
  try {
    fs.writeFileSync(
      path.join(badMarkers, 'docs/REFERENCE.md'),
      '# REFERENCE\n\nUnknown: <!-- counts:unit/nope -->x<!-- /counts:unit/nope -->\nUnclosed: <!-- counts:unit/full -->3\n',
    );
    const result = evaluateDocsCounts({ root: badMarkers, config: configFor(badMarkers) });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /unknown marker key/.test(error.message)));
    assert.ok(result.errors.some((error) => /unclosed or malformed/.test(error.message)));
  } finally {
    removeRepo(badMarkers);
  }
});

test('counts guard enforces named-skip and reviewed agreement metadata in the baseline', () => {
  const missingSkipMetadata = unitBaseline({
    collected: 4,
    passed: 3,
    skipped: 1,
    knownSkips: [{ test: 'skip A', reason: '', coveredBy: '', agreedOn: '' }],
  });
  const tmp = tempCountsRepo({ baseline: missingSkipMetadata });
  try {
    const result = evaluateDocsCounts({ root: tmp, config: configFor(tmp) });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /knownSkips\[0\]\.reason/.test(error.path)));
    assert.ok(result.errors.some((error) => /knownSkips\[0\]\.agreedOn/.test(error.path)));
  } finally {
    removeRepo(tmp);
  }

  const noReview = unitBaseline({ reviewed: { on: '', by: '', evidence: [] } });
  const tmp2 = tempCountsRepo({ baseline: noReview });
  try {
    const result = evaluateDocsCounts({ root: tmp2, config: configFor(tmp2) });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /reviewed\.evidence/.test(error.path)));
  } finally {
    removeRepo(tmp2);
  }
});

test('counts guard fails malformed/missing baseline and malformed config', () => {
  const malformed = tempCountsRepo();
  try {
    fs.writeFileSync(path.join(malformed, 'docs/test-counts.baseline.json'), '{not json');
    const result = evaluateDocsCounts({ root: malformed, config: configFor(malformed) });
    assert.ok(result.errors.some((error) => /cannot parse baseline/.test(error.message)));
  } finally {
    removeRepo(malformed);
  }

  const missing = tempCountsRepo({ baseline: null, generated: null });
  try {
    const result = evaluateDocsCounts({ root: missing, config: configFor(missing) });
    assert.ok(result.errors.some((error) => /baseline file not found/.test(error.message)));
  } finally {
    removeRepo(missing);
  }

  const badConfig = tempCountsRepo();
  try {
    const config = configFor(badConfig);
    config.docs.counts.markers = 'docs/REFERENCE.md';
    const result = evaluateDocsCounts({ root: badConfig, config });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.path === 'docs.counts.markers'));
  } finally {
    removeRepo(badConfig);
  }
});

test('counts guard is a no-op when docs.counts is absent', () => {
  const tmp = tempCountsRepo({ config: countsConfig({ docs: undefined }) });
  try {
    const result = evaluateDocsCounts({ root: tmp, config: configFor(tmp) });
    assert.equal(result.ok, true);
    assert.equal(result.noPolicy, true);
    const cli = runCountsGuard(tmp);
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /not configured \(no-op\)/);
  } finally {
    removeRepo(tmp);
  }
});

test('counts guard ignores historical docs that are not configured markers', () => {
  const tmp = tempCountsRepo();
  try {
    // Historical release notes with old numbers must stay untouched and must not be checked.
    fs.writeFileSync(
      path.join(tmp, 'docs/RELEASE_HISTORY.md'),
      '# v0.4.6 release\n\n656 tests / 47 E2E passed at the time.\n',
    );
    const result = evaluateDocsCounts({ root: tmp, config: configFor(tmp) });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(
      fs.readFileSync(path.join(tmp, 'docs/RELEASE_HISTORY.md'), 'utf8').includes('656 tests'),
      true,
      'historical text is exempt by construction',
    );
  } finally {
    removeRepo(tmp);
  }
});

test('counts guard CLI --json returns the machine-readable result', () => {
  const tmp = tempCountsRepo();
  try {
    const ok = runCountsGuard(tmp, ['--json']);
    assert.equal(ok.status, 0, ok.stderr);
    const parsed = JSON.parse(ok.stdout);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.checked, {
      baseline: 'docs/test-counts.baseline.json',
      suites: 1,
      modes: 1,
      markerFiles: 1,
    });

    fs.writeFileSync(path.join(tmp, 'docs/TEST_COUNTS.md'), 'stale\n');
    const stale = runCountsGuard(tmp, ['--json']);
    assert.equal(stale.status, 1);
    const staleParsed = JSON.parse(stale.stdout);
    assert.equal(staleParsed.ok, false);
    assert.ok(staleParsed.errors.length > 0);
    assert.doesNotMatch(stale.stderr, /^error:/m);
  } finally {
    removeRepo(tmp);
  }
});

test('generated doc in the valid fixture matches renderGeneratedDoc exactly', () => {
  const tmp = tempCountsRepo();
  try {
    const baseline = readJson(path.join(tmp, 'docs/test-counts.baseline.json'));
    const expected = renderGeneratedDoc(baseline, { baselinePath: 'docs/test-counts.baseline.json' });
    assert.equal(fs.readFileSync(path.join(tmp, 'docs/TEST_COUNTS.md'), 'utf8'), expected);
    assert.equal(baseline.suites[0].modes[0].reviewed.by, reviewed().by);
  } finally {
    removeRepo(tmp);
  }
});
