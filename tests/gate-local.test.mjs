import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BASE_PLACEHOLDER,
  DEFAULT_BASE,
  DEFAULT_TIMEOUT_MS,
  LOCAL_STEPS,
  STEP_IDS,
  formatHuman,
  npmAliasOf,
  resolveCommand,
  runGate,
  tailText,
} from '../scripts/internal/gate-local.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'internal', 'gate-local.mjs');
const CI = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const PACKAGE = path.join(ROOT, 'package.json');

const EXPECTED_IDS = [
  'unit-tests',
  'lint',
  'format',
  'docs-check',
  'versions',
  'config',
  'tooling',
  'contract',
  'release-gate',
  'transport-guard',
  'dependency-guard',
  'surface',
  'surface-check',
  'hygiene',
  'debt',
  'docs-coverage',
  'counts',
];

/** Aliases owned by sibling tasks (B adds surface:check, D adds guard:debt); absent today. */
const EXPECTED_NOT_YET_ADDED_ALIASES = new Set(['surface:check', 'guard:debt']);

function packageScripts() {
  return JSON.parse(fs.readFileSync(PACKAGE, 'utf8')).scripts || {};
}

/**
 * Fake spawnSync-compatible runner. Fails or times out the step identified by
 * GATE_LOCAL_STEP, passes everything else, and records the argv/env of every call.
 */
function fakeSpawn({ failAt = null, timeoutAt = null, exitCode = 3 } = {}) {
  const spawn = (command, args, options = {}) => {
    const stepId = options.env?.GATE_LOCAL_STEP ?? null;
    spawn.calls.push({ command, args, stepId });
    if (timeoutAt === stepId) {
      return {
        status: null,
        signal: 'SIGTERM',
        error: { code: 'ETIMEDOUT', message: 'ETIMEDOUT' },
        stdout: 'partial stdout',
        stderr: '',
      };
    }
    if (failAt === stepId) {
      return {
        status: exitCode,
        signal: null,
        error: null,
        stdout: 'failed stdout line',
        stderr: 'failed stderr bubble',
      };
    }
    return { status: 0, signal: null, error: null, stdout: 'ok stdout', stderr: '' };
  };
  spawn.calls = [];
  return spawn;
}

function runWithFakes(options = {}) {
  const spawn = options.spawn ?? fakeSpawn();
  const result = runGate({
    cwd: ROOT,
    env: {},
    spawn,
    checkNpmAlias: () => true,
    checkGitRef: () => true,
    ...options,
  });
  return { spawn, result };
}

// ---------------------------------------------------------------------------
// Step table shape and ordering
// ---------------------------------------------------------------------------

test('step table has the documented deterministic order and unique ids', () => {
  assert.deepEqual(STEP_IDS, EXPECTED_IDS);
  assert.equal(LOCAL_STEPS.length, 17);
  const ids = new Set();
  const titles = new Set();
  for (const step of LOCAL_STEPS) {
    assert.equal(typeof step.id, 'string');
    assert.ok(step.id.trim().length > 0);
    assert.ok(!ids.has(step.id), `duplicate id ${step.id}`);
    ids.add(step.id);
    assert.equal(typeof step.title, 'string');
    assert.ok(step.title.trim().length > 0);
    assert.ok(!titles.has(step.title), `duplicate title ${step.title}`);
    titles.add(step.title);
    assert.ok(Array.isArray(step.command) && step.command.length > 0, `${step.id} needs a command`);
    for (const part of step.command) assert.equal(typeof part, 'string');
    assert.equal(step.required, true, `${step.id} must be required`);
  }
});

test('npm aliases named by the gate exist in package.json (forward-compatible skips exempt)', () => {
  const scripts = packageScripts();
  for (const step of LOCAL_STEPS) {
    const alias = npmAliasOf(step);
    if (!alias) continue;
    if (Object.prototype.hasOwnProperty.call(scripts, alias)) continue;
    assert.ok(EXPECTED_NOT_YET_ADDED_ALIASES.has(alias), `gate step ${step.id} references missing npm alias ${alias}`);
    assert.equal(step.optionalAlias, true, `missing alias ${alias} must be an explicit skip-with-notice step`);
  }
});

test('script-path steps and base resolution stay coherent', () => {
  const docsCoverage = LOCAL_STEPS.find((step) => step.id === 'docs-coverage');
  assert.ok(docsCoverage);
  assert.deepEqual(resolveCommand(docsCoverage, { base: 'origin/main' }), [
    'node',
    'scripts/adopt/docs/guard-docs.mjs',
    '--base',
    'origin/main',
  ]);
  assert.deepEqual(resolveCommand(docsCoverage, { base: 'v1.2.3' }).slice(-1), ['v1.2.3']);
  assert.ok(LOCAL_STEPS.find((step) => step.id === 'surface').command.includes('--require-manifest'));
  assert.equal(DEFAULT_BASE, 'origin/main');
  assert.ok(DEFAULT_TIMEOUT_MS >= 60_000);
});

