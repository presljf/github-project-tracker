import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateConfig } from '../scripts/github/validate-config.mjs';
import {
  BASELINE_SCHEMA_VERSION,
  applyMarkers,
  baselineModeKeys,
  checkMarkers,
  compareResults,
  findBaselineMode,
  formatDriftReport,
  markerValue,
  parseNodeTest,
  parsePlaywrightJson,
  parseResults,
  parseVerifyJson,
  renderGeneratedDoc,
  resolveCountsConfig,
  validateBaseline,
} from '../scripts/github/suite-counts.mjs';
import {
  countsConfig,
  readFixture,
  readJson,
  removeRepo,
  reviewed,
  runCounts,
  tempCountsRepo,
  unitBaseline,
  writeJson,
} from './helpers/counts-fixtures.mjs';

const TRACKER_TAP = readFixture('node-test-tap.txt');
const TRACKER_SUMMARY = readFixture('node-test-summary.txt');
const TRACKER_SUMMARY_SKIPS = readFixture('node-test-summary-skips.txt');
const PLAYWRIGHT = readFixture('playwright-results.json');
const VERIFY = readFixture('verify-results.json');
const MALFORMED = readFixture('malformed-results.txt');

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

test('playwright parser extracts stats counts, flaky, and skipped test titles', () => {
  const parsed = parsePlaywrightJson(PLAYWRIGHT);
  assert.equal(parsed.runner, 'playwright');
  assert.deepEqual(parsed.counts, { collected: 9, passed: 5, failed: 1, skipped: 2, flaky: 1 });
  assert.deepEqual(parsed.skippedTests, ['desktop › native dialog', 'desktop › nested › deep skip']);
});

test('playwright parser fails loudly on malformed, interrupted, or unverifiable output', () => {
  assert.throws(() => parsePlaywrightJson('{"foo": 1}'), /missing stats object/);
  assert.throws(() => parsePlaywrightJson('not json'), /malformed Playwright JSON/);
  const interrupted = JSON.parse(PLAYWRIGHT);
  interrupted.stats.interrupted = 1;
  assert.throws(() => parsePlaywrightJson(interrupted), /interrupted/);
  const mismatch = JSON.parse(PLAYWRIGHT);
  mismatch.stats.skipped = 3;
  assert.throws(() => parsePlaywrightJson(mismatch), /skipped test title/);
});

test('node-test parser maps TAP counts and extracts skip/todo titles', () => {
  const parsed = parseNodeTest(TRACKER_TAP);
  assert.equal(parsed.runner, 'node-test');
  assert.deepEqual(parsed.counts, { collected: 3, passed: 1, failed: 0, skipped: 2, flaky: 0 });
  assert.deepEqual(parsed.skippedTests, ['future work', 'skipped by agreement']);
});

test('node-test parser handles spec summary and cannot name skips from summary-only output', () => {
  const parsed = parseNodeTest(TRACKER_SUMMARY);
  assert.deepEqual(parsed.counts, { collected: 2, passed: 2, failed: 0, skipped: 0, flaky: 0 });
  const withSkips = parseNodeTest(TRACKER_SUMMARY_SKIPS);
  assert.deepEqual(withSkips.counts, { collected: 2, passed: 1, failed: 0, skipped: 1, flaky: 0 });
  assert.equal(withSkips.skippedTests, null, 'summary output cannot expose skipped titles');
  assert.throws(() => parseNodeTest(MALFORMED), /unrecognized node-test output/);
});

test('node-test cancelled tests count as failed so an aborted run cannot pass', () => {
  const parsed = parseNodeTest(
    '# tests 3\n# pass 2\n# fail 0\n# cancelled 1\n# skipped 0\n# todo 0\n# duration_ms 1.0\n',
  );
  assert.deepEqual(parsed.counts, { collected: 3, passed: 2, failed: 1, skipped: 0, flaky: 0 });
});

