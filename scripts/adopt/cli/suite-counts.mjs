#!/usr/bin/env node
/**
 * Verified PASS/FAIL/SKIP counts contract ("aware and agree").
 *
 * Suites emit machine-readable results; this module parses them, compares the real counts and
 * skip identities against the committed baseline, and records agreed counts back into the baseline
 * and generated docs. Unknown/malformed runner output fails loudly instead of passing silently.
 *
 * Pure functions + a small offline CLI (`check`, `record`, `render`). No test execution here:
 * adopters' suite jobs produce the results; CI runs the check/guard.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, UsageError } from '../lib/cli.mjs';

export const BASELINE_SCHEMA_VERSION = 1;
export const METRICS = ['collected', 'passed', 'failed', 'skipped', 'flaky'];
export const MODE_ORDER = ['remote-visible', 'local-hidden', 'offline', 'full'];
export const SUITE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MARKER_PATTERN = /<!--\s*counts:([A-Za-z0-9._/-]+)\s*-->([\s\S]*?)<!--\s*\/counts:\1\s*-->/g;

function zeroCounts() {
  return { collected: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };
}

function asCount(value, label) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`malformed runner output: ${label} must be a non-negative integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function assertCountsConsistent(counts) {
  const sum = METRICS.filter((metric) => metric !== 'collected' && metric !== 'flaky')
    .map((metric) => counts[metric])
    .reduce((total, value) => total + value, 0);
  if (counts.collected !== sum + counts.flaky) {
    throw new Error(
      `malformed runner output: collected=${counts.collected} does not equal passed+failed+skipped+flaky=${sum + counts.flaky}`,
    );
  }
}

function sortedUnique(values) {
  return [
    ...new Set(values.filter((value) => value && String(value).trim()).map((value) => String(value).trim())),
  ].sort();
}

// ---------------------------------------------------------------------------
// Parsers: Playwright JSON, node-test summary/TAP, verify --json statuses
// ---------------------------------------------------------------------------

function walkPlaywrightSuite(suite, trail, titles) {
  if (!suite || typeof suite !== 'object') return;
  const nextTrail = [...trail, suite.title || suite.file || ''].filter(Boolean);
  for (const spec of suite.specs || []) {
    const specTrail = [...nextTrail, spec.title || ''].filter(Boolean);
    const skipped = (spec.tests || []).some((test) => test?.status === 'skipped');
    if (skipped) titles.push(specTrail.join(' › '));
  }
  for (const child of suite.suites || []) walkPlaywrightSuite(child, nextTrail, titles);
}

/**
 * Parse Playwright JSON reporter output (`stats` + skipped test titles from the suite tree).
 * Interrupted runs and missing stats fail loudly.
 */
export function parsePlaywrightJson(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (err) {
      throw new Error(`malformed Playwright JSON: ${err.message}`, { cause: err });
    }
  }
  const stats = data?.stats;
  if (!stats || typeof stats !== 'object') throw new Error('malformed Playwright JSON: missing stats object');
  const counts = {
    collected: 0,
    passed: asCount(stats.expected ?? 0, 'stats.expected'),
    failed: asCount(stats.unexpected ?? 0, 'stats.unexpected'),
    skipped: asCount(stats.skipped ?? 0, 'stats.skipped'),
    flaky: asCount(stats.flaky ?? 0, 'stats.flaky'),
  };
  const interrupted = stats.interrupted ?? 0;
  if (interrupted > 0) throw new Error('malformed Playwright JSON: run was interrupted; count results are not valid');
  counts.collected = counts.passed + counts.failed + counts.skipped + counts.flaky;
  assertCountsConsistent(counts);
  const titles = [];
  for (const suite of data.suites || []) walkPlaywrightSuite(suite, [], titles);
  const skippedTests = sortedUnique(titles);
  if (counts.skipped !== skippedTests.length) {
    throw new Error(
      `malformed Playwright JSON: stats.skipped=${counts.skipped} but ${skippedTests.length} skipped test title(s) were found`,
    );
  }
  return { runner: 'playwright', counts, skippedTests };
}

