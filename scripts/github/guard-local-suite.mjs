#!/usr/bin/env node
/**
 * Remote-only verification suite guard.
 *
 * A suite declared in `tracker.config.json` under `verification.remoteOnly[]` may run visibly
 * only on a real remote runner (`GITHUB_ACTIONS === 'true'`). Local runs are blocked unless:
 * - the suite declares `localMode: "hidden"` and the invocation passes `--hidden` (non-authoritative
 *   hidden mode), or
 * - the suite's explicit override env is set (deliberate human debugging; agents must never use it).
 *
 * `--mode report` never blocks: local runs print a machine-readable `DEFERRED_REMOTE` line and
 * exit 0 so verify aggregators can record the deferral instead of the run.
 *
 * Pure local CLI: reads tracker.config.json only, no GitHub API calls, works offline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './validate-config.mjs';
import { parseArgs, UsageError } from './lib/cli.mjs';
import {
  GUARD_STATUS,
  evaluateRemoteOnlyPolicy,
  formatDeferredRemoteReport,
  formatGuardInstructions,
} from './lib/verification-policy.mjs';

const MODES = ['enforce', 'report'];

export function jsonView(result) {
  const view = {
    ok: result.ok,
    status: result.status,
    exitCode: result.exitCode,
    mode: result.mode,
    remote: Boolean(result.remote),
    hiddenRequested: Boolean(result.hiddenRequested),
  };
  if (result.suite) view.suite = result.suite;
  if (result.warning) view.warning = result.warning;
  if (result.knownSuites) view.knownSuites = result.knownSuites;
  if (result.violations) view.violations = result.violations;
  return view;
}

function allowedLine(result) {
  if (result.status === GUARD_STATUS.NO_POLICY) {
    return `ALLOWED ${result.status} suite=${result.suiteId || '-'} (no verification.remoteOnly policy declared)`;
  }
  const suite = result.suite;
  if (result.status === GUARD_STATUS.REMOTE) {
    return `ALLOWED ${result.status} suite=${suite.id} (remote runner: GITHUB_ACTIONS=true)`;
  }
  if (result.status === GUARD_STATUS.LOCAL_HIDDEN) {
    return `ALLOWED ${result.status} suite=${suite.id} (hidden local mode; non-authoritative)`;
  }
  if (result.status === GUARD_STATUS.LOCAL_OVERRIDE) {
    return `ALLOWED ${result.status} suite=${suite.id} (override: ${suite.overrideEnv})`;
  }
  return `ALLOWED ${result.status} suite=${suite.id}`;
}

function usage() {
  return [
    'Usage: node scripts/github/guard-local-suite.mjs --suite ID [--mode enforce|report]',
    '       [--root DIR] [--config FILE] [--hidden] [--json]',
    '',
    'Enforces the remote-only verification policy from tracker.config.json `verification.remoteOnly`.',
    '',
    'Modes:',
    '  enforce  (default) local visible runs exit 1 with remote workflow/label/override instructions',
    '  report   local runs print DEFERRED_REMOTE and exit 0 for verify aggregators',
    '',
    'Remote detection: GITHUB_ACTIONS === "true" (a plain local CI=true is not remote).',
    'Hidden local mode: --hidden is allowed only when the suite declares localMode: "hidden".',
    'Override: setting the suite override env allows deliberate human debugging with a loud warning;',
    'agents must never use it.',
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    try {
      const args = parseArgs(process.argv.slice(2), {
        flags: ['hidden', 'json', 'help'],
        options: ['root', 'config', 'suite', 'mode'],
      });
      if (args.help) {
        console.log(usage());
        return;
      }
      const mode = args.mode || 'enforce';
      if (!MODES.includes(mode)) throw new UsageError(`--mode must be one of ${MODES.join(', ')}`);
      if (!args.suite) throw new UsageError('--suite is required (a suite id declared in verification.remoteOnly)');
      const root = path.resolve(args.root || '.');
      const configPath = path.resolve(args.config || path.join(root, 'tracker.config.json'));
      if (!fs.existsSync(configPath)) throw new UsageError(`config not found: ${configPath}`);
      let config;
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (err) {
        throw new UsageError(`cannot parse tracker config ${configPath}: ${err.message}`);
      }
      const configErrors = validateConfig(config);
      if (configErrors.length) {
        console.error('error: invalid tracker config; fix the remote-only policy:');
        for (const error of configErrors) console.error(`- ${error}`);
        process.exitCode = 1;
        return;
      }
      const result = evaluateRemoteOnlyPolicy({
        config,
        suiteId: args.suite,
        mode,
        hidden: Boolean(args.hidden),
        env: process.env,
      });
      if (result.status === GUARD_STATUS.BLOCKED || result.status === GUARD_STATUS.UNKNOWN_SUITE) {
        console.error(`error: ${formatGuardInstructions(result)}`);
        process.exitCode = 1;
        return;
      }
      if (result.status === GUARD_STATUS.INVALID_POLICY) {
        console.error(`error: ${formatGuardInstructions(result)}`);
        process.exitCode = 1;
        return;
      }
      if (result.warning) console.error(`WARNING: ${result.warning}`);
      if (args.json) {
        process.stdout.write(`${JSON.stringify(jsonView(result), null, 2)}\n`);
      } else if (result.status === GUARD_STATUS.DEFERRED) {
        console.log(formatDeferredRemoteReport(result));
      } else {
        console.log(allowedLine(result));
      }
      process.exitCode = result.exitCode;
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
