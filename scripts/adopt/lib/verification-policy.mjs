/**
 * Remote-only verification policy: config resolution, defaults, and shared evaluation.
 *
 * A repo may declare disruptive suites (e.g. desktop GUI smoke) as remote-only:
 * they run visibly only on a real remote runner (`GITHUB_ACTIONS === 'true'`), while a
 * hidden local mode remains available for fast, non-authoritative feedback.
 *
 * This module is pure (no network, no GitHub API) so the guard works offline and can be
 * shared by `guard-local-suite.mjs`, `playwright-remote-guard.mjs`, `validate-config.mjs`,
 * and `verify-tooling.mjs`.
 */
const LOCAL_MODES = ['hidden', 'forbidden'];
const DEFAULT_LOCAL_MODE = 'forbidden';
export const DEFAULT_OVERRIDE_ENV = 'TRACKER_ALLOW_LOCAL_SUITE';
const REMOTE_RUNNER_ENV = 'GITHUB_ACTIONS';
export const SUITE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const OVERRIDE_ENV_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const ENTRY_KEYS = new Set(['id', 'workflow', 'prLabel', 'localMode', 'overrideEnv', 'docs']);

export const GUARD_STATUS = {
  NO_POLICY: 'NO_POLICY',
  INVALID_POLICY: 'INVALID_POLICY',
  UNKNOWN_SUITE: 'UNKNOWN_SUITE',
  REMOTE: 'REMOTE_ALLOWED',
  LOCAL_HIDDEN: 'LOCAL_HIDDEN_ALLOWED',
  LOCAL_OVERRIDE: 'LOCAL_OVERRIDE_ALLOWED',
  DEFERRED: 'DEFERRED_REMOTE',
  BLOCKED: 'BLOCKED_LOCAL_VISIBLE',
};

/** A real remote runner is GitHub Actions; a plain local `CI=true` is NOT remote. */
export function isRemoteRunner(env = process.env) {
  return env?.[REMOTE_RUNNER_ENV] === 'true';
}