function summaryValue(text, name) {
  const patterns = [new RegExp(`^#\\s*${name}\\s+(\\d+)\\s*$`, 'm'), new RegExp(`^ℹ\\s*${name}\\s+(\\d+)\\s*$`, 'm')];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * Parse node:test output (TAP summary or the human/spec summary). `skipped` + `todo` map to the
 * contract `skipped` field; `cancelled` maps to `failed` so an aborted run can never silently pass.
 * Skip/todo titles are extracted from TAP directives (or spec lines) when available.
 */
export function parseNodeTest(text) {
  const raw = String(inputText(text));
  const tests = summaryValue(raw, 'tests');
  const passed = summaryValue(raw, 'pass');
  const failed = summaryValue(raw, 'fail');
  if (tests === null || passed === null || failed === null) {
    throw new Error('unrecognized node-test output: expected summary counts (# tests / ℹ tests and pass/fail)');
  }
  const skipped = summaryValue(raw, 'skipped') ?? 0;
  const todo = summaryValue(raw, 'todo') ?? 0;
  const cancelled = summaryValue(raw, 'cancelled') ?? 0;
  const counts = {
    collected: tests,
    passed,
    failed: failed + cancelled,
    skipped: skipped + todo,
    flaky: 0,
  };
  try {
    assertCountsConsistent(counts);
  } catch (err) {
    throw new Error(`malformed node-test output: ${err.message}`, { cause: err });
  }
  const titles = [];
  for (const line of raw.split(/\r?\n/)) {
    const tap = /^(?:not\s+)?ok\s+\d+\s+-\s+(.+?)\s+#\s*(?:SKIP|TODO)\b/i.exec(line);
    if (tap) titles.push(tap[1]);
    const spec = /^\s*[﹣✔]\s+(.+?)\s+(?:\([^)]*\)\s*)?#\s*(?:SKIP|TODO)\b/i.exec(line);
    if (spec) titles.push(spec[1]);
  }
  const uniqueTitles = sortedUnique(titles);
  const skippedTests = uniqueTitles.length === counts.skipped ? uniqueTitles : null;
  return { runner: 'node-test', counts, skippedTests };
}

function inputText(input) {
  if (typeof input === 'string') return input;
  if (input === undefined || input === null) throw new Error('malformed runner output: expected text');
  return String(input);
}

function verifyItems(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['checks', 'results', 'suites', 'items']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  throw new Error(
    'malformed verify JSON: expected an array of checks/results/suites/items (or a bare array) with { name, status }',
  );
}

function normalizeVerifyStatus(item) {
  const raw = item?.status ?? item?.result ?? item?.state ?? item?.outcome;
  const status = String(raw || '')
    .trim()
    .toUpperCase();
  if (['PASS', 'PASSED', 'OK', 'SUCCESS'].includes(status)) return 'passed';
  if (['FAIL', 'FAILED', 'ERROR', 'WARN', 'WARNING'].includes(status)) return 'failed';
  if (['SKIP', 'SKIPPED', 'DEFERRED', 'DEFERRED_REMOTE', 'TODO'].includes(status)) return 'skipped';
  throw new Error(
    `malformed verify JSON: check ${JSON.stringify(item?.name ?? item?.id ?? '?')} has unsupported status ${JSON.stringify(raw)}`,
  );
}

/** Parse a downstream `verify --json` status list (`checks`/`results`/`suites`/`items`). */
export function parseVerifyJson(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (err) {
      throw new Error(`malformed verify JSON: ${err.message}`, { cause: err });
    }
  }
  const items = verifyItems(data);
  const counts = zeroCounts();
  const skippedTests = [];
  for (const item of items) {
    const bucket = normalizeVerifyStatus(item);
    counts[bucket] += 1;
    counts.collected += 1;
    if (bucket === 'skipped') skippedTests.push(item?.name ?? item?.id ?? item?.title ?? '');
  }
  assertCountsConsistent(counts);
  return { runner: 'verify-json', counts, skippedTests: sortedUnique(skippedTests) };
}

/**
 * Parse any supported results payload. `runner: 'auto'` detects JSON (Playwright vs verify) or
 * falls back to node-test text; explicit runners are strict.
 */
export function parseResults(input, { runner = 'auto' } = {}) {
  if (!['auto', 'playwright', 'node-test', 'verify'].includes(runner)) {
    throw new Error(`unknown runner ${JSON.stringify(runner)}; expected auto, playwright, node-test, or verify`);
  }
  const text = inputText(input).trim();
  if (runner === 'playwright') return parsePlaywrightJson(text);
  if (runner === 'node-test') return parseNodeTest(text);
  if (runner === 'verify') return parseVerifyJson(text);
  if (!text) throw new Error('malformed runner output: results are empty');
  if (text.startsWith('{') || text.startsWith('[')) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error(`malformed runner output: invalid JSON (${err.message})`, { cause: err });
    }
    if (data && typeof data === 'object' && 'stats' in data) return parsePlaywrightJson(data);
    try {
      return parseVerifyJson(data);
    } catch (err) {
      throw new Error(`unrecognized JSON results: expected Playwright stats or verify checks[] (${err.message})`, {
        cause: err,
      });
    }
  }
  return parseNodeTest(text);
}

// ---------------------------------------------------------------------------
// Comparison: counts drift, flaky gate, skip identity
// ---------------------------------------------------------------------------

/**
 * Compare parsed runner results against a committed baseline entry.
 * Returns exact drift messages for counts and skip-title identity; flaky > 0 always fails.
 */
