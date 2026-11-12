import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateConfig } from '../scripts/github/validate-config.mjs';
import {
  DEFAULT_OVERRIDE_ENV,
  GUARD_STATUS,
  evaluateRemoteOnlyPolicy,
  isRemoteRunner,
  resolveRemoteOnlyPolicy,
} from '../scripts/github/lib/verification-policy.mjs';
import { evaluateTooling } from '../scripts/github/verify-tooling.mjs';
import createPlaywrightRemoteGuard, {
  createPlaywrightRemoteGuard as createGuardNamed,
} from '../scripts/github/playwright-remote-guard.mjs';

const REPO_ROOT = process.cwd();
const GUARD = path.join(REPO_ROOT, 'scripts/github/guard-local-suite.mjs');

const STATUSES = ['Todo', 'In Progress', 'In Review', 'Blocked', 'Done'];
const DESKTOP_SUITE = {
  id: 'desktop-smoke',
  workflow: '.github/workflows/reusable-desktop-smoke.yml',
  prLabel: 'run-desktop-smoke',
  localMode: 'hidden',
  overrideEnv: 'TRACKER_ALLOW_VISIBLE_GUI',
  docs: 'profiles/desktop/README.md',
};

function baseConfig(overrides = {}) {
  return {
    trackerVersion: 1,
    repository: 'owner/repo',
    project: { owner: 'owner', title: 'Project Tracker', number: 1 },
    statuses: STATUSES,
    fields: {
      Release: { options: ['v1.0.0'] },
      Sprint: { options: ['1.0.0.1'] },
      Area: { options: ['docs'] },
      Kind: { options: ['infra'] },
      Estimate: { options: ['M'] },
    },
    releases: [{ key: 'v1.0.0', milestone: 'v1.0.0' }],
    automation: { templateVersion: '1.3.0' },
    ...overrides,
  };
}

function configWithPolicy(suites) {
  return baseConfig({ verification: { remoteOnly: suites } });
}

function writeConfig(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-only-'));
  fs.writeFileSync(path.join(dir, 'tracker.config.json'), JSON.stringify(config, null, 2));
  return dir;
}