test('verify-json parser maps statuses incl. deferred remote suites to skipped', () => {
  const parsed = parseVerifyJson(VERIFY);
  assert.equal(parsed.runner, 'verify-json');
  assert.deepEqual(parsed.counts, { collected: 5, passed: 2, failed: 1, skipped: 2, flaky: 0 });
  assert.deepEqual(parsed.skippedTests, ['desktop-smoke', 'e2e']);
  assert.throws(() => parseVerifyJson('{"status":"PASS"}'), /expected an array of checks/);
  assert.throws(() => parseVerifyJson({ checks: [{ name: 'x', status: 'BROKEN' }] }), /unsupported status "BROKEN"/);
});

test('parseResults auto-detects runner output and fails loudly on unknown formats', () => {
  assert.equal(parseResults(PLAYWRIGHT).runner, 'playwright');
  assert.equal(parseResults(VERIFY).runner, 'verify-json');
  assert.equal(parseResults(TRACKER_TAP).runner, 'node-test');
  assert.throws(() => parseResults(MALFORMED), /unrecognized node-test output/);
  assert.throws(() => parseResults('{"unexpected": true}'), /unrecognized JSON results/);
  assert.throws(() => parseResults('', { runner: 'auto' }), /results are empty/);
  assert.throws(() => parseResults(TRACKER_TAP, { runner: 'playwright' }), /malformed Playwright JSON/);
  assert.throws(() => parseResults(TRACKER_TAP, { runner: 'bogus' }), /unknown runner/);
});

// ---------------------------------------------------------------------------
// compareResults drift matrix
// ---------------------------------------------------------------------------

function expectedFor(result) {
  return { ...result.counts, knownSkips: (result.skippedTests || []).map((test) => ({ test })) };
}

test('compareResults is quiet and ok on zero drift', () => {
  const actual = parseNodeTest(TRACKER_TAP);
  const comparison = compareResults(actual, expectedFor(actual));
  assert.equal(comparison.ok, true);
  assert.deepEqual(comparison.messages, []);
  assert.deepEqual(comparison.drift, []);
});

test('compareResults reports exact drift for every count metric', () => {
  const actual = parseNodeTest(TRACKER_SUMMARY);
  for (const metric of ['collected', 'passed', 'failed', 'skipped']) {
    const expected = { ...actual.counts, knownSkips: [] };
    expected[metric] = expected[metric] + 1;
    const comparison = compareResults(actual, expected);
    assert.equal(comparison.ok, false, metric);
    assert.ok(
      comparison.drift.some((entry) => entry.metric === metric),
      metric,
    );
    assert.ok(
      comparison.messages.some((message) => message.includes(metric)),
      metric,
    );
  }
});

test('compareResults fails flaky results even when the baseline records the same flaky count', () => {
  const actual = parsePlaywrightJson(PLAYWRIGHT);
  const expected = { ...actual.counts, knownSkips: expectedFor(actual).knownSkips };
  const comparison = compareResults(actual, expected);
  assert.equal(comparison.ok, false);
  assert.equal(comparison.flakyFail, true);
  assert.ok(comparison.messages.some((message) => /flaky tests reported/.test(message)));
});

test('compareResults detects added, removed, and renamed skipped tests', () => {
  const actual = {
    counts: { collected: 3, passed: 1, failed: 0, skipped: 2, flaky: 0 },
    skippedTests: ['skip A', 'skip B'],
  };
  const added = compareResults(actual, {
    ...actual.counts,
    knownSkips: [{ test: 'skip A' }],
  });
  assert.equal(added.ok, false);
  assert.deepEqual(added.skips.added, ['skip B']);
  assert.ok(added.messages.some((message) => /skipped test added without agreement: "skip B"/.test(message)));

  const removed = compareResults(
    { counts: { collected: 3, passed: 2, failed: 0, skipped: 1, flaky: 0 }, skippedTests: ['skip A'] },
    {
      counts: {},
      collected: 3,
      passed: 2,
      failed: 0,
      skipped: 1,
      flaky: 0,
      knownSkips: [{ test: 'skip A' }, { test: 'skip B' }],
    },
  );
  assert.deepEqual(removed.skips.removed, ['skip B']);

  const renamed = compareResults(actual, {
    collected: 3,
    passed: 1,
    failed: 0,
    skipped: 2,
    flaky: 0,
    knownSkips: [{ test: 'old A' }, { test: 'old B' }],
  });
  assert.deepEqual(renamed.skips.added, ['skip A', 'skip B']);
  assert.deepEqual(renamed.skips.removed, ['old A', 'old B']);
  assert.equal(renamed.skips.possibleRename, true);
  assert.ok(renamed.messages.some((message) => /possible rename/.test(message)));
});