test('tailText keeps the last lines within limits', () => {
  assert.equal(tailText(''), '');
  assert.equal(tailText('a\nb\nc', { maxLines: 2 }), 'b\nc');
  assert.equal(tailText('abcdef', { maxChars: 4 }), 'cdef');
  assert.equal(tailText(undefined), '');
});

// ---------------------------------------------------------------------------
// Skip logic: unavailable prerequisites are skips, never fake passes
// ---------------------------------------------------------------------------

test('git-dependent steps skip with a notice when origin/main is unavailable', () => {
  const { spawn, result } = runWithFakes({ checkGitRef: () => false });
  assert.equal(result.ok, true);
  assert.equal(result.counts.skipped, 2);
  assert.equal(result.counts.executed, 15);
  assert.equal(result.counts.passed, 15);
  assert.equal(result.counts.failed, 0);
  assert.equal(result.counts.notRun, 0);
  assert.equal(spawn.calls.length, 15);

  const dependency = result.results.find((step) => step.id === 'dependency-guard');
  const coverage = result.results.find((step) => step.id === 'docs-coverage');
  assert.equal(dependency.status, 'skipped');
  assert.match(dependency.skipReason, /origin\/main/);
  assert.equal(coverage.status, 'skipped');
  assert.match(coverage.skipReason, /origin\/main/);
  assert.equal(result.notices.length, 2);

  // A skip is not a pass: counts add up and the summary says so.
  const { counts } = result;
  assert.equal(counts.passed + counts.failed + counts.skipped + counts.notRun, counts.total);
  const human = formatHuman(result);
  assert.match(human, /GATE_LOCAL_OK 15\/15 \(2 skipped\)/);
  assert.match(human, /dependency-guard — skipped:/);
});

test('git-dependent steps run when the base ref resolves locally', () => {
  const calls = [];
  const checkGitRef = (ref) => {
    calls.push(ref);
    return true;
  };
  const { spawn, result } = runWithFakes({ checkGitRef, base: 'v9.9.9' });
  assert.equal(result.ok, true);
  assert.equal(result.counts.skipped, 0);
  assert.equal(result.counts.executed, 17);
  assert.equal(spawn.calls.length, 17);
  assert.ok(calls.includes('v9.9.9'));

  const coverageCall = spawn.calls.find((call) => call.stepId === 'docs-coverage');
  assert.ok(coverageCall.args.includes('--base'));
  assert.equal(coverageCall.args[coverageCall.args.indexOf('--base') + 1], 'v9.9.9');
  const dependencyCall = spawn.calls.find((call) => call.stepId === 'dependency-guard');
  assert.deepEqual(dependencyCall.command === 'npm' || dependencyCall.command === 'npm.cmd', true);
});

test('a required npm alias missing from package.json fails the step without spawning', () => {
  const { result } = runWithFakes({ checkNpmAlias: (alias) => alias !== 'lint' });
  assert.equal(result.ok, false);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.executed, 2);
  assert.equal(result.counts.notRun, 15);
  const lint = result.results.find((step) => step.id === 'lint');
  assert.equal(lint.status, 'failed');
  assert.match(lint.error, /required npm alias not defined: lint/);
  assert.match(formatHuman(result), /GATE_LOCAL_FAIL 1\/2/);
});

// ---------------------------------------------------------------------------
// Aggregation, fail-fast, --continue and timeout handling
// ---------------------------------------------------------------------------

test('fail-fast stops after the first failing step and aggregates the result', () => {
  const { spawn, result } = runWithFakes({ spawn: fakeSpawn({ failAt: 'format' }) });
  assert.equal(result.ok, false);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.executed, 3);
  assert.equal(result.counts.passed, 2);
  assert.equal(result.counts.notRun, 14);
  assert.equal(spawn.calls.length, 3);
  const failed = result.results.find((step) => step.id === 'format');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 3);
  assert.match(failed.stderrTail, /failed stderr bubble/);

  const human = formatHuman(result);
  assert.match(human, /GATE_LOCAL_FAIL 1\/3/);
  assert.match(human, /--- format failing output/);
  assert.match(human, /failed stdout line/);
});

test('--continue runs every step and reports all failures', () => {
  const spawn = fakeSpawn({ failAt: 'contract' });
  const result = runGate({
    cwd: ROOT,
    env: {},
    spawn,
    checkNpmAlias: () => true,
    checkGitRef: () => true,
    continueOnFailure: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.counts.executed, 17);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.notRun, 0);
  assert.equal(spawn.calls.length, 17);
});

