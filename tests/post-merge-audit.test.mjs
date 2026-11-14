import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateConfig } from '../scripts/adopt/cli/validate-config.mjs';
import {
  DEFAULT_REQUIRED_CHECKS,
  evaluateBypass,
  isCheckRollupPermissionError,
  loadGuardConfig,
  resolveRequiredChecks,
  runPostMergeAudit,
  validateRequiredChecksConfig,
} from '../scripts/adopt/cli/post-merge-audit.mjs';

const REPO_ROOT = process.cwd();
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/post-merge-audit.yml');

const GREEN = [
  { name: 'ci / ci-gate', conclusion: 'SUCCESS' },
  { name: 'docs-guard', conclusion: 'SUCCESS' },
  { name: 'pr-close-guard', conclusion: 'SUCCESS' },
];
const BASE_PULL = {
  number: 42,
  state: 'MERGED',
  statusCheckRollup: GREEN,
  labels: [],
  headRefName: 'task/42-example',
  body: 'Closes #42',
};
const PERMISSION_ERROR =
  'gh pr view 42 failed: GraphQL: Resource not accessible by integration (repository.pullRequest.statusCheckRollup.check_runs)';
const CASTDECK_CHECKS = ['ci / ci-gate', 'tracker-guard / guard', 'pr-close-guard'];

function captureLogger() {
  const lines = [];
  return {
    lines,
    log: (message) => lines.push({ level: 'log', message }),
    warn: (message) => lines.push({ level: 'warn', message }),
    error: (message) => lines.push({ level: 'error', message }),
  };
}

function fakeGithub({ pull = BASE_PULL, fullError = null, metadata = null } = {}) {
  const calls = { full: 0, metadata: 0, labels: [], issues: [], order: [] };
  return {
    calls,
    async getPullRequest() {
      calls.full += 1;
      calls.order.push('full');
      if (fullError) throw fullError;
      return pull;
    },
    async getPullRequestMetadata() {
      calls.metadata += 1;
      calls.order.push('metadata');
      return metadata ?? { ...pull, statusCheckRollup: undefined };
    },
    async createLabel(...args) {
      calls.labels.push(args);
      return {};
    },
    async createIssue(owner, repo, options) {
      calls.issues.push({ owner, repo, options });
      return { number: 9, url: 'https://github.com/owner/repo/issues/9' };
    },
  };
}

function run({ github, config = {}, prNumber = 42, env = {}, logger = captureLogger() } = {}) {
  return runPostMergeAudit({ github, repo: 'owner/repo', prNumber, config, env, logger });
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'post-merge-audit-'));
}

function fullConfig(guard) {
  return {
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
    ...(guard ? { guard } : {}),
  };
}

// ---------------------------------------------------------------------------
// evaluateBypass: closure rules (existing behaviour) + degraded check skipping
// ---------------------------------------------------------------------------

test('clean merged PR has no bypass', () => assert.equal(evaluateBypass({ pull: BASE_PULL }).ok, true));

test('runPostMergeAudit rejects a PR that is not merged (transport-owned merged check)', async () => {
  await assert.rejects(
    () => run({ github: fakeGithub({ pull: { ...BASE_PULL, state: 'OPEN' } }) }),
    /not merged \(state: OPEN\); the post-merge audit only runs on merged pull requests/,
  );
});

test('failed required check is a bypass', () => {
  const pull = {
    ...BASE_PULL,
    statusCheckRollup: [
      { name: 'docs-guard', conclusion: 'FAILURE' },
      ...GREEN.filter((check) => check.name !== 'docs-guard' && check.name !== 'ci / ci-gate'),
    ],
  };
  assert.ok(evaluateBypass({ pull }).violations.some((violation) => violation.code === 'CHECKS_FAILED'));
});

test('task merge without closing keyword is a bypass', () => {
  const pull = { ...BASE_PULL, body: 'Refs #42' };
  assert.ok(evaluateBypass({ pull }).violations.some((violation) => violation.code === 'MISSING_CLOSING_KEYWORD'));
});