test('compareResults fails when skipped titles are unavailable and skips exist', () => {
  const actual = parseNodeTest(TRACKER_SUMMARY_SKIPS);
  const comparison = compareResults(actual, {
    ...actual.counts,
    knownSkips: [{ test: 'named skip' }],
  });
  assert.equal(comparison.ok, false);
  assert.equal(comparison.skips.unavailable, true);
  assert.ok(comparison.messages.some((message) => /--test-reporter=tap/.test(message)));
});

test('formatDriftReport includes exact diff, inventory, and updateCommand guidance', () => {
  const actual = parseNodeTest(TRACKER_SUMMARY);
  const comparison = compareResults(actual, { ...actual.counts, passed: 99, knownSkips: [] });
  const text = formatDriftReport(comparison, {
    suite: 'unit',
    mode: 'full',
    updateCommand: 'npm run docs:counts:update',
    inventoryCommand: 'npm test -- --test-reporter=tap',
  });
  assert.match(text, /^COUNTS_DRIFT suite=unit mode=full/);
  assert.match(text, /count drift: passed expected 99 got 2/);
  assert.match(text, /npm run docs:counts:update/);
  assert.match(text, /npm test -- --test-reporter=tap/);
});

// ---------------------------------------------------------------------------
// Baseline schema validation + agreement metadata
// ---------------------------------------------------------------------------

test('baseline validation accepts the documented example baseline and minimal valid entries', () => {
  const example = readJson(path.join(process.cwd(), 'profiles/counts/test-counts.baseline.example.json'));
  const result = validateBaseline(example);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(validateBaseline(unitBaseline()).ok, true);
  assert.equal(validateBaseline({ ...unitBaseline(), $schema: './schemas/test-counts.baseline.schema.json' }).ok, true);
});

test('baseline validation rejects count/schema drift with actionable paths', () => {
  const collectedMismatch = unitBaseline({ collected: 99 });
  assert.ok(
    validateBaseline(collectedMismatch).errors.some(
      (error) => error.path === '$.suites[0].modes[0].collected' && /must equal/.test(error.message),
    ),
  );
  const badVersion = { schemaVersion: 2, suites: [] };
  assert.ok(validateBaseline(badVersion).errors.some((error) => error.path === '$.schemaVersion'));
  const unknownKey = unitBaseline();
  unknownKey.suites[0].modes[0].todo = 1;
  assert.ok(validateBaseline(unknownKey).errors.some((error) => /not a supported key/.test(error.message)));
  const negative = unitBaseline({ passed: -1 });
  assert.ok(validateBaseline(negative).errors.some((error) => /non-negative integer/.test(error.message)));
  const flaky = unitBaseline({ flaky: 1, passed: 2 });
  assert.ok(validateBaseline(flaky).errors.some((error) => /must be 0/.test(error.message)));
  assert.equal(validateBaseline(null).ok, false);
});