/** Truthy env flag values for deliberate overrides. */
function isEnvEnabled(value) {
  if (value === undefined || value === null) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/**
 * Resolve `config.verification.remoteOnly` into normalized suites with conservative defaults.
 * Returns `{ present, suites, violations }` where violations are `{ path, message }` objects.
 */
export function resolveRemoteOnlyPolicy(config = {}) {
  const violations = [];
  const record = config?.verification;
  if (record === undefined) return { present: false, suites: [], violations };
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    violations.push({ path: 'verification', message: 'must be an object' });
    return { present: false, suites: [], violations };
  }
  const entries = record.remoteOnly;
  if (entries === undefined) return { present: false, suites: [], violations };
  if (!Array.isArray(entries)) {
    violations.push({ path: 'verification.remoteOnly', message: 'must be an array' });
    return { present: false, suites: [], violations };
  }
  if (!entries.length) return { present: false, suites: [], violations };
  const suites = [];
  const seen = new Set();
  entries.forEach((entry, index) => {
    const base = `verification.remoteOnly[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      violations.push({ path: base, message: 'must be an object' });
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) violations.push({ path: `${base}.${key}`, message: 'is not a supported key' });
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) violations.push({ path: `${base}.id`, message: 'is required (stable suite id, e.g. "desktop-smoke")' });
    else if (!SUITE_ID_PATTERN.test(id)) {
      violations.push({
        path: `${base}.id`,
        message: `${JSON.stringify(id)} must be lowercase letters, digits, and hyphens (e.g. "desktop-smoke")`,
      });
    }
    if (id) {
      if (seen.has(id)) violations.push({ path: `${base}.id`, message: `duplicate suite id ${JSON.stringify(id)}` });
      seen.add(id);
    }
    const workflow = typeof entry.workflow === 'string' ? entry.workflow.trim() : '';
    if (!workflow) {
      violations.push({
        path: `${base}.workflow`,
        message: 'is required (the remote workflow file or name that runs this suite)',
      });
    }
    const localMode = entry.localMode === undefined ? DEFAULT_LOCAL_MODE : entry.localMode;
    if (!LOCAL_MODES.includes(localMode)) {
      violations.push({
        path: `${base}.localMode`,
        message: `must be one of ${LOCAL_MODES.map((mode) => JSON.stringify(mode)).join(', ')}`,
      });
    }
    const overrideEnv = entry.overrideEnv === undefined ? DEFAULT_OVERRIDE_ENV : entry.overrideEnv;
    if (typeof overrideEnv !== 'string' || !OVERRIDE_ENV_PATTERN.test(overrideEnv)) {
      violations.push({
        path: `${base}.overrideEnv`,
        message: `must be an env var name like ${JSON.stringify(DEFAULT_OVERRIDE_ENV)}`,
      });
    }
    const prLabel = entry.prLabel === undefined ? null : entry.prLabel;
    if (prLabel !== null && (typeof prLabel !== 'string' || !prLabel.trim())) {
      violations.push({ path: `${base}.prLabel`, message: 'must be a non-empty label name' });
    }
    const docs = entry.docs === undefined ? null : entry.docs;
    if (docs !== null && (typeof docs !== 'string' || !docs.trim())) {
      violations.push({ path: `${base}.docs`, message: 'must be a non-empty doc path or URL' });
    }
    if (id && workflow) {
      suites.push({
        id,
        workflow,
        prLabel: prLabel === null ? null : prLabel.trim(),
        localMode,
        overrideEnv,
        docs: docs === null ? null : docs.trim(),
        index,
      });
    }
  });
  return { present: true, suites, violations };
}

/** Stable identifier lookup; returns the normalized suite or null. */
function findPolicySuite(suites = [], suiteId = '') {
  return (suites || []).find((suite) => suite.id === suiteId) || null;
}

function suiteFacts(suite) {
  return {
    suite: {
      id: suite.id,
      workflow: suite.workflow,
      prLabel: suite.prLabel,
      localMode: suite.localMode,
      overrideEnv: suite.overrideEnv,
      docs: suite.docs,
    },
  };
}

/**
 * Shared evaluation used by the CLI, the Playwright helper, and tests.
 *
 * `mode: 'enforce'` blocks visible local runs; `mode: 'report'` defers to remote (exit 0) for
 * verify aggregators. Remote runners, hidden local mode (when declared), and the explicit
 * override env are allowed before the mode-specific branch.
 */
export function evaluateRemoteOnlyPolicy({
  config = {},
  suiteId,
  mode = 'enforce',
  hidden = false,
  env = process.env,
}) {
  const resolved = resolveRemoteOnlyPolicy(config);
  if (resolved.violations.length) {
    return {
      ok: false,
      status: GUARD_STATUS.INVALID_POLICY,
      exitCode: 1,
      mode,
      suiteId: suiteId ?? null,
      violations: resolved.violations.map((violation) => ({ path: `$.${violation.path}`, message: violation.message })),
    };
  }
  if (!resolved.present)
    return { ok: true, status: GUARD_STATUS.NO_POLICY, exitCode: 0, mode, suiteId: suiteId ?? null, suite: null };
  const suite = findPolicySuite(resolved.suites, suiteId);
  if (!suite) {
    return {
      ok: false,
      status: GUARD_STATUS.UNKNOWN_SUITE,
      exitCode: 1,
      mode,
      suiteId: suiteId ?? null,
      knownSuites: resolved.suites.map((entry) => entry.id),
    };
  }
  const remote = isRemoteRunner(env);
  const override = isEnvEnabled(env?.[suite.overrideEnv]);
  const base = { mode, remote, hiddenRequested: Boolean(hidden), ...suiteFacts(suite) };
  if (remote) return { ok: true, status: GUARD_STATUS.REMOTE, exitCode: 0, ...base };
  if (override) {
    return {
      ok: true,
      status: GUARD_STATUS.LOCAL_OVERRIDE,
      exitCode: 0,
      ...base,
      warning: `remote-only policy for suite ${JSON.stringify(suite.id)} overridden via ${suite.overrideEnv}; local visible runs are not authoritative evidence`,
    };
  }
  if (hidden && suite.localMode === 'hidden') {
    return {
      ok: true,
      status: GUARD_STATUS.LOCAL_HIDDEN,
      exitCode: 0,
      ...base,
      warning:
        'hidden local mode is allowed for fast non-authoritative feedback; remote visible run remains the evidence',
    };
  }
  if (mode === 'report') return { ok: true, status: GUARD_STATUS.DEFERRED, exitCode: 0, ...base };
  return { ok: false, status: GUARD_STATUS.BLOCKED, exitCode: 1, ...base };
}

/** Actionable multi-line instructions for a blocked/unknown evaluation (shared by CLI + helper). */
export function formatGuardInstructions(result) {
  if (result.status === GUARD_STATUS.INVALID_POLICY) {
    return [
      'remote-only verification policy is invalid; fix tracker.config.json:',
      ...result.violations.map((violation) => `- ${violation.path}: ${violation.message}`),
    ].join('\n');
  }
  if (result.status === GUARD_STATUS.UNKNOWN_SUITE) {
    return [
      `suite ${JSON.stringify(result.suiteId)} is not declared in verification.remoteOnly`,
      `known suites: ${result.knownSuites.length ? result.knownSuites.join(', ') : '(none)'}`,
      'declare it in tracker.config.json (id/workflow) or fix the --suite value',
    ].join('\n');
  }
  const suite = result.suite || {};
  const lines = [
    `BLOCKED_LOCAL_VISIBLE suite=${suite.id}: local visible runs are forbidden by the remote-only policy.`,
    'Why: visible GUI suites are disruptive locally and local runs are not authoritative evidence.',
    'Run it remotely instead:',
    `  - workflow: ${suite.workflow}`,
  ];
  if (suite.prLabel) lines.push(`  - PR label: ${suite.prLabel} (or push/tag per the workflow trigger)`);
  if (suite.docs) lines.push(`  - docs: ${suite.docs}`);
  if (result.hiddenRequested && suite.localMode !== 'hidden') {
    lines.push('Local hidden mode: not available for this suite (localMode=forbidden).');
  } else if (suite.localMode === 'hidden') {
    lines.push('Hidden local mode (non-authoritative): re-run with --hidden to exercise it.');
  } else {
    lines.push('Local hidden mode: not available for this suite (localMode=forbidden).');
  }
  lines.push(`Deliberate human debugging only: ${suite.overrideEnv}=1 (loud warning; agents must never use it).`);
  return lines.join('\n');
}

/** Single-line machine-readable report used by `--mode report` aggregators. */
export function formatDeferredRemoteReport(result) {
  const suite = result.suite || {};
  const fields = [
    'suite=' + (suite.id || '-'),
    'workflow=' + (suite.workflow || '-'),
    'prLabel=' + (suite.prLabel || '-'),
    'overrideEnv=' + (suite.overrideEnv || '-'),
    'docs=' + (suite.docs || '-'),
  ];
  return `${result.status} ${fields.join(' ')}`;
}