test('partial task PR is a bypass even with a closing keyword', () => {
  const pull = { ...BASE_PULL, labels: ['partial'], body: 'Closes #42' };
  assert.ok(evaluateBypass({ pull }).violations.some((violation) => violation.code === 'PARTIAL_TASK_PR'));
});

test('partial task PR without a closing keyword is a bypass', () => {
  const pull = { ...BASE_PULL, labels: ['partial'], body: 'Part of #42' };
  const codes = evaluateBypass({ pull }).violations.map((violation) => violation.code);
  assert.ok(codes.includes('PARTIAL_TASK_PR'));
  assert.ok(codes.includes('MISSING_CLOSING_KEYWORD'));
});

test('degraded evaluation skips checks but still enforces closure rules', () => {
  const withoutRollup = { ...BASE_PULL, statusCheckRollup: undefined };
  const degraded = evaluateBypass({ pull: withoutRollup, degraded: true });
  assert.equal(degraded.ok, true);
  assert.equal(degraded.checksEvaluated, false);
  const notDegraded = evaluateBypass({ pull: withoutRollup });
  assert.ok(notDegraded.violations.some((violation) => violation.code === 'CHECKS_FAILED'));
  const closureViolation = evaluateBypass({ pull: { ...withoutRollup, body: 'Refs #42' }, degraded: true });
  assert.deepEqual(
    closureViolation.violations.map((violation) => violation.code),
    ['MISSING_CLOSING_KEYWORD'],
  );
});

// ---------------------------------------------------------------------------
// Required-check resolution: default, config override, env/--config path, validation
// ---------------------------------------------------------------------------

test('default required checks are exported and used when no config block exists', () => {
  assert.deepEqual([...DEFAULT_REQUIRED_CHECKS], ['ci / ci-gate', 'docs-guard', 'pr-close-guard']);
  assert.deepEqual(resolveRequiredChecks({}), { checks: [...DEFAULT_REQUIRED_CHECKS], source: 'default', errors: [] });
  assert.deepEqual(resolveRequiredChecks({ guard: {} }), {
    checks: [...DEFAULT_REQUIRED_CHECKS],
    source: 'default',
    errors: [],
  });
});

test('config guard.requiredChecks overrides the default list (adopter check names)', () => {
  const resolved = resolveRequiredChecks({ guard: { requiredChecks: CASTDECK_CHECKS } });
  assert.deepEqual(resolved.checks, CASTDECK_CHECKS);
  assert.equal(resolved.source, 'config');
});