/** Child-process invocation with a controlled environment (no inherited GITHUB_ACTIONS/CI). */
function runGuard({ config, args = [], env = {} }) {
  const dir = config ? writeConfig(config) : fs.mkdtempSync(path.join(os.tmpdir(), 'remote-only-'));
  try {
    const result = spawnSync(process.execPath, [GUARD, '--root', dir, ...args], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
      encoding: 'utf8',
    });
    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Config schema + validate-config matrix
// ---------------------------------------------------------------------------

test('absent verification config is a no-op (backwards compatible)', () => {
  assert.deepEqual(validateConfig(baseConfig()), []);
  const resolved = resolveRemoteOnlyPolicy(baseConfig());
  assert.equal(resolved.present, false);
  const result = evaluateRemoteOnlyPolicy({ config: baseConfig(), suiteId: 'desktop-smoke', env: {} });
  assert.equal(result.status, GUARD_STATUS.NO_POLICY);
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
});

test('valid remoteOnly entry validates and normalizes conservative defaults', () => {
  assert.deepEqual(validateConfig(configWithPolicy([DESKTOP_SUITE])), []);
  assert.deepEqual(validateConfig(configWithPolicy([])), []);

  const minimal = configWithPolicy([{ id: 'gui-smoke', workflow: 'desktop-smoke.yml' }]);
  assert.deepEqual(validateConfig(minimal), []);
  const resolved = resolveRemoteOnlyPolicy(minimal);
  assert.equal(resolved.present, true);
  assert.equal(resolved.suites[0].id, 'gui-smoke');
  assert.equal(resolved.suites[0].localMode, 'forbidden', 'localMode defaults to forbidden');
  assert.equal(resolved.suites[0].overrideEnv, DEFAULT_OVERRIDE_ENV, 'overrideEnv has a documented default');
});

test('validate-config rejects invalid policy fields with actionable paths', () => {
  const badMode = validateConfig(configWithPolicy([{ ...DESKTOP_SUITE, localMode: 'visible' }]));
  assert.ok(
    badMode.some(
      (error) =>
        error.includes('$.verification.remoteOnly[0].localMode') && /hidden/.test(error) && /forbidden/.test(error),
    ),
  );

  const missingId = validateConfig(configWithPolicy([{ workflow: 'wf.yml' }]));
  assert.ok(missingId.some((error) => error.includes('$.verification.remoteOnly[0].id') && /required/.test(error)));

  const missingWorkflow = validateConfig(configWithPolicy([{ id: 'gui-smoke' }]));
  assert.ok(
    missingWorkflow.some((error) => error.includes('$.verification.remoteOnly[0].workflow') && /required/.test(error)),
  );

  const badOverride = validateConfig(configWithPolicy([{ ...DESKTOP_SUITE, overrideEnv: 'not-an-env' }]));
  assert.ok(badOverride.some((error) => error.includes('overrideEnv') && /does not match/.test(error)));

  const extraKey = validateConfig(configWithPolicy([{ ...DESKTOP_SUITE, nope: true }]));
  assert.ok(extraKey.some((error) => error.includes('$.verification.remoteOnly[0].nope') && /not allowed/.test(error)));

  const duplicateId = validateConfig(
    configWithPolicy([
      { ...DESKTOP_SUITE, id: 'gui-smoke' },
      { ...DESKTOP_SUITE, id: 'gui-smoke', workflow: 'other.yml' },
    ]),
  );
  assert.ok(duplicateId.some((error) => /duplicate suite id "gui-smoke"/.test(error)));

  const notArray = validateConfig(baseConfig({ verification: { remoteOnly: { id: 'x' } } }));
  assert.ok(notArray.some((error) => error.includes('$.verification.remoteOnly') && /expected type/.test(error)));
});

test('resolveRemoteOnlyPolicy rejects malformed shapes and duplicate ids for guard consumers', () => {
  const notArray = resolveRemoteOnlyPolicy(baseConfig({ verification: { remoteOnly: 'desktop-smoke' } }));
  assert.equal(notArray.present, false);
  assert.ok(notArray.violations.some((violation) => violation.path === 'verification.remoteOnly'));

  const duplicate = resolveRemoteOnlyPolicy(configWithPolicy([DESKTOP_SUITE, { ...DESKTOP_SUITE }]));
  assert.ok(duplicate.violations.some((violation) => /duplicate suite id/.test(violation.message)));

  const badEntry = resolveRemoteOnlyPolicy(configWithPolicy([{ id: 'Bad Id', workflow: '' }]));
  assert.ok(badEntry.violations.some((violation) => violation.path.endsWith('.id')));
  assert.ok(badEntry.violations.some((violation) => violation.path.endsWith('.workflow')));
});

test('isRemoteRunner trusts only GITHUB_ACTIONS === "true"', () => {
  assert.equal(isRemoteRunner({ GITHUB_ACTIONS: 'true' }), true);
  assert.equal(isRemoteRunner({ GITHUB_ACTIONS: '1' }), false);
  assert.equal(isRemoteRunner({ CI: 'true' }), false, 'plain CI is not a remote runner');
  assert.equal(isRemoteRunner({ GITHUB_ACTIONS: 'false', CI: 'true' }), false);
  assert.equal(isRemoteRunner({}), false);
});

// ---------------------------------------------------------------------------
// Shared evaluation matrix (no child process)
// ---------------------------------------------------------------------------

test('evaluateRemoteOnlyPolicy covers remote/hidden/override/report/blocked paths', () => {
  const config = configWithPolicy([DESKTOP_SUITE]);
  const remote = evaluateRemoteOnlyPolicy({ config, suiteId: 'desktop-smoke', env: { GITHUB_ACTIONS: 'true' } });
  assert.equal(remote.status, GUARD_STATUS.REMOTE);
  assert.equal(remote.exitCode, 0);

  const hidden = evaluateRemoteOnlyPolicy({ config, suiteId: 'desktop-smoke', hidden: true, env: {} });
  assert.equal(hidden.status, GUARD_STATUS.LOCAL_HIDDEN);
  assert.match(hidden.warning, /non-authoritative/);

  const override = evaluateRemoteOnlyPolicy({
    config,
    suiteId: 'desktop-smoke',
    env: { TRACKER_ALLOW_VISIBLE_GUI: '1' },
  });
  assert.equal(override.status, GUARD_STATUS.LOCAL_OVERRIDE);
  assert.match(override.warning, /overridden via TRACKER_ALLOW_VISIBLE_GUI/);

  const overrideOff = evaluateRemoteOnlyPolicy({
    config,
    suiteId: 'desktop-smoke',
    env: { TRACKER_ALLOW_VISIBLE_GUI: '0' },
  });
  assert.equal(overrideOff.status, GUARD_STATUS.BLOCKED);

  const report = evaluateRemoteOnlyPolicy({ config, suiteId: 'desktop-smoke', mode: 'report', env: {} });
  assert.equal(report.status, GUARD_STATUS.DEFERRED);
  assert.equal(report.exitCode, 0);

  const blocked = evaluateRemoteOnlyPolicy({ config, suiteId: 'desktop-smoke', env: {} });
  assert.equal(blocked.status, GUARD_STATUS.BLOCKED);
  assert.equal(blocked.exitCode, 1);
  assert.equal(blocked.hiddenRequested, false);

  const forbidden = configWithPolicy([{ ...DESKTOP_SUITE, localMode: 'forbidden' }]);
  const forbiddenHidden = evaluateRemoteOnlyPolicy({
    config: forbidden,
    suiteId: 'desktop-smoke',
    hidden: true,
    env: {},
  });
  assert.equal(forbiddenHidden.status, GUARD_STATUS.BLOCKED);
});

test('evaluateRemoteOnlyPolicy reports unknown suites and invalid policies', () => {
  const unknown = evaluateRemoteOnlyPolicy({
    config: configWithPolicy([DESKTOP_SUITE]),
    suiteId: 'desktop-smok',
    env: {},
  });
  assert.equal(unknown.status, GUARD_STATUS.UNKNOWN_SUITE);
  assert.equal(unknown.ok, false);
  assert.deepEqual(unknown.knownSuites, ['desktop-smoke']);

  const invalid = evaluateRemoteOnlyPolicy({
    config: configWithPolicy([{ id: 'desktop-smoke', workflow: '', localMode: 'visible' }]),
    suiteId: 'desktop-smoke',
    env: {},
  });
  assert.equal(invalid.status, GUARD_STATUS.INVALID_POLICY);
  assert.ok(invalid.violations.some((violation) => violation.path.includes('verification.remoteOnly[0]')));
});

// ---------------------------------------------------------------------------
// CLI child-process behaviour with controlled env
// ---------------------------------------------------------------------------

test('guard enforce blocks visible local runs with remote/override/docs instructions', () => {
  const result = runGuard({ config: configWithPolicy([DESKTOP_SUITE]), args: ['--suite', 'desktop-smoke'] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BLOCKED_LOCAL_VISIBLE/);
  assert.match(result.stderr, /reusable-desktop-smoke\.yml/);
  assert.match(result.stderr, /run-desktop-smoke/);
  assert.match(result.stderr, /TRACKER_ALLOW_VISIBLE_GUI=1/);
  assert.match(result.stderr, /profiles\/desktop\/README\.md/);
  assert.match(result.stderr, /re-run with --hidden/);
});

test('guard allows a remote runner via GITHUB_ACTIONS=true, not plain CI', () => {
  const config = configWithPolicy([DESKTOP_SUITE]);
  const ciOnly = runGuard({ config, args: ['--suite', 'desktop-smoke'], env: { CI: 'true' } });
  assert.equal(ciOnly.status, 1);
  assert.match(ciOnly.stderr, /BLOCKED_LOCAL_VISIBLE/);

  const remote = runGuard({
    config,
    args: ['--suite', 'desktop-smoke'],
    env: { GITHUB_ACTIONS: 'true', CI: 'true' },
  });
  assert.equal(remote.status, 0);
  assert.match(remote.stdout, /ALLOWED REMOTE_ALLOWED suite=desktop-smoke/);
});

test('guard report mode prints machine-readable DEFERRED_REMOTE and exits 0', () => {
  const config = configWithPolicy([DESKTOP_SUITE]);
  const human = runGuard({ config, args: ['--suite', 'desktop-smoke', '--mode', 'report'] });
  assert.equal(human.status, 0);
  assert.match(
    human.stdout,
    /^DEFERRED_REMOTE suite=desktop-smoke workflow=\.github\/workflows\/reusable-desktop-smoke\.yml prLabel=run-desktop-smoke overrideEnv=TRACKER_ALLOW_VISIBLE_GUI docs=profiles\/desktop\/README\.md\n$/,
  );

  const json = runGuard({ config, args: ['--suite', 'desktop-smoke', '--mode', 'report', '--json'] });
  assert.equal(json.status, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.status, 'DEFERRED_REMOTE');
  assert.equal(parsed.exitCode, 0);
  assert.equal(parsed.suite.id, 'desktop-smoke');
  assert.equal(json.stderr, '');
});

test('guard override env allows deliberately with a loud warning', () => {
  const config = configWithPolicy([DESKTOP_SUITE]);
  const allowed = runGuard({
    config,
    args: ['--suite', 'desktop-smoke'],
    env: { TRACKER_ALLOW_VISIBLE_GUI: '1' },
  });
  assert.equal(allowed.status, 0);
  assert.match(allowed.stdout, /LOCAL_OVERRIDE_ALLOWED/);
  assert.match(allowed.stderr, /WARNING: .*TRACKER_ALLOW_VISIBLE_GUI/);
  assert.match(allowed.stderr, /not authoritative evidence/);

  const disabled = runGuard({
    config,
    args: ['--suite', 'desktop-smoke'],
    env: { TRACKER_ALLOW_VISIBLE_GUI: 'false' },
  });
  assert.equal(disabled.status, 1);
});

test('guard hidden local mode is allowed only when declared and requested', () => {
  const config = configWithPolicy([DESKTOP_SUITE]);
  const hidden = runGuard({ config, args: ['--suite', 'desktop-smoke', '--hidden'] });
  assert.equal(hidden.status, 0);
  assert.match(hidden.stdout, /LOCAL_HIDDEN_ALLOWED/);
  assert.match(hidden.stderr, /WARNING: hidden local mode is allowed/);

  const missingFlag = runGuard({ config, args: ['--suite', 'desktop-smoke'] });
  assert.equal(missingFlag.status, 1);

  const forbidden = configWithPolicy([{ ...DESKTOP_SUITE, localMode: 'forbidden' }]);
  const forbiddenHidden = runGuard({ config: forbidden, args: ['--suite', 'desktop-smoke', '--hidden'] });
  assert.equal(forbiddenHidden.status, 1);
  assert.match(forbiddenHidden.stderr, /not available for this suite \(localMode=forbidden\)/);
});

test('guard fails on unknown/typoed suite ids and on missing policy is a no-op', () => {
  const unknown = runGuard({ config: configWithPolicy([DESKTOP_SUITE]), args: ['--suite', 'desktop-smok'] });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /not declared in verification\.remoteOnly/);
  assert.match(unknown.stderr, /known suites: desktop-smoke/);

  const noPolicy = runGuard({ config: baseConfig(), args: ['--suite', 'desktop-smoke'] });
  assert.equal(noPolicy.status, 0);
  assert.match(noPolicy.stdout, /ALLOWED NO_POLICY/);
});

test('guard fails on invalid config and missing config with actionable output', () => {
  const invalid = runGuard({
    config: configWithPolicy([{ ...DESKTOP_SUITE, localMode: 'visible' }]),
    args: ['--suite', 'desktop-smoke'],
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /invalid tracker config/);
  assert.match(invalid.stderr, /\$\.verification\.remoteOnly\[0\]\.localMode/);

  const missing = runGuard({ config: null, args: ['--suite', 'desktop-smoke'] });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /config not found/);

  const badMode = runGuard({
    config: configWithPolicy([DESKTOP_SUITE]),
    args: ['--suite', 'desktop-smoke', '--mode', 'nope'],
  });
  assert.equal(badMode.status, 1);
  assert.match(badMode.stderr, /--mode must be one of/);
});

// ---------------------------------------------------------------------------
// Playwright globalSetup helper
// ---------------------------------------------------------------------------

test('playwright helper blocks a visible local run before any browser spawn', async () => {
  const config = configWithPolicy([DESKTOP_SUITE]);
  const setup = createPlaywrightRemoteGuard({ config, suite: 'desktop-smoke', env: {} });
  assert.equal(typeof setup, 'function');
  await assert.rejects(
    () => setup(),
    (err) =>
      /remote-only guard: BLOCKED_LOCAL_VISIBLE/.test(err.message) &&
      /reusable-desktop-smoke\.yml/.test(err.message) &&
      err.code === GUARD_STATUS.BLOCKED,
  );
});

test('playwright helper allows remote, hidden local, and override paths', async () => {
  const config = configWithPolicy([DESKTOP_SUITE]);
  await createPlaywrightRemoteGuard({ config, suite: 'desktop-smoke', env: { GITHUB_ACTIONS: 'true' } })();
  await createPlaywrightRemoteGuard({ config, suite: 'desktop-smoke', hidden: true, env: {} })();

  const warnings = [];
  await createPlaywrightRemoteGuard({
    config,
    suite: 'desktop-smoke',
    env: { TRACKER_ALLOW_VISIBLE_GUI: '1' },
    warn: (message) => warnings.push(message),
  })();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /WARNING: .*TRACKER_ALLOW_VISIBLE_GUI/);

  const forbidden = configWithPolicy([{ ...DESKTOP_SUITE, localMode: 'forbidden' }]);
  await assert.rejects(
    () => createPlaywrightRemoteGuard({ config: forbidden, suite: 'desktop-smoke', hidden: true, env: {} })(),
    /not available for this suite/,
  );
});