test('baseline validation enforces named-skip and reviewed agreement metadata', () => {
  const named = unitBaseline({
    collected: 4,
    passed: 2,
    skipped: 2,
    knownSkips: [
      { test: 'skip A', reason: 'ok', coveredBy: '#1', agreedOn: '2026-11-12' },
      { test: 'skip B', reason: 'ok', coveredBy: '#2', agreedOn: '2026-11-12' },
    ],
  });
  assert.equal(validateBaseline(named).ok, true, JSON.stringify(validateBaseline(named).errors));

  const missingEntry = unitBaseline({ collected: 4, passed: 3, skipped: 1, knownSkips: [] });
  assert.ok(validateBaseline(missingEntry).errors.some((error) => /must name every skipped test/.test(error.message)));

  const missingMetadata = unitBaseline({
    collected: 4,
    passed: 3,
    skipped: 1,
    knownSkips: [{ test: 'skip A', reason: '', coveredBy: '', agreedOn: '' }],
  });
  const metadataErrors = validateBaseline(missingMetadata).errors;
  for (const key of ['reason', 'coveredBy', 'agreedOn']) {
    assert.ok(
      metadataErrors.some((error) => error.path.endsWith(`.knownSkips[0].${key}`)),
      key,
    );
  }

  const duplicateSkip = unitBaseline({
    collected: 5,
    passed: 3,
    skipped: 2,
    knownSkips: [
      { test: 'dup', reason: 'a', coveredBy: '#1', agreedOn: '2026-11-12' },
      { test: 'dup', reason: 'b', coveredBy: '#2', agreedOn: '2026-11-12' },
    ],
  });
  assert.ok(validateBaseline(duplicateSkip).errors.some((error) => /duplicate skipped test/.test(error.message)));

  const noReview = unitBaseline({ reviewed: { on: '', by: '', evidence: [] } });
  const reviewErrors = validateBaseline(noReview).errors;
  assert.ok(reviewErrors.some((error) => error.path.endsWith('.reviewed.on')));
  assert.ok(reviewErrors.some((error) => error.path.endsWith('.reviewed.by')));
  assert.ok(reviewErrors.some((error) => error.path.endsWith('.reviewed.evidence')));

  const noSkipsField = unitBaseline();
  delete noSkipsField.suites[0].modes[0].knownSkips;
  assert.ok(validateBaseline(noSkipsField).errors.some((error) => error.path.endsWith('.knownSkips')));
});

test('baseline validation rejects duplicate suites/modes and malformed structure', () => {
  const duplicateSuite = unitBaseline();
  duplicateSuite.suites.push({ id: 'unit', modes: [{ ...duplicateSuite.suites[0].modes[0] }] });
  assert.ok(validateBaseline(duplicateSuite).errors.some((error) => /duplicate suite id/.test(error.message)));

  const duplicateMode = unitBaseline();
  duplicateMode.suites[0].modes.push({ ...duplicateMode.suites[0].modes[0] });
  assert.ok(validateBaseline(duplicateMode).errors.some((error) => /duplicate mode/.test(error.message)));

  assert.ok(validateBaseline({ schemaVersion: 1 }).errors.some((error) => error.path === '$.suites'));
  assert.equal(validateBaseline([]).ok, false);
});

// ---------------------------------------------------------------------------
// Generated doc + inline markers
// ---------------------------------------------------------------------------

