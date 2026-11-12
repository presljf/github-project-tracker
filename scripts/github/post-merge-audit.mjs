#!/usr/bin/env node
/**
 * Audit a merged PR for contract bypasses and open a tracker OI.
 *
 * - Required check names resolve from `guard.requiredChecks[]` in tracker.config.json
 *   (`--config` / `TRACKER_CONFIG` supported); absent config keeps the backwards-compatible default.
 * - If `statusCheckRollup` is unreadable because the token lacks `checks: read`/`statuses: read`
 *   (private repos), the audit degrades loudly to a metadata-only fetch and enforces only the
 *   closing-keyword/partial-PR rules instead of failing red or opening a false check-related OI.
 * - Any other error still fails; real closure violations still open a `tracker-contract-exception` OI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHubCli } from './lib/github.mjs';
import { evaluateRequiredChecks } from './merge-pr.mjs';
import { parseClosingRefs } from './guard-pr-close.mjs';
import { parseArgs, UsageError } from './lib/cli.mjs';

/** Backwards-compatible default required check list (the tracker's own names). */
export const DEFAULT_REQUIRED_CHECKS = Object.freeze(['ci / ci-gate', 'docs-guard', 'pr-close-guard']);
/** @deprecated kept for existing imports/tests; prefer DEFAULT_REQUIRED_CHECKS. */
export const REQUIRED_CHECKS = DEFAULT_REQUIRED_CHECKS;

const DEGRADED_WARNING =
  'WARNING: statusCheckRollup is unreadable (permission/API error); degrading post-merge audit to closure-only. ' +
  'Required-check verification was skipped. Grant `checks: read` + `statuses: read` in the caller workflow permissions to restore the full audit.';

function errorText(err) {
  return [err?.stderr, err?.message].filter(Boolean).join('\n').trim();
}

/**
 * Explicit permission/API-error detection for an unreadable check rollup — not a catch-all.
 * Other failures (not found, network, auth) keep their normal failing behaviour.
 */
export function isCheckRollupPermissionError(message = '') {
  const text = String(message);
  if (!/statusCheckRollup/i.test(text)) return false;
  return /resource not accessible by integration|not accessible|forbidden|permission|checks:\s*read|statuses:\s*read/i.test(
    text,
  );
}

/** Validate the optional `guard.requiredChecks` shape; returns `{ok, checks, errors}`. */
export function validateRequiredChecksConfig(config = {}) {
  const list = config?.guard?.requiredChecks;
  if (list === undefined) return { ok: true, checks: null, errors: [] };
  const errors = [];
  if (!Array.isArray(list) || list.length === 0) {
    errors.push({ path: 'guard.requiredChecks', message: 'must be a non-empty array of check names' });
    return { ok: false, checks: null, errors };
  }
  const seen = new Set();
  list.forEach((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      errors.push({ path: `guard.requiredChecks[${index}]`, message: 'must be a non-empty check name' });
      return;
    }
    if (seen.has(item))
      errors.push({ path: `guard.requiredChecks[${index}]`, message: `duplicate check name ${JSON.stringify(item)}` });
    seen.add(item);
  });
  if (errors.length) return { ok: false, checks: null, errors };
  return { ok: true, checks: list, errors: [] };
}

/** Effective list: repo config first, backwards-compatible default otherwise. */
export function resolveRequiredChecks(config = {}) {
  const validated = validateRequiredChecksConfig(config);
  if (!validated.ok) return { checks: [...DEFAULT_REQUIRED_CHECKS], source: 'default', errors: validated.errors };
  if (validated.checks) return { checks: validated.checks, source: 'config', errors: [] };
  return { checks: [...DEFAULT_REQUIRED_CHECKS], source: 'default', errors: [] };
}

function resolveConfigPath({ configPath = null, env = process.env, cwd = process.cwd() } = {}) {
  const candidate = configPath || env.TRACKER_CONFIG || 'tracker.config.json';
  return path.resolve(cwd, candidate);
}