export function compareResults(actual, expected) {
  if (!actual?.counts) throw new Error('compareResults: actual results with counts are required');
  if (!expected) throw new Error('compareResults: baseline entry is required');
  const drift = [];
  for (const metric of METRICS) {
    const expectedValue = expected[metric];
    const actualValue = actual.counts[metric];
    if (expectedValue !== actualValue) drift.push({ metric, expected: expectedValue, actual: actualValue });
  }
  const flakyFail = (actual.counts.flaky ?? 0) > 0;
  const expectedSkips = (expected.knownSkips || []).map((skip) => skip.test).sort();
  const actualSkips = Array.isArray(actual.skippedTests) ? [...actual.skippedTests].sort() : null;
  const added = actualSkips ? actualSkips.filter((title) => !expectedSkips.includes(title)) : [];
  const removed = actualSkips ? expectedSkips.filter((title) => !actualSkips.includes(title)) : [];
  const unavailable = actualSkips === null && ((actual.counts.skipped ?? 0) > 0 || expectedSkips.length > 0);
  const possibleRename = added.length > 0 && added.length === removed.length;
  const messages = [];
  for (const entry of drift)
    messages.push(`count drift: ${entry.metric} expected ${entry.expected} got ${entry.actual}`);
  if (flakyFail)
    messages.push(`flaky tests reported (flaky=${actual.counts.flaky}); fix flakiness before recording counts`);
  for (const title of added) messages.push(`skipped test added without agreement: ${JSON.stringify(title)}`);
  for (const title of removed) messages.push(`agreed skipped test missing from results: ${JSON.stringify(title)}`);
  if (possibleRename) messages.push('skipped test identity changed with the same count (possible rename)');
  if (unavailable) {
    messages.push(
      'runner output does not expose skipped test titles; re-run with a title-bearing reporter (node: --test-reporter=tap) to verify skip agreement',
    );
  }
  return {
    ok: drift.length === 0 && !flakyFail && added.length === 0 && removed.length === 0 && !unavailable,
    drift,
    flakyFail,
    counts: { expected: { ...expected }, actual: { ...actual.counts } },
    skips: { expected: expectedSkips, actual: actualSkips || [], added, removed, unavailable, possibleRename },
    messages,
  };
}

/** Actionable drift report text (CLI output); includes update/inventory command guidance. */
export function formatDriftReport(comparison, { suite, mode, updateCommand, inventoryCommand } = {}) {
  const lines = [`COUNTS_DRIFT suite=${suite} mode=${mode}`];
  for (const message of comparison.messages) lines.push(`- ${message}`);
  const update = updateCommand || 'npm run docs:counts:update';
  const inventory = inventoryCommand || 'npm test';
  lines.push(
    `Fix: re-run the inventory (\`${inventory}\`), then run \`${update}\` to record the new counts; complete knownSkips agreement (reason/coveredBy/agreedOn) and reviewed evidence in the baseline.`,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Baseline schema validation
// ---------------------------------------------------------------------------

function validateDate(value, path, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push({ path, message: 'is required (YYYY-MM-DD)' });
    return;
  }
  if (!DATE_PATTERN.test(value.trim()))
    errors.push({ path, message: `must be a YYYY-MM-DD date (got ${JSON.stringify(value)})` });
}

function checkKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push({ path: `${path}.${key}`, message: 'is not a supported key' });
  }
}

const MODE_KEYS = ['mode', ...METRICS, 'knownSkips', 'reviewed'];
const SUITE_KEYS = ['id', 'modes'];
const BASELINE_KEYS = ['$schema', 'schemaVersion', 'suites'];
const SKIP_KEYS = ['test', 'reason', 'coveredBy', 'agreedOn'];
const REVIEWED_KEYS = ['on', 'by', 'evidence'];