test('a timed-out child fails the step with a timeout marker', () => {
  const spawn = fakeSpawn({ timeoutAt: 'lint' });
  const result = runGate({
    cwd: ROOT,
    env: {},
    spawn,
    checkNpmAlias: () => true,
    checkGitRef: () => true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.counts.failed, 1);
  const lint = result.results.find((step) => step.id === 'lint');
  assert.equal(lint.status, 'failed');
  assert.equal(lint.timedOut, true);
  assert.equal(lint.exitCode, null);
  assert.match(formatHuman(result), /lint — FAIL \(timed out/);
});

test('formatHuman prints GATE_LOCAL_OK n/n when every attempted step passes', () => {
  const { result } = runWithFakes();
  const human = formatHuman(result);
  assert.match(human, /GATE_LOCAL_OK 17\/17$/m);
  assert.doesNotMatch(human, /GATE_LOCAL_FAIL/);
});

// ---------------------------------------------------------------------------
// CLI surface (--help/--list/--json/usage errors)
// ---------------------------------------------------------------------------

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

test('--help exits 0 and documents the checkpoint contract', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node scripts\/internal\/gate-local\.mjs/);
  assert.match(result.stdout, /GATE_LOCAL_BASE/);
  assert.match(result.stdout, /--continue/);
});

test('--list --json emits the deterministic step table', () => {
  const result = runCli(['--list', '--json']);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.steps.length, LOCAL_STEPS.length);
  assert.deepEqual(
    payload.steps.map((step) => step.id),
    EXPECTED_IDS,
  );
  assert.deepEqual(
    payload.steps.map((step) => step.index),
    EXPECTED_IDS.map((_, index) => index + 1),
  );
});

test('--list prints the ordered table without running steps', () => {
  const result = runCli(['--list']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Local gate step table \(17 steps, deterministic order\)/);
  assert.match(result.stdout, /1\. unit-tests — npm run test/);
  assert.match(result.stdout, /14\. hygiene — npm run guard:hygiene/);
  assert.match(result.stdout, /16\. docs-coverage — node scripts\/adopt\/docs\/guard-docs\.mjs --base/);
});

test('unknown options exit 2', () => {
  const result = runCli(['--nope']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown option --nope/);
});

// ---------------------------------------------------------------------------
// CI docs-guard parity: the remote docs job is a subset of the local gate
// ---------------------------------------------------------------------------

function parseCiDocsGuardCommands(text) {
  const lines = text.split(/\r?\n/);
  const stepIndex = lines.findIndex((line) => /Docs, config, and guard checks/.test(line));
  assert.ok(stepIndex >= 0, 'ci.yml docs-guard step not found');
  const runIndex = lines.findIndex((line, index) => index > stepIndex && /^\s*run:\s*\|/.test(line));
  assert.ok(runIndex >= 0, 'ci.yml docs-guard run block not found');
  const runIndent = lines[runIndex].match(/^\s*/)[0].length;
  const commands = [];
  for (const line of lines.slice(runIndex + 1)) {
    const indent = line.match(/^\s*/)[0].length;
    const trimmed = line.trim();
    if (!trimmed || indent <= runIndent) break;
    commands.push(trimmed);
  }
  return commands;
}

function commandSignature(commandLine) {
  const tokens = commandLine.split(/\s+/);
  if (tokens[0] === 'npm' && tokens[1] === 'run' && tokens[2]) return `npm:${tokens[2]}`;
  if (tokens[0] === 'node' && tokens[1]) return `node:${tokens[1]}`;
  return null;
}

test('CI docs-guard command set is a subset of gate:local steps (drift guard)', () => {
  const scripts = packageScripts();
  const localSignatures = new Set();
  for (const step of LOCAL_STEPS) {
    const alias = npmAliasOf(step);
    if (alias) {
      localSignatures.add(`npm:${alias}`);
      const target = String(scripts[alias] || '').trim();
      if (target.startsWith('node ')) localSignatures.add(`node:${target.split(/\s+/)[1]}`);
    } else if (step.command[0] === 'node') {
      localSignatures.add(`node:${step.command[1]}`);
    }
  }

  const ciCommands = parseCiDocsGuardCommands(fs.readFileSync(CI, 'utf8'));
  assert.ok(ciCommands.length >= 8, `expected the docs-guard job to run >= 8 commands, got ${ciCommands.length}`);
  for (const commandLine of ciCommands) {
    const signature = commandSignature(commandLine);
    assert.ok(signature, `cannot classify CI docs-guard command: ${commandLine}`);
    // If CI delegates the whole docs job to the gate itself, parity holds by construction.
    if (signature === 'npm:gate:local') continue;
    assert.ok(localSignatures.has(signature), `CI docs-guard command is missing from gate:local: ${commandLine}`);
  }
});