/**
 * Load the audit config. Missing config file = default list (backwards compatible); an unreadable or
 * invalid `guard.requiredChecks` block returns actionable errors so the audit fails loudly.
 */
export function loadGuardConfig({ configPath = null, env = process.env, cwd = process.cwd() } = {}) {
  const file = resolveConfigPath({ configPath, env, cwd });
  if (!fs.existsSync(file)) {
    return {
      checks: [...DEFAULT_REQUIRED_CHECKS],
      source: 'default',
      path: file,
      exists: false,
      errors: [],
    };
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return {
      checks: [...DEFAULT_REQUIRED_CHECKS],
      source: 'default',
      path: file,
      exists: true,
      errors: [{ path: file, message: `cannot parse tracker config: ${err.message}` }],
    };
  }
  return { ...resolveRequiredChecks(config), path: file, exists: true };
}

/**
 * Evaluate a merged PR for bypasses. `degraded` skips the required-check evaluation (used when the
 * rollup is unreadable) but still enforces closing-keyword/partial-PR rules.
 */
export function evaluateBypass({ pull, required = DEFAULT_REQUIRED_CHECKS, degraded = false }) {
  const violations = [];
  const checksEvaluated = !degraded;
  if (checksEvaluated) {
    const checks = evaluateRequiredChecks(pull.statusCheckRollup, required);
    if (!checks.ok)
      violations.push({
        code: 'CHECKS_FAILED',
        detail: `missing=${checks.missing.join(',') || 'none'} failing=${checks.failing.join(',') || 'none'}`,
      });
  }
  const labels = (pull.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const partial = labels.includes('partial');
  const closing = parseClosingRefs(pull.body);
  if (String(pull.headRefName || '').startsWith('task/') && !partial && closing.length === 0)
    violations.push({ code: 'MISSING_CLOSING_KEYWORD', detail: 'task PR merged without Closes/Fixes/Resolves' });
  if (partial && closing.length > 0)
    violations.push({
      code: 'PARTIAL_CLOSED_TASK',
      detail: `partial PR used closing keyword(s): ${closing.join(',')}`,
    });
  return { ok: violations.length === 0, checksEvaluated, violations };
}

export function writeStepSummary(text, env = process.env) {
  const target = env.GITHUB_STEP_SUMMARY;
  if (!target) return false;
  try {
    fs.appendFileSync(target, `${String(text).replace(/\n?$/, '\n')}`);
    return true;
  } catch {
    return false;
  }
}

function degradedSummary(result) {
  return [
    `### Post-merge audit — PR #${result.prNumber}`,
    '',
    '- **Result:** PASS (degraded)',
    `- **Degraded:** \`statusCheckRollup\` unreadable (${result.degradedReason}); required-check verification skipped, closing-keyword/partial rules still enforced.`,
    `- **Required checks (not evaluated):** ${result.requiredChecks.join(', ')}`,
    '- **Fix:** grant `checks: read` + `statuses: read` in the caller workflow permissions (private repos need them for the check rollup).',
  ].join('\n');
}

function violationSummary(result) {
  return [
    `### Post-merge bypass — PR #${result.prNumber}`,
    '',
    ...result.violations.map((violation) => `- **${violation.code}**: ${violation.detail}`),
    result.issue ? `- **OI:** #${result.issue.number} ${result.issue.url}` : '',
    result.degraded
      ? `- **Degraded:** statusCheckRollup unreadable (${result.degradedReason}); closure rules only.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Run the audit with an injected GitHub adapter (real `GitHubCli` in the workflow, fake in tests).
 */
export async function runPostMergeAudit({
  github,
  repo,
  prNumber,
  configPath = null,
  config = null,
  env = process.env,
  logger = console,
  cwd = process.cwd(),
} = {}) {
  const [owner, name] = String(repo || '').split('/');
  if (!owner || !name) throw new Error('runPostMergeAudit: repo must be owner/name');
  if (!Number.isInteger(prNumber) || prNumber <= 0)
    throw new Error('runPostMergeAudit: prNumber must be a positive integer');
  const configState =
    config !== null && config !== undefined
      ? { ...resolveRequiredChecks(config), path: null, exists: true }
      : loadGuardConfig({ configPath, env, cwd });
  if (configState.errors.length) {
    throw new Error(
      `invalid tracker config: ${configState.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`,
    );
  }
  const required = configState.checks;
  let pull;
  let degraded = false;
  let degradedReason = null;
  try {
    pull = await github.getPullRequest(owner, name, prNumber);
  } catch (err) {
    const message = errorText(err);
    if (!isCheckRollupPermissionError(message)) throw err;
    degraded = true;
    degradedReason = message.split('\n')[0];
    logger.warn(DEGRADED_WARNING);
    pull = await github.getPullRequestMetadata(owner, name, prNumber);
    if (!pull)
      throw new Error(`PR #${prNumber} metadata could not be loaded after the rollup permission failure`, {
        cause: err,
      });
  }
  const evaluation = evaluateBypass({ pull, required, degraded });
  const result = {
    ok: evaluation.ok,
    repo: `${owner}/${name}`,
    prNumber,
    degraded,
    degradedReason,
    checksEvaluated: evaluation.checksEvaluated,
    requiredChecks: required,
    requiredChecksSource: configState.source,
    configPath: configState.path,
    violations: evaluation.violations,
    issue: null,
  };
  if (evaluation.ok) {
    logger.log(`Post-merge audit OK for PR #${prNumber}${degraded ? ' (degraded: closure-only)' : ''}.`);
    if (degraded) writeStepSummary(degradedSummary(result), env);
    return result;
  }
  try {
    await github.createLabel(
      owner,
      name,
      'tracker-contract-exception',
      'd93f0b',
      'A merged PR bypassed Tracker contract checks',
    );
  } catch {
    /* label may already exist */
  }
  const detail = evaluation.violations.map((violation) => `- **${violation.code}**: ${violation.detail}`).join('\n');
  const issue = await github.createIssue(owner, name, {
    title: `[Bypass] PR #${prNumber} merged without a clean contract gate`,
    body: [
      '## Contract bypass detected',
      '',
      `PR: #${prNumber}`,
      '',
      detail,
      ...(degraded
        ? ['', `> Degraded audit: statusCheckRollup unreadable (${degradedReason}); closure rules only.`]
        : []),
      '',
      'Resolve this OI before the next release; do not silently retry or hide the bypass.',
      '',
    ].join('\n'),
    labels: ['tracker-contract-exception'],
  });
  logger.log(`Opened bypass OI #${issue.number}: ${issue.url}`);
  writeStepSummary(violationSummary({ ...result, issue }), env);
  return { ...result, issue };
}

function usage() {
  return [
    'Usage: node scripts/github/post-merge-audit.mjs [--config tracker.config.json]',
    '',
    'Audits a merged PR from env: GH_TOKEN/GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER.',
    'Required checks come from guard.requiredChecks[] in the config (absent = default list).',
    'An unreadable statusCheckRollup degrades loudly to closure-only auditing; other errors fail.',
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    try {
      const args = parseArgs(process.argv.slice(2), { flags: ['help'], options: ['config'] });
      if (args.help) {
        console.log(usage());
        return;
      }
      const prNumber = Number(process.env.PR_NUMBER);
      const repo = process.env.GITHUB_REPOSITORY || '';
      if (!Number.isInteger(prNumber) || prNumber <= 0) throw new UsageError('PR_NUMBER env is required');
      if (!repo) throw new UsageError('GITHUB_REPOSITORY env is required');
      await runPostMergeAudit({ github: new GitHubCli(), repo, prNumber, configPath: args.config || null });
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