/** Validate the committed baseline: schema shape, counts invariant, and agreement metadata. */
export function validateBaseline(baseline) {
  const errors = [];
  const ok = (path, message) => errors.push({ path, message });
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    return { ok: false, errors: [{ path: '$', message: 'must be an object' }] };
  }
  checkKeys(baseline, BASELINE_KEYS, '$', errors);
  if (baseline.$schema !== undefined && typeof baseline.$schema !== 'string') {
    ok('$.$schema', 'must be a path/URL string when present');
  }
  if (baseline.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    ok('$.schemaVersion', `must equal ${BASELINE_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(baseline.suites) || baseline.suites.length === 0) {
    ok('$.suites', 'must be a non-empty array of suites');
    return { ok: errors.length === 0, errors };
  }
  const seenSuites = new Set();
  baseline.suites.forEach((suite, suiteIndex) => {
    const sp = `$.suites[${suiteIndex}]`;
    if (!suite || typeof suite !== 'object' || Array.isArray(suite)) {
      ok(sp, 'must be an object');
      return;
    }
    checkKeys(suite, SUITE_KEYS, sp, errors);
    if (typeof suite.id !== 'string' || !SUITE_ID_PATTERN.test(suite.id)) {
      ok(`${sp}.id`, 'must be a lowercase suite id (letters, digits, hyphens)');
    } else if (seenSuites.has(suite.id)) {
      ok(`${sp}.id`, `duplicate suite id ${JSON.stringify(suite.id)}`);
    } else {
      seenSuites.add(suite.id);
    }
    if (!Array.isArray(suite.modes) || suite.modes.length === 0) {
      ok(`${sp}.modes`, 'must be a non-empty array of modes');
      return;
    }
    const seenModes = new Set();
    suite.modes.forEach((entry, modeIndex) => {
      const mp = `${sp}.modes[${modeIndex}]`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        ok(mp, 'must be an object');
        return;
      }
      const label = `${suite.id}/${entry.mode ?? '?'}`;
      checkKeys(entry, MODE_KEYS, mp, errors);
      if (typeof entry.mode !== 'string' || !SUITE_ID_PATTERN.test(entry.mode)) {
        ok(`${mp}.mode`, 'must be a lowercase mode name (letters, digits, hyphens)');
      } else if (seenModes.has(entry.mode)) {
        ok(`${mp}.mode`, `duplicate mode ${JSON.stringify(entry.mode)}`);
      } else {
        seenModes.add(entry.mode);
      }
      for (const metric of METRICS) {
        const value = entry[metric];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
          ok(`${mp}.${metric}`, 'must be a non-negative integer');
        }
      }
      const countsValid = METRICS.every((metric) => Number.isInteger(entry[metric]) && entry[metric] >= 0);
      if (countsValid) {
        const sum = entry.passed + entry.failed + entry.skipped + entry.flaky;
        if (entry.collected !== sum) ok(`${mp}.collected`, `must equal passed+failed+skipped+flaky (=${sum})`);
        if (entry.flaky > 0) ok(`${mp}.flaky`, 'must be 0; fix flakiness instead of recording it');
      }
      const knownSkips = entry.knownSkips;
      if (!Array.isArray(knownSkips)) {
        ok(`${mp}.knownSkips`, 'must be an array (use [] when there are no skipped tests)');
      } else {
        const seenTests = new Set();
        knownSkips.forEach((skip, skipIndex) => {
          const kp = `${mp}.knownSkips[${skipIndex}]`;
          if (!skip || typeof skip !== 'object' || Array.isArray(skip)) {
            ok(kp, 'must be an object');
            return;
          }
          checkKeys(skip, SKIP_KEYS, kp, errors);
          for (const key of ['test', 'reason', 'coveredBy', 'agreedOn']) {
            if (typeof skip[key] !== 'string' || !skip[key].trim())
              ok(`${kp}.${key}`, 'is required and must be non-empty');
          }
          if (typeof skip.test === 'string' && skip.test.trim()) {
            if (seenTests.has(skip.test.trim()))
              ok(`${kp}.test`, `duplicate skipped test ${JSON.stringify(skip.test)}`);
            seenTests.add(skip.test.trim());
          }
          validateDate(skip.agreedOn, `${kp}.agreedOn`, errors);
        });
        if (countsValid && knownSkips.length !== entry.skipped) {
          ok(
            `${mp}.knownSkips`,
            `must name every skipped test: skipped=${entry.skipped} but knownSkips=${knownSkips.length} (${label})`,
          );
        }
      }
      const reviewed = entry.reviewed;
      const rp = `${mp}.reviewed`;
      if (!reviewed || typeof reviewed !== 'object' || Array.isArray(reviewed)) {
        ok(rp, 'is required (on/by/evidence agreement)');
      } else {
        checkKeys(reviewed, REVIEWED_KEYS, rp, errors);
        validateDate(reviewed.on, `${rp}.on`, errors);
        if (typeof reviewed.by !== 'string' || !reviewed.by.trim()) ok(`${rp}.by`, 'is required and must be non-empty');
        if (!Array.isArray(reviewed.evidence) || reviewed.evidence.length === 0) {
          ok(`${rp}.evidence`, 'must be a non-empty array of evidence links/commands');
        } else {
          reviewed.evidence.forEach((item, index) => {
            if (typeof item !== 'string' || !item.trim()) ok(`${rp}.evidence[${index}]`, 'must be a non-empty string');
          });
        }
      }
    });
  });
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Baseline lookup + deterministic rendering (generated doc + inline markers)
// ---------------------------------------------------------------------------

export function sortBaseline(baseline) {
  const modeRank = (mode) => {
    const index = MODE_ORDER.indexOf(mode);
    return index === -1 ? MODE_ORDER.length : index;
  };
  const copy = {
    schemaVersion: baseline.schemaVersion,
    suites: (baseline.suites || [])
      .map((suite) => ({
        ...suite,
        modes: [...(suite.modes || [])]
          .map((entry) => ({
            ...entry,
            knownSkips: [...(entry.knownSkips || [])].sort((a, b) => a.test.localeCompare(b.test)),
          }))
          .sort((a, b) => modeRank(a.mode) - modeRank(b.mode) || a.mode.localeCompare(b.mode)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return copy;
}

export function baselineModeKeys(baseline) {
  return (baseline?.suites || []).flatMap((suite) => (suite.modes || []).map((entry) => `${suite.id}/${entry.mode}`));
}

export function findBaselineMode(baseline, suiteId, mode) {
  const suite = (baseline?.suites || []).find((entry) => entry.id === suiteId);
  return (suite?.modes || []).find((entry) => entry.mode === mode) || null;
}

export function markerValue(key, baseline) {
  const parts = String(key || '').split('/');
  if (parts.length < 2 || parts.length > 3) return null;
  const entry = findBaselineMode(baseline, parts[0], parts[1]);
  if (!entry) return null;
  if (parts.length === 2) {
    return `${entry.collected} collected · ${entry.passed} passed · ${entry.failed} failed · ${entry.skipped} skipped · ${entry.flaky} flaky`;
  }
  const metric = parts[2];
  return METRICS.includes(metric) ? String(entry[metric]) : null;
}

/** Expected canonical `docs/TEST_COUNTS.md` content from the baseline (deterministic). */
export function renderGeneratedDoc(baseline, { baselinePath = 'docs/test-counts.baseline.json' } = {}) {
  const sorted = sortBaseline(baseline);
  const modeCount = sorted.suites.reduce((total, suite) => total + suite.modes.length, 0);
  const lines = [
    '# Test counts',
    '',
    `> Generated by \`node scripts/adopt/cli/suite-counts.mjs render\` from \`${baselinePath}\`. Do not edit by hand.`,
    '> "Aware and agree": counts change ⇒ baseline + generated doc + markers change in the same PR; every non-zero skip is named and agreed, and every mode carries a review record.',
    '',
    `**Schema version:** ${sorted.schemaVersion} · **Suites:** ${sorted.suites.length} · **Modes:** ${modeCount}`,
    '',
  ];
  for (const suite of sorted.suites) {
    lines.push(`## ${suite.id}`, '');
    lines.push('| Mode | Collected | Passed | Failed | Skipped | Flaky | Reviewed |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const entry of suite.modes) {
      const reviewed = entry.reviewed || {};
      const review = [reviewed.on || 'pending', reviewed.by || 'pending'].join(' · ');
      lines.push(
        `| ${entry.mode} | ${entry.collected} | ${entry.passed} | ${entry.failed} | ${entry.skipped} | ${entry.flaky} | ${review} |`,
      );
    }
    lines.push('');
    for (const entry of suite.modes) {
      lines.push(`### Known skips — ${suite.id} / ${entry.mode}`, '');
      const skips = entry.knownSkips || [];
      if (!skips.length) {
        lines.push('_None._', '');
        continue;
      }
      lines.push('| Test | Reason | Covered by | Agreed on |');
      lines.push('|---|---|---|---|');
      for (const skip of skips) {
        lines.push(`| ${skip.test} | ${skip.reason} | ${skip.coveredBy} | ${skip.agreedOn} |`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/**
 * Replace every `<!-- counts:<key> -->…<!-- /counts:<key> -->` marker with the baseline value.
 * Returns `{ text, errors, replacements }`; unknown keys and unclosed markers are errors.
 */
export function applyMarkers(text, baseline, { label = 'markers' } = {}) {
  const errors = [];
  let replacements = 0;
  const source = String(text ?? '');
  const updated = source.replace(MARKER_PATTERN, (full, key) => {
    const value = markerValue(key, baseline);
    if (value === null) {
      errors.push({ path: label, message: `unknown marker key counts:${key}` });
      return full;
    }
    replacements += 1;
    return `<!-- counts:${key} -->${value}<!-- /counts:${key} -->`;
  });
  const expectedMarkers = updated.match(MARKER_PATTERN) || [];
  const totalOpen = (updated.match(/<!--\s*counts:/g) || []).length;
  if (totalOpen !== expectedMarkers.length) {
    errors.push({
      path: label,
      message: 'unclosed or malformed counts marker (expected <!-- counts:<key> -->…<!-- /counts:<key> -->)',
    });
  }
  return { text: updated, errors, replacements };
}

/** Check marker freshness without mutating the text. */
export function checkMarkers(text, baseline, { label = 'markers' } = {}) {
  const applied = applyMarkers(text, baseline, { label });
  const errors = [...applied.errors];
  const source = String(text ?? '');
  let matched = 0;
  for (const match of source.matchAll(MARKER_PATTERN)) {
    matched += 1;
    const key = match[1];
    const value = markerValue(key, baseline);
    if (value === null) continue;
    if (match[2].trim() !== value) {
      errors.push({ path: label, message: `stale marker counts:${key} (expected ${JSON.stringify(value)})` });
    }
  }
  const totalOpen = (source.match(/<!--\s*counts:/g) || []).length;
  if (totalOpen !== matched) {
    errors.push({
      path: label,
      message: 'unclosed or malformed counts marker (expected <!-- counts:<key> -->…<!-- /counts:<key> -->)',
    });
  }
  return { ok: errors.length === 0, errors: dedupeErrors(errors) };
}

function dedupeErrors(errors) {
  const seen = new Set();
  return errors.filter((error) => {
    const key = `${error.path}:${error.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Config resolution (`docs.counts`; absent = no-op)
// ---------------------------------------------------------------------------

/** Resolve and validate `config.docs.counts`; absent means the counts contract is disabled. */
export function resolveCountsConfig(config = {}) {
  const counts = config?.docs?.counts;
  if (counts === undefined) return { present: false, errors: [] };
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
    return { present: false, errors: [{ path: 'docs.counts', message: 'must be an object' }] };
  }
  const errors = [];
  const requiredString = (key) => {
    if (typeof counts[key] !== 'string' || !counts[key].trim()) {
      errors.push({ path: `docs.counts.${key}`, message: 'is required and must be a non-empty path' });
    }
  };
  requiredString('baseline');
  requiredString('generated');
  const markers = counts.markers ?? [];
  if (!Array.isArray(markers) || markers.some((marker) => typeof marker !== 'string' || !marker.trim())) {
    errors.push({ path: 'docs.counts.markers', message: 'must be an array of non-empty paths' });
  }
  for (const key of ['inventoryCommand', 'updateCommand']) {
    if (counts[key] !== undefined && (typeof counts[key] !== 'string' || !counts[key].trim())) {
      errors.push({ path: `docs.counts.${key}`, message: 'must be a non-empty command string' });
    }
  }
  for (const key of Object.keys(counts)) {
    if (!['baseline', 'generated', 'markers', 'inventoryCommand', 'updateCommand'].includes(key)) {
      errors.push({ path: `docs.counts.${key}`, message: 'is not a supported key' });
    }
  }
  if (errors.length) return { present: true, errors };
  return {
    present: true,
    errors: [],
    baseline: counts.baseline.trim(),
    generated: counts.generated.trim(),
    markers: markers.map((marker) => marker.trim()),
    inventoryCommand: (counts.inventoryCommand || 'npm test').trim(),
    updateCommand: (counts.updateCommand || 'npm run docs:counts:update').trim(),
  };
}

// ---------------------------------------------------------------------------
// CLI: check | record | render
// ---------------------------------------------------------------------------

function readJsonFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new UsageError(`cannot read ${file}: ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`cannot parse ${file}: ${err.message}`);
  }
}

function loadConfig({ root, config: configArg }) {
  const resolvedRoot = path.resolve(root || '.');
  const configPath = path.resolve(configArg || path.join(resolvedRoot, 'tracker.config.json'));
  if (!fs.existsSync(configPath)) throw new UsageError(`config not found: ${configPath}`);
  return { root: resolvedRoot, configPath, config: readJsonFile(configPath) };
}

function requireCountsConfig(config) {
  const resolved = resolveCountsConfig(config);
  if (resolved.errors.length)
    throw new UsageError(
      `invalid docs.counts config:\n- ${resolved.errors.map((error) => `${error.path}: ${error.message}`).join('\n- ')}`,
    );
  if (!resolved.present) {
    throw new UsageError(
      'docs.counts is not configured in tracker.config.json; add the optional block to enable the counts contract (absent = no-op)',
    );
  }
  return resolved;
}

function loadBaselineFile(root, counts, { allowMissing = false } = {}) {
  const file = path.join(root, counts.baseline);
  if (!fs.existsSync(file)) {
    if (allowMissing) return { file, baseline: { schemaVersion: BASELINE_SCHEMA_VERSION, suites: [] } };
    throw new UsageError(
      `baseline not found: ${counts.baseline} (run \`${counts.updateCommand}\` after the inventory)`,
    );
  }
  const baseline = readJsonFile(file);
  if (allowMissing) return { file, baseline };
  const validation = validateBaseline(baseline);
  if (!validation.ok) {
    throw new UsageError(
      `baseline is invalid (${counts.baseline}):\n- ${validation.errors.map((error) => `${error.path}: ${error.message}`).join('\n- ')}`,
    );
  }
  return { file, baseline };
}

function writeJsonFile(root, rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(sortBaseline(value), null, 2)}\n`);
  return file;
}

function readResultsFile(results) {
  if (results === '-') return fs.readFileSync(0, 'utf8');
  const file = path.resolve(results);
  if (!fs.existsSync(file)) throw new UsageError(`results file not found: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function renderDocsFiles({ root, counts, baseline, write = false }) {
  const changed = [];
  const errors = [];
  const generatedFile = path.join(root, counts.generated);
  const expectedDoc = renderGeneratedDoc(baseline, { baselinePath: counts.baseline });
  let currentDoc = null;
  if (fs.existsSync(generatedFile)) currentDoc = fs.readFileSync(generatedFile, 'utf8');
  if (currentDoc !== expectedDoc) {
    changed.push(counts.generated);
    if (write) {
      fs.mkdirSync(path.dirname(generatedFile), { recursive: true });
      fs.writeFileSync(generatedFile, expectedDoc);
    }
  }
  for (const rel of counts.markers) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
      errors.push({
        path: rel,
        message:
          'marker file not found; create it with <!-- counts:<suite>/<mode> --> markers or remove it from docs.counts.markers',
      });
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    const applied = applyMarkers(source, baseline, { label: rel });
    if (applied.errors.length) {
      errors.push(...applied.errors);
      continue;
    }
    if (applied.text !== source) {
      changed.push(rel);
      if (write) fs.writeFileSync(file, applied.text);
    }
  }
  return { ok: errors.length === 0, changed, errors, expectedDoc };
}

/** Run the counts CLI against an argv array (exported for tests); returns an exit code. */
export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, {
    flags: ['json', 'help', 'check', 'dry-run'],
    options: ['root', 'config', 'suite', 'mode', 'results', 'runner', 'baseline'],
  });
  if (args.help || args._.length === 0) {
    console.log(usage());
    return 0;
  }
  const command = args._[0];
  if (!['check', 'record', 'render'].includes(command)) throw new UsageError(`unknown command: ${command}`);
  const { root, config } = loadConfig({ root: args.root, config: args.config });
  const counts = requireCountsConfig(config);
  if (command === 'render') {
    const { baseline } = loadBaselineFile(root, counts);
    const result = renderDocsFiles({ root, counts, baseline, write: !args.check });
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: result.ok && (args.check ? result.changed.length === 0 : true), command, changed: result.changed, errors: result.errors }, null, 2)}\n`,
      );
    }
    if (result.errors.length) {
      console.error(`counts docs FAILED (${result.errors.length}):`);
      for (const error of result.errors) console.error(`- ${error.path}: ${error.message}`);
      return 1;
    }
    if (args.check) {
      if (result.changed.length) {
        console.error(`counts docs STALE (${result.changed.length}): ${result.changed.join(', ')}`);
        console.error(
          `Fix: run \`${counts.updateCommand}\` (or \`node scripts/adopt/cli/suite-counts.mjs render\`) and commit the result.`,
        );
        return 1;
      }
      console.log('COUNTS_DOCS_OK generated doc and markers are current.');
      return 0;
    }
    if (args.json) return 0;
    console.log(result.changed.length ? `rendered: ${result.changed.join(', ')}` : 'COUNTS_DOCS_OK (no changes)');
    return 0;
  }
  const suite = args.suite;
  const mode = args.mode;
  if (!suite || !mode) throw new UsageError(`--suite and --mode are required for ${command}`);
  if (!args.results) throw new UsageError(`--results is required for ${command} (file path or - for stdin)`);
  if (command === 'check') {
    const { baseline } = loadBaselineFile(root, counts);
    const entry = findBaselineMode(baseline, suite, mode);
    if (!entry) {
      throw new UsageError(
        `suite/mode ${suite}/${mode} is not in the baseline; known entries: ${baselineModeKeys(baseline).join(', ')} (run \`${counts.updateCommand}\` to record it)`,
      );
    }
    const actual = parseResults(readResultsFile(args.results), { runner: args.runner || 'auto' });
    const comparison = compareResults(actual, entry);
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ok: comparison.ok, command, suite, mode, ...comparison }, null, 2)}\n`);
    }
    if (!comparison.ok) {
      console.error(
        formatDriftReport(comparison, {
          suite,
          mode,
          updateCommand: counts.updateCommand,
          inventoryCommand: counts.inventoryCommand,
        }),
      );
      return 1;
    }
    if (!args.json) {
      console.log(
        `COUNTS_OK suite=${suite} mode=${mode} collected=${actual.counts.collected} passed=${actual.counts.passed} failed=${actual.counts.failed} skipped=${actual.counts.skipped} flaky=${actual.counts.flaky}`,
      );
    }
    return 0;
  }
  // record
  const actual = parseResults(readResultsFile(args.results), { runner: args.runner || 'auto' });
  if (actual.counts.skipped > 0 && actual.skippedTests === null) {
    throw new UsageError(
      'cannot record counts: skipped test titles are unavailable in this output; re-run with a title-bearing reporter (node: --test-reporter=tap) so skip agreement can be recorded',
    );
  }
  const { baseline } = loadBaselineFile(root, counts, { allowMissing: true });
  let suiteEntry = (baseline.suites || []).find((entry) => entry.id === suite);
  if (!suiteEntry) {
    suiteEntry = { id: suite, modes: [] };
    baseline.suites = [...(baseline.suites || []), suiteEntry];
  }
  let modeEntry = suiteEntry.modes.find((entry) => entry.mode === mode);
  const isNewMode = !modeEntry;
  if (!modeEntry) {
    modeEntry = { mode, ...actual.counts, knownSkips: [], reviewed: { on: '', by: '', evidence: [] } };
    suiteEntry.modes = [...suiteEntry.modes, modeEntry];
  } else {
    modeEntry = { ...modeEntry, ...actual.counts };
    suiteEntry.modes = suiteEntry.modes.map((entry) => (entry.mode === mode ? modeEntry : entry));
  }
  const previousSkips = modeEntry.knownSkips || [];
  const actualTitles = actual.skippedTests || [];
  const preserved = previousSkips.filter((skip) => actualTitles.includes(skip.test));
  const added = actualTitles
    .filter((title) => !previousSkips.some((skip) => skip.test === title))
    .map((test) => ({ test, reason: '', coveredBy: '', agreedOn: '' }));
  modeEntry.knownSkips = [...preserved, ...added];
  const removed = previousSkips.filter((skip) => !actualTitles.includes(skip.test)).map((skip) => skip.test);
  baseline.suites = (baseline.suites || []).map((entry) =>
    entry.id === suite
      ? { ...entry, modes: entry.modes.map((item) => (item.mode === mode ? modeEntry : item)) }
      : entry,
  );
  if (args['dry-run']) {
    console.log(
      `record (dry-run): suite=${suite} mode=${mode} collected=${actual.counts.collected} passed=${actual.counts.passed} failed=${actual.counts.failed} skipped=${actual.counts.skipped} flaky=${actual.counts.flaky}`,
    );
    return 0;
  }
  writeJsonFile(root, counts.baseline, baseline);
  const docs = renderDocsFiles({ root, counts, baseline, write: true });
  const result = {
    ok: docs.errors.length === 0,
    command,
    suite,
    mode,
    counts: actual.counts,
    baseline: counts.baseline,
    addedSkips: added.map((skip) => skip.test),
    removedSkips: removed,
    isNewMode,
    written: [counts.baseline, ...docs.changed],
    errors: docs.errors,
  };
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    console.log(
      `recorded suite=${suite} mode=${mode} collected=${actual.counts.collected} passed=${actual.counts.passed} failed=${actual.counts.failed} skipped=${actual.counts.skipped} flaky=${actual.counts.flaky}`,
    );
    if (added.length)
      console.log(
        `new skipped tests (complete reason/coveredBy/agreedOn agreement): ${added.map((skip) => skip.test).join(', ')}`,
      );
    if (removed.length) console.log(`removed skipped tests: ${removed.join(', ')}`);
    if (isNewMode) console.log(`new mode recorded: complete reviewed {on,by,evidence} in ${counts.baseline}`);
    console.log(`updated: ${[counts.baseline, ...docs.changed].join(', ')}`);
  }
  if (docs.errors.length) {
    console.error(`counts docs FAILED (${docs.errors.length}):`);
    for (const error of docs.errors) console.error(`- ${error.path}: ${error.message}`);
    return 1;
  }
  // Report agreement gaps as warnings; the guard fails until they are completed.
  const validation = validateBaseline(baseline);
  if (!validation.ok) {
    console.error(
      `warning: baseline agreement is incomplete (${validation.errors.length}); the counts guard will fail until resolved:`,
    );
    for (const error of validation.errors) console.error(`- ${error.path}: ${error.message}`);
  }
  return 0;
}

function usage() {
  return [
    'Usage: node scripts/adopt/cli/suite-counts.mjs <check|record|render> [options]',
    '',
    'check   --suite ID --mode MODE --results FILE [--runner auto|playwright|node-test|verify] [--json]',
    'record  --suite ID --mode MODE --results FILE [--runner ...] [--dry-run] [--json]',
    'render  [--check] [--json]',
    '',
    'Common: --root DIR --config FILE',
    '',
    'check   compares real runner output against the committed baseline (exit 1 on drift/flaky).',
    'record  records parsed counts + skip identities into the baseline and regenerates docs/markers.',
    'render  regenerates docs/TEST_COUNTS.md and every inline counts marker from the baseline.',
    '        --check fails instead of writing when the generated doc/markers are stale.',
    '',
    'The counts contract comes from tracker.config.json docs.counts; absent means no-op.',
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    try {
      process.exitCode = runCli(process.argv.slice(2));
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