test('invalid guard.requiredChecks shapes are rejected with actionable paths', () => {
  assert.deepEqual(validateRequiredChecksConfig({}), { ok: true, checks: null, errors: [] });
  for (const [bad, pathFragment] of [
    [{ guard: { requiredChecks: [] } }, 'guard.requiredChecks'],
    [{ guard: { requiredChecks: 'ci / ci-gate' } }, 'guard.requiredChecks'],
    [{ guard: { requiredChecks: [''] } }, 'guard.requiredChecks[0]'],
    [{ guard: { requiredChecks: [42] } }, 'guard.requiredChecks[0]'],
    [{ guard: { requiredChecks: ['a', 'a'] } }, 'guard.requiredChecks[1]'],
  ]) {
    const result = validateRequiredChecksConfig(bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.ok(
      result.errors.some((error) => error.path === pathFragment),
      JSON.stringify(result.errors),
    );
  }
});

test('loadGuardConfig resolves explicit --config, TRACKER_CONFIG env, and cwd default', () => {
  const dir = tempDir();
  try {
    const explicit = path.join(dir, 'custom-config.json');
    fs.writeFileSync(explicit, JSON.stringify({ guard: { requiredChecks: CASTDECK_CHECKS } }));
    const fromExplicit = loadGuardConfig({ configPath: explicit });
    assert.deepEqual(fromExplicit.checks, CASTDECK_CHECKS);
    assert.equal(fromExplicit.source, 'config');
    assert.equal(fromExplicit.exists, true);

    const fromEnv = loadGuardConfig({ env: { TRACKER_CONFIG: explicit } });
    assert.deepEqual(fromEnv.checks, CASTDECK_CHECKS);

    const cwdDefault = loadGuardConfig({ cwd: dir });
    assert.equal(cwdDefault.exists, false);
    assert.deepEqual(cwdDefault.checks, [...DEFAULT_REQUIRED_CHECKS]);
    assert.equal(cwdDefault.source, 'default');

    const missing = loadGuardConfig({ configPath: path.join(dir, 'missing.json') });
    assert.equal(missing.exists, false);
    assert.deepEqual(missing.errors, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadGuardConfig fails loudly on unparseable config or invalid requiredChecks', async () => {
  const dir = tempDir();
  try {
    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{not json');
    const brokenResult = loadGuardConfig({ configPath: broken });
    assert.ok(brokenResult.errors.some((error) => /cannot parse tracker config/.test(error.message)));

    const invalid = path.join(dir, 'invalid.json');
    fs.writeFileSync(invalid, JSON.stringify({ guard: { requiredChecks: [] } }));
    const invalidResult = loadGuardConfig({ configPath: invalid });
    assert.ok(invalidResult.errors.some((error) => error.path === 'guard.requiredChecks'));

    await assert.rejects(
      () =>
        runPostMergeAudit({
          github: fakeGithub(),
          repo: 'owner/repo',
          prNumber: 42,
          configPath: invalid,
        }),
      /invalid tracker config/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// runPostMergeAudit: green path, check failures, OI creation, deterministic output
// ---------------------------------------------------------------------------

test('runPostMergeAudit green path is quiet, default-sourced, and opens no OI', async () => {
  const logger = captureLogger();
  const github = fakeGithub();
  const result = await run({ github, logger });
  assert.equal(result.ok, true);
  assert.equal(result.degraded, false);
  assert.equal(result.checksEvaluated, true);
  assert.deepEqual(result.requiredChecks, [...DEFAULT_REQUIRED_CHECKS]);
  assert.equal(result.requiredChecksSource, 'default');
  assert.equal(result.issue, null);
  assert.equal(github.calls.metadata, 0);
  assert.equal(github.calls.issues.length, 0);
  assert.deepEqual(logger.lines, [{ level: 'log', message: 'Post-merge audit OK for PR #42.' }]);
});

test('runPostMergeAudit honours the configured check names and fails when one is absent', async () => {
  const config = { guard: { requiredChecks: CASTDECK_CHECKS } };
  const green = fakeGithub({
    pull: {
      ...BASE_PULL,
      statusCheckRollup: [
        { name: 'ci / ci-gate', conclusion: 'SUCCESS' },
        { name: 'tracker-guard / guard', conclusion: 'SUCCESS' },
        { name: 'pr-close-guard', conclusion: 'SUCCESS' },
        { name: 'docs-guard', conclusion: 'SUCCESS' },
      ],
    },
  });
  const ok = await run({ github: green, config });
  assert.equal(ok.ok, true);
  assert.equal(ok.requiredChecksSource, 'config');
  assert.deepEqual(ok.requiredChecks, CASTDECK_CHECKS);

  const missing = fakeGithub({
    pull: { ...BASE_PULL, statusCheckRollup: [{ name: 'docs-guard', conclusion: 'SUCCESS' }] },
  });
  const failed = await run({ github: missing, config });
  assert.equal(failed.ok, false);
  assert.ok(failed.violations.some((violation) => violation.code === 'CHECKS_FAILED'));
  assert.match(failed.violations[0].detail, /tracker-guard \/ guard/);
  assert.equal(missing.calls.issues.length, 1);
  assert.equal(missing.calls.issues[0].owner, 'owner');
  assert.equal(missing.calls.issues[0].repo, 'repo');
  assert.deepEqual(missing.calls.issues[0].options.labels, ['tracker-contract-exception']);
  assert.match(missing.calls.issues[0].options.title, /\[Bypass\] PR #42/);
  assert.match(missing.calls.issues[0].options.body, /CHECKS_FAILED/);
  assert.deepEqual(missing.calls.labels[0], [
    'owner',
    'repo',
    'tracker-contract-exception',
    'd93f0b',
    'A merged PR bypassed Tracker contract checks',
  ]);
});

test('audit output is deterministic across identical runs', async () => {
  const first = await run({ github: fakeGithub() });
  const second = await run({ github: fakeGithub() });
  assert.deepEqual(first, second);

  const failingPull = { ...BASE_PULL, body: 'Refs #42' };
  const firstViolation = await run({ github: fakeGithub({ pull: failingPull }) });
  const secondViolation = await run({ github: fakeGithub({ pull: failingPull }) });
  assert.deepEqual(firstViolation, secondViolation);
});

// ---------------------------------------------------------------------------
// Graceful degradation: unreadable rollup -> metadata-only closure audit
// ---------------------------------------------------------------------------

test('permission-error detection is explicit, not a catch-all', () => {
  assert.equal(isCheckRollupPermissionError(PERMISSION_ERROR), true);
  assert.equal(
    isCheckRollupPermissionError('GraphQL: statusCheckRollup is forbidden for this token; requires checks: read'),
    true,
  );
  assert.equal(isCheckRollupPermissionError('gh pr view failed: Not Found'), false);
  assert.equal(isCheckRollupPermissionError('network timeout while fetching pull request'), false);
  assert.equal(isCheckRollupPermissionError('statusCheckRollup request timed out'), false);
});

test('unreadable rollup degrades to metadata-only closure audit with warning + summary, no OI', async () => {
  const dir = tempDir();
  const summaryFile = path.join(dir, 'summary.md');
  try {
    const logger = captureLogger();
    const github = fakeGithub({ fullError: new Error(PERMISSION_ERROR) });
    const result = await run({ github, logger, env: { GITHUB_STEP_SUMMARY: summaryFile } });
    assert.equal(result.ok, true);
    assert.equal(result.degraded, true);
    assert.equal(result.checksEvaluated, false);
    assert.match(result.degradedReason, /statusCheckRollup/);
    assert.deepEqual(github.calls.order, ['full', 'metadata']);
    assert.equal(github.calls.issues.length, 0, 'no false check-related OI in degraded mode');
    assert.equal(github.calls.labels.length, 0);
    const warning = logger.lines.find((line) => line.level === 'warn');
    assert.match(warning.message, /^WARNING: statusCheckRollup is unreadable/);
    assert.match(warning.message, /actions: read/);
    assert.match(warning.message, /checks: read/);
    const logged = logger.lines.find((line) => line.level === 'log');
    assert.match(logged.message, /degraded: closure-only/);
    const summary = fs.readFileSync(summaryFile, 'utf8');
    assert.match(summary, /### Post-merge audit — PR #42/);
    assert.match(summary, /Result:\*\* PASS \(degraded\)/);
    assert.match(summary, /actions: read/);
    assert.match(summary, /checkSuite\.workflowRun/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('degraded audit still opens an OI for a real closing-keyword violation', async () => {
  const dir = tempDir();
  const summaryFile = path.join(dir, 'summary.md');
  try {
    const logger = captureLogger();
    const github = fakeGithub({
      fullError: new Error(PERMISSION_ERROR),
      metadata: { ...BASE_PULL, statusCheckRollup: undefined, body: 'Refs #42' },
    });
    const result = await run({ github, logger, env: { GITHUB_STEP_SUMMARY: summaryFile } });
    assert.equal(result.ok, false);
    assert.equal(result.degraded, true);
    assert.equal(result.checksEvaluated, false);
    assert.deepEqual(
      result.violations.map((violation) => violation.code),
      ['MISSING_CLOSING_KEYWORD'],
    );
    assert.equal(github.calls.issues.length, 1);
    assert.match(github.calls.issues[0].options.body, /MISSING_CLOSING_KEYWORD/);
    assert.match(github.calls.issues[0].options.body, /Degraded audit: statusCheckRollup unreadable/);
    const summary = fs.readFileSync(summaryFile, 'utf8');
    assert.match(summary, /### Post-merge bypass — PR #42/);
    assert.match(summary, /OI:\*\* #9/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('non-permission errors still fail the audit', async () => {
  await assert.rejects(
    () => run({ github: fakeGithub({ fullError: new Error('gh pr view 42 failed: Not Found') }) }),
    /Not Found/,
  );
  await assert.rejects(
    () => run({ github: fakeGithub({ fullError: new Error('GraphQL: timeout while reading statusCheckRollup') }) }),
    /timeout/,
  );
});

// ---------------------------------------------------------------------------
// Workflow permission contract + config schema
// ---------------------------------------------------------------------------

test('post-merge audit caller is thin and grants the least-privilege permissions incl. checks/statuses read', () => {
  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  for (const permission of [
    'contents: read',
    'issues: write',
    'pull-requests: read',
    'checks: read',
    'statuses: read',
    'actions: read',
  ]) {
    assert.ok(yaml.includes(permission), `workflow must grant ${permission}`);
  }
  for (const forbidden of [
    'pull_request_target',
    'contents: write',
    'checks: write',
    'statuses: write',
    'actions: write',
    'pull-requests: write',
  ]) {
    assert.ok(!yaml.includes(forbidden), `workflow must not contain ${forbidden}`);
  }
  assert.match(yaml, /types: \[closed\]/);
  assert.match(yaml, /github\.event\.pull_request\.merged == true/);
  // Thin caller: dispatch to the reusable workflow, no inline script/run steps.
  assert.match(yaml, /uses: \.\/\.github\/workflows\/reusable-post-merge-audit\.yml/);
  assert.match(yaml, /tracker-ref: ''/);
  assert.match(yaml, /config-path: tracker\.config\.json/);
  assert.match(yaml, /concurrency:\n {2}group: post-merge-audit-/);
  assert.doesNotMatch(yaml, /^\s+run:/m);
  assert.doesNotMatch(yaml, /node scripts\/adopt\/cli\/post-merge-audit\.mjs/);
  // Every action reference is a SHA-pinned external action (none here) or the local reusable.
  for (const match of yaml.matchAll(/^\s*(?:- )?uses:\s+(\S+)/gm)) {
    assert.ok(
      match[1].startsWith('./.github/workflows/') || /@[0-9a-f]{40}$/.test(match[1]),
      `uses must be local or SHA-pinned: ${match[1]}`,
    );
  }
});

test('config schema accepts optional guard.requiredChecks and rejects invalid shapes', () => {
  assert.deepEqual(validateConfig(fullConfig()), []);
  assert.deepEqual(validateConfig(fullConfig({ requiredChecks: CASTDECK_CHECKS })), []);
  assert.deepEqual(validateConfig(fullConfig({ transportOnly: true })), []);

  assert.ok(
    validateConfig(fullConfig({ requiredChecks: [] })).some(
      (error) => error.includes('$.guard.requiredChecks') && /at least 1/.test(error),
    ),
  );
  assert.ok(
    validateConfig(fullConfig({ requiredChecks: ['a', 'a'] })).some(
      (error) => error.includes('$.guard.requiredChecks') && /duplicate/.test(error),
    ),
  );
  assert.ok(
    validateConfig(fullConfig({ requiredChecks: ['ok', 42] })).some(
      (error) => error.includes('$.guard.requiredChecks[1]') && /expected type/.test(error),
    ),
  );
  assert.ok(
    validateConfig(fullConfig({ requiredChecks: 'ci / ci-gate' })).some((error) =>
      error.includes('$.guard.requiredChecks'),
    ),
  );
});