test('generated doc rendering is deterministic and complete', () => {
  const baseline = readJson(path.join(process.cwd(), 'profiles/counts/test-counts.baseline.example.json'));
  const doc = renderGeneratedDoc(baseline, { baselinePath: 'docs/test-counts.baseline.json' });
  const shuffled = {
    schemaVersion: baseline.schemaVersion,
    suites: [...baseline.suites].reverse().map((suite) => ({ ...suite, modes: [...suite.modes].reverse() })),
  };
  assert.equal(renderGeneratedDoc(shuffled, { baselinePath: 'docs/test-counts.baseline.json' }), doc);
  assert.match(doc, /^# Test counts/);
  assert.match(doc, /Generated by `node scripts\/github\/suite-counts\.mjs render`/);
  assert.match(doc, /\| full \| 156 \| 156 \| 0 \| 0 \| 0 \| 2026-11-12 · agent:tracker-os-builder \|/);
  assert.match(doc, /### Known skips — desktop-smoke \/ remote-visible/);
  assert.match(doc, /native focus\/dialog coverage requires an interactive macOS session/);
});

test('inline markers update summaries/metrics and detect stale/unknown/unclosed markers', () => {
  const baseline = unitBaseline();
  const source = [
    'Unit: <!-- counts:unit/full -->1 collected · 1 passed · 1 failed · 1 skipped · 1 flaky<!-- /counts:unit/full -->',
    'Passed: <!-- counts:unit/full/passed -->0<!-- /counts:unit/full/passed -->',
  ].join('\n');
  const applied = applyMarkers(source, baseline, { label: 'doc.md' });
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.replacements, 2);
  assert.match(
    applied.text,
    /<!-- counts:unit\/full -->3 collected · 3 passed · 0 failed · 0 skipped · 0 flaky<!-- \/counts:unit\/full -->/,
  );
  assert.match(applied.text, /<!-- counts:unit\/full\/passed -->3<!-- \/counts:unit\/full\/passed -->/);

  const stale = checkMarkers(source, baseline, { label: 'doc.md' });
  assert.equal(stale.ok, false);
  assert.ok(stale.errors.some((error) => /stale marker counts:unit\/full/.test(error.message)));

  const unknown = checkMarkers('<!-- counts:nope/full -->x<!-- /counts:nope/full -->', baseline);
  assert.ok(unknown.errors.some((error) => /unknown marker key counts:nope\/full/.test(error.message)));

  const unclosed = checkMarkers('<!-- counts:unit/full -->3', baseline);
  assert.ok(unclosed.errors.some((error) => /unclosed or malformed/.test(error.message)));

  const untouched = applyMarkers(
    'Historical v0.4: 656 tests / 47 E2E\nCurrent: <!-- counts:unit/full -->x<!-- /counts:unit/full -->',
    baseline,
  );
  assert.match(untouched.text, /Historical v0\.4: 656 tests \/ 47 E2E/, 'text outside markers is never rewritten');
});

test('markerValue supports summary and metric keys and rejects unknown keys', () => {
  const baseline = unitBaseline();
  assert.equal(markerValue('unit/full/passed', baseline), '3');
  assert.match(markerValue('unit/full', baseline), /^3 collected · 3 passed · 0 failed · 0 skipped · 0 flaky$/);
  assert.equal(markerValue('unit/nope', baseline), null);
  assert.equal(markerValue('unit/full/wat', baseline), null);
  assert.equal(findBaselineMode(baseline, 'unit', 'full').passed, 3);
  assert.equal(findBaselineMode(baseline, 'unit', 'nope'), null);
  assert.deepEqual(baselineModeKeys(baseline), ['unit/full']);
});

// ---------------------------------------------------------------------------
// Config schema (`docs.counts`)
// ---------------------------------------------------------------------------

test('docs.counts config validates and defaults commands; absent block is a no-op', () => {
  assert.deepEqual(validateConfig(countsConfig()), []);
  const resolved = resolveCountsConfig(countsConfig());
  assert.equal(resolved.present, true);
  assert.equal(resolved.baseline, 'docs/test-counts.baseline.json');
  assert.equal(resolved.updateCommand, 'npm run docs:counts:update');

  const minimal = {
    docs: { counts: { baseline: 'b.json', generated: 'g.md' } },
  };
  const minimalResolved = resolveCountsConfig(minimal);
  assert.equal(minimalResolved.present, true);
  assert.deepEqual(minimalResolved.markers, []);
  assert.equal(minimalResolved.inventoryCommand, 'npm test');

  const withoutDocs = countsConfig();
  delete withoutDocs.docs;
  const absent = resolveCountsConfig(withoutDocs);
  assert.equal(absent.present, false);
  assert.deepEqual(absent.errors, []);
  assert.equal(validateConfig(withoutDocs).length, 0);
});

test('docs.counts config rejects malformed shapes with $path errors', () => {
  const missingGenerated = countsConfig();
  delete missingGenerated.docs.counts.generated;
  assert.ok(
    validateConfig(missingGenerated).some(
      (error) => error.includes('$.docs.counts.generated') && /required/.test(error),
    ),
  );

  const badMarkers = countsConfig();
  badMarkers.docs.counts.markers = 'docs/REFERENCE.md';
  assert.ok(
    validateConfig(badMarkers).some((error) => error.includes('$.docs.counts.markers') && /expected type/.test(error)),
  );

  const unknownKey = countsConfig();
  unknownKey.docs.counts.todo = true;
  assert.ok(
    validateConfig(unknownKey).some((error) => error.includes('$.docs.counts.todo') && /not allowed/.test(error)),
  );

  assert.ok(resolveCountsConfig({ docs: { counts: 'nope' } }).errors.length > 0);
  assert.ok(
    resolveCountsConfig({ docs: { counts: { baseline: 'b', generated: 'g', markers: [1] } } }).errors.some(
      (error) => error.path === 'docs.counts.markers',
    ),
  );
  assert.ok(
    resolveCountsConfig({ docs: { counts: { baseline: 'b', generated: 'g', override: true } } }).errors.some((error) =>
      /not a supported key/.test(error.message),
    ),
  );
});

// ---------------------------------------------------------------------------
// CLI: record -> render -> check, drift/malformed/missing-config exit codes
// ---------------------------------------------------------------------------

test('CLI record writes counts + placeholder agreement, regenerates doc and markers', () => {
  const tmp = tempCountsRepo({ baseline: null, generated: null, results: { 'results/unit.tap': TRACKER_TAP } });
  try {
    const result = runCounts(tmp, ['record', '--suite', 'unit', '--mode', 'full', '--results', 'results/unit.tap']);
    assert.equal(result.status, 0, result.stderr);
    const baseline = readJson(path.join(tmp, 'docs/test-counts.baseline.json'));
    const entry = findBaselineMode(baseline, 'unit', 'full');
    assert.deepEqual(
      { ...entry, knownSkips: undefined, reviewed: undefined },
      {
        mode: 'full',
        collected: 3,
        passed: 1,
        failed: 0,
        skipped: 2,
        flaky: 0,
        knownSkips: undefined,
        reviewed: undefined,
      },
    );
    assert.equal(entry.knownSkips.length, 2);
    assert.deepEqual(
      entry.knownSkips.map((skip) => skip.test),
      ['future work', 'skipped by agreement'],
    );
    const doc = fs.readFileSync(path.join(tmp, 'docs/TEST_COUNTS.md'), 'utf8');
    assert.match(doc, /\| full \| 3 \| 1 \| 0 \| 2 \| 0 \| pending · pending \|/);
    const markerDoc = fs.readFileSync(path.join(tmp, 'docs/REFERENCE.md'), 'utf8');
    assert.match(
      markerDoc,
      /<!-- counts:unit\/full -->3 collected · 1 passed · 0 failed · 2 skipped · 0 flaky<!-- \/counts:unit\/full -->/,
    );
    // placeholders make the baseline invalid until the human agrees
    assert.equal(validateBaseline(baseline).ok, false);
    assert.match(result.stdout, /new skipped tests/);
    assert.match(result.stderr, /warning: baseline agreement is incomplete/);
  } finally {
    removeRepo(tmp);
  }
});

test('CLI check passes on zero drift and fails with exact drift + update guidance', () => {
  const tmp = tempCountsRepo({ results: { 'results/unit.tap': TRACKER_TAP } });
  try {
    // Align the committed baseline with the TAP fixture first.
    const record = runCounts(tmp, ['record', '--suite', 'unit', '--mode', 'full', '--results', 'results/unit.tap']);
    assert.equal(record.status, 0, record.stderr);
    const baselineFile = path.join(tmp, 'docs/test-counts.baseline.json');
    const baseline = readJson(baselineFile);
    const entry = findBaselineMode(baseline, 'unit', 'full');
    entry.knownSkips = entry.knownSkips.map((skip) => ({
      ...skip,
      reason: 'agreed fixture skip',
      coveredBy: '#114',
      agreedOn: '2026-11-12',
    }));
    entry.reviewed = reviewed();
    writeJson(baselineFile, baseline);

    const ok = runCounts(tmp, ['check', '--suite', 'unit', '--mode', 'full', '--results', 'results/unit.tap']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^COUNTS_OK suite=unit mode=full collected=3 passed=1 failed=0 skipped=2 flaky=0\n$/);

    fs.writeFileSync(path.join(tmp, 'results/unit-summary.txt'), TRACKER_SUMMARY);
    const drift = runCounts(tmp, [
      'check',
      '--suite',
      'unit',
      '--mode',
      'full',
      '--results',
      'results/unit-summary.txt',
    ]);
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /^COUNTS_DRIFT suite=unit mode=full/m);
    assert.match(drift.stderr, /count drift: collected expected 3 got 2/);
    assert.match(drift.stderr, /npm run docs:counts:update/);
    assert.match(drift.stderr, /npm test -- --test-reporter=tap/);

    const json = runCounts(tmp, [
      'check',
      '--suite',
      'unit',
      '--mode',
      'full',
      '--results',
      'results/unit-summary.txt',
      '--json',
    ]);
    assert.equal(json.status, 1);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.drift.some((entryDiff) => entryDiff.metric === 'collected'));

    const flakyResults = path.join(tmp, 'results/playwright.json');
    fs.writeFileSync(flakyResults, PLAYWRIGHT);
    const flaky = runCounts(tmp, [
      'check',
      '--suite',
      'unit',
      '--mode',
      'full',
      '--results',
      'results/playwright.json',
    ]);
    assert.equal(flaky.status, 1);
    assert.match(flaky.stderr, /flaky tests reported/);
  } finally {
    removeRepo(tmp);
  }
});