test('playwright helper is a no-op without policy and fails typos with guidance', async () => {
  await createPlaywrightRemoteGuard({ config: baseConfig(), suite: 'desktop-smoke', env: {} })();
  await assert.rejects(
    () => createPlaywrightRemoteGuard({ config: configWithPolicy([DESKTOP_SUITE]), suite: 'nope', env: {} })(),
    (err) => /not declared in verification\.remoteOnly/.test(err.message) && err.code === GUARD_STATUS.UNKNOWN_SUITE,
  );
  assert.throws(() => createPlaywrightRemoteGuard({}), /suite id is required/);
});

test('playwright helper can load tracker.config.json from a path and is dependency-free', async () => {
  const dir = writeConfig(configWithPolicy([DESKTOP_SUITE]));
  try {
    const setup = createPlaywrightRemoteGuard({
      suite: 'desktop-smoke',
      configPath: path.join(dir, 'tracker.config.json'),
      env: {},
    });
    await assert.rejects(() => setup(), /BLOCKED_LOCAL_VISIBLE/);
    const missingFile = createPlaywrightRemoteGuard({
      suite: 'desktop-smoke',
      configPath: path.join(dir, 'does-not-exist.json'),
      env: {},
    });
    await missingFile();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const source = fs.readFileSync(path.join(REPO_ROOT, 'scripts/github/playwright-remote-guard.mjs'), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]@playwright\/test['"]/, 'helper must not import @playwright/test');
  assert.equal(createPlaywrightRemoteGuard, createGuardNamed);
});

// ---------------------------------------------------------------------------
// verify-tooling validates the remoteOnly config shape
// ---------------------------------------------------------------------------

test('verify-tooling accepts a valid remoteOnly policy and rejects malformed ones', () => {
  const contract = { trackerVersion: '1.3.0', tooling: { config: 'profiles/node/eslint.config.mjs' } };
  const pkg = { devDependencies: {} };
  const configText = 'profiles/node/eslint.config.mjs';

  const clean = evaluateTooling({ contract, pkg, configText, trackerConfig: configWithPolicy([DESKTOP_SUITE]) });
  assert.equal(clean.ok, true, JSON.stringify(clean.violations));

  const absent = evaluateTooling({ contract, pkg, configText, trackerConfig: baseConfig() });
  assert.equal(absent.ok, true);

  const missingWorkflow = evaluateTooling({
    contract,
    pkg,
    configText,
    trackerConfig: configWithPolicy([{ id: 'desktop-smoke' }]),
  });
  assert.ok(missingWorkflow.violations.some((violation) => /workflow: is required/.test(violation)));

  const duplicate = evaluateTooling({
    contract,
    pkg,
    configText,
    trackerConfig: configWithPolicy([
      { ...DESKTOP_SUITE, id: 'gui-smoke' },
      { ...DESKTOP_SUITE, id: 'gui-smoke' },
    ]),
  });
  assert.ok(duplicate.violations.some((violation) => /duplicate suite id/.test(violation)));
});