test('CLI check fails loudly on malformed results, unknown suite/mode, and absent config', () => {
  const tmp = tempCountsRepo({ results: { 'results/bad.txt': MALFORMED } });
  try {
    const bad = runCounts(tmp, ['check', '--suite', 'unit', '--mode', 'full', '--results', 'results/bad.txt']);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /unrecognized node-test output/);

    const unknown = runCounts(tmp, ['check', '--suite', 'nope', '--mode', 'full', '--results', 'results/bad.txt']);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /not in the baseline/);
    assert.match(unknown.stderr, /unit\/full/);
  } finally {
    removeRepo(tmp);
  }
  const noPolicy = tempCountsRepo({ config: countsConfig({ docs: undefined }) });
  try {
    const result = runCounts(noPolicy, ['render']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /docs\.counts is not configured/);
  } finally {
    removeRepo(noPolicy);
  }
});

test('CLI render --check detects stale docs/markers and render fixes them deterministically', () => {
  const tmp = tempCountsRepo();
  try {
    fs.writeFileSync(
      path.join(tmp, 'docs/REFERENCE.md'),
      '# REFERENCE\n\nUnit: <!-- counts:unit/full -->stale<!-- /counts:unit/full -->\n',
    );
    const stale = runCounts(tmp, ['render', '--check']);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /STALE/);
    assert.match(stale.stderr, /npm run docs:counts:update/);

    const render = runCounts(tmp, ['render']);
    assert.equal(render.status, 0, render.stderr);
    const fresh = runCounts(tmp, ['render', '--check']);
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.match(fresh.stdout, /COUNTS_DOCS_OK/);
  } finally {
    removeRepo(tmp);
  }
});

test('CLI record --dry-run makes no changes', () => {
  const tmp = tempCountsRepo({ baseline: null, generated: null, results: { 'results/unit.tap': TRACKER_TAP } });
  try {
    const result = runCounts(tmp, [
      'record',
      '--suite',
      'unit',
      '--mode',
      'full',
      '--results',
      'results/unit.tap',
      '--dry-run',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /record \(dry-run\)/);
    assert.equal(fs.existsSync(path.join(tmp, 'docs/test-counts.baseline.json')), false);
  } finally {
    removeRepo(tmp);
  }
});

test('CLI record refuses to record skips when titles are unavailable', () => {
  const tmp = tempCountsRepo({
    baseline: null,
    generated: null,
    results: { 'results/summary.txt': TRACKER_SUMMARY_SKIPS },
  });
  try {
    const result = runCounts(tmp, ['record', '--suite', 'unit', '--mode', 'full', '--results', 'results/summary.txt']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /skipped test titles are unavailable/);
    assert.match(result.stderr, /--test-reporter=tap/);
  } finally {
    removeRepo(tmp);
  }
});

test('baseline schema version constant is exported and used by the examples', () => {
  assert.equal(BASELINE_SCHEMA_VERSION, 1);
});
